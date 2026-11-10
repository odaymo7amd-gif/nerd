import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { all, get, nowIso, run } from './db.ts';
import { HttpError } from './http.ts';
import { isDeveloperIdentity } from './developerConfig.ts';

export const SESSION_COOKIE = 'nerd_session';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: 'student' | 'admin';
  avatarUrl: string | null;
  countryId: number | null;
  curriculumId: number | null;
  gradeLevelId: number | null;
  semesterId: number | null;
  theme: 'dark' | 'light';
  notificationsEnabled: boolean;
  isActive: boolean;
  isDeveloper: boolean;
  onboarded: boolean;
  createdAt: string;
  lastActiveAt: string | null;
}

interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: 'student' | 'admin';
  avatar_url: string | null;
  country_id: number | null;
  curriculum_id: number | null;
  grade_level_id: number | null;
  semester_id: number | null;
  theme: 'dark' | 'light';
  notifications_enabled: number;
  is_active: number;
  onboarded_at: string | null;
  created_at: string;
  last_active_at: string | null;
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    avatarUrl: row.avatar_url,
    countryId: row.country_id,
    curriculumId: row.curriculum_id,
    gradeLevelId: row.grade_level_id,
    semesterId: row.semester_id,
    theme: row.theme,
    notificationsEnabled: Boolean(row.notifications_enabled),
    isActive: Boolean(row.is_active),
    isDeveloper: isDeveloperIdentity(row.id, row.role),
    onboarded: Boolean(row.onboarded_at),
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

// ---------- كلمات المرور ----------
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = scryptSync(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// ---------- الجلسات ----------
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createSession(userId: number, remember: boolean, userAgent: string): string {
  const token = randomBytes(32).toString('base64url');
  const ttlMs = (remember ? 30 : 1) * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString().replace('T', ' ').slice(0, 19);
  run(
    'INSERT INTO sessions (user_id, token_hash, user_agent, expires_at) VALUES (?, ?, ?, ?)',
    userId,
    sha256(token),
    userAgent.slice(0, 300),
    expiresAt,
  );
  return token;
}

export function destroySession(token: string | undefined): void {
  if (!token) return;
  run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function destroyAllSessions(userId: number, exceptToken?: string): void {
  if (exceptToken) {
    run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', userId, sha256(exceptToken));
  } else {
    run('DELETE FROM sessions WHERE user_id = ?', userId);
  }
}

export function setSessionCookie(res: Response, token: string, remember: boolean): void {
  const maxAge = (remember ? 30 : 1) * 24 * 60 * 60 * 1000;
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

export function findSessionUser(token: string | undefined): AuthUser | null {
  if (!token) return null;
  const row = get<UserRow & { expires_at: string; user_id: number }>(
    `SELECT u.*, s.expires_at AS expires_at FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    sha256(token),
  );
  if (!row) return null;
  if (new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()) {
    run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    return null;
  }
  if (!row.is_active) return null;
  return toAuthUser(row);
}

export function touchLastActive(userId: number): void {
  run('UPDATE users SET last_active_at = ? WHERE id = ?', nowIso(), userId);
}

export function requireUser(req: Request, res: Response): AuthUser | null {
  const user = findSessionUser(readCookie(req, SESSION_COOKIE));
  if (!user) {
    res.status(401).json({ error: { message: 'يجب تسجيل الدخول للمتابعة.' } });
    return null;
  }
  return user;
}

export function requireDeveloper(req: Request, res: Response): AuthUser | null {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.isDeveloper) {
    res.status(403).json({ error: { message: 'هذه المنطقة مخصصة للمطوّر فقط.' } });
    return null;
  }
  return user;
}

export function requireAdmin(req: Request, res: Response): AuthUser | null {
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    res.status(403).json({ error: { message: 'هذه الصفحة مخصصة للمشرفين فقط.' } });
    return null;
  }
  return user;
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < 8) {
    throw new HttpError(400, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
  }
  if (!/[A-Za-z\u0600-\u06FF]/.test(password) || !/[0-9]/.test(password)) {
    throw new HttpError(400, 'كلمة المرور يجب أن تحتوي على حروف وأرقام.');
  }
}

export function createNotification(
  userId: number,
  type: string,
  title: string,
  body: string,
): void {
  run(
    'INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)',
    userId,
    type,
    title,
    body,
  );
}

export function logActivity(
  userId: number,
  kind: string,
  title: string,
  detail?: string,
): void {
  run(
    'INSERT INTO activity_log (user_id, kind, title, detail) VALUES (?, ?, ?, ?)',
    userId,
    kind,
    title,
    detail ?? null,
  );
}

export function activeUserCount(): number {
  return (
    all<{ count: number }>(
      "SELECT COUNT(*) AS count FROM users WHERE last_active_at >= datetime('now', '-7 days')",
    )[0]?.count ?? 0
  );
}
