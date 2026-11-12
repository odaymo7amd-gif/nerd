import { Router } from 'express';
import { z } from 'zod';
import { all, get, nowIso, run } from '../db.ts';
import {
  assertPasswordPolicy,
  clearSessionCookie,
  createNotification,
  createSession,
  destroyAllSessions,
  destroySession,
  findSessionUser,
  hashPassword,
  logActivity,
  readCookie,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
  toAuthUser,
  touchLastActive,
  verifyPassword,
  type AuthUser,
} from '../auth.ts';
import { HttpError, rateLimit } from '../http.ts';
import { developerUserId } from '../developerConfig.ts';
import { sendMail } from '../mailer.ts';
import { createHash, randomBytes } from 'node:crypto';

export const authRouter = Router();

const registerSchema = z
  .object({
    username: z.string().trim().min(3, 'اسم المستخدم قصير جدًا.').max(40, 'اسم المستخدم طويل جدًا.'),
    email: z.string().trim().email('البريد الإلكتروني غير صحيح.'),
    password: z.string().min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.'),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'كلمة المرور وتأكيدها غير متطابقين.',
    path: ['confirmPassword'],
  });

const loginSchema = z.object({
  email: z.string().trim().email('البريد الإلكتروني غير صحيح.'),
  password: z.string().min(1, 'كلمة المرور مطلوبة.'),
  remember: z.boolean().optional().default(false),
});


function publicUser(user: AuthUser) {
  return user;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

authRouter.post(
  '/register',
  rateLimit({ key: 'register', limit: 10, windowMs: 60 * 60 * 1000 }),
  (req, res, next) => {
    try {
      const payload = registerSchema.parse(req.body);
      assertPasswordPolicy(payload.password);

      const emailTaken = get<{ id: number }>(
        'SELECT id FROM users WHERE email = ? COLLATE NOCASE',
        payload.email,
      );
      if (emailTaken) throw new HttpError(409, 'هذا البريد الإلكتروني مستخدم مسبقًا.');

      const usernameTaken = get<{ id: number }>(
        'SELECT id FROM users WHERE lower(username) = lower(?)',
        payload.username,
      );
      if (usernameTaken) throw new HttpError(409, 'اسم المستخدم مستخدم مسبقًا، جرّب اسمًا آخر.');

      const created = run(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
        payload.username,
        payload.email,
        hashPassword(payload.password),
      );
      const userId = created.lastInsertRowid;
      // على قاعدة جديدة أول حساب يأخذ id=1. إذا كان هذا هو معرّف المطوّر
      // المضبوط في البيئة، نمنحه الدور فورًا بدل انتظار إعادة تشغيل الخادم.
      if (userId === developerUserId()) {
        run("UPDATE users SET role = 'admin' WHERE id = ?", userId);
      }

      run('INSERT INTO user_statistics (user_id) VALUES (?)', userId);
      createNotification(
        userId,
        'account',
        'مرحبًا بك في نيرد 🎉',
        'أكمل إعداد حسابك باختيار الصف والمواد لتصبح الصفحة الرئيسية مخصصة لك.',
      );
      logActivity(userId, 'account', 'إنشاء الحساب', 'تم إنشاء حساب جديد في نيرد.');

      const token = createSession(userId, true, req.headers['user-agent'] ?? '');
      setSessionCookie(res, token, true);

      const created_user = findSessionUser(token);
      if (!created_user) throw new HttpError(500, 'تعذر إنشاء الجلسة.');
      res.status(201).json({ user: publicUser(created_user) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: { message: error.issues[0]?.message ?? 'بيانات غير صحيحة.' } });
        return;
      }
      next(error);
    }
  },
);

authRouter.post(
  '/login',
  rateLimit({ key: 'login', limit: 15, windowMs: 15 * 60 * 1000 }),
  (req, res, next) => {
    try {
      const payload = loginSchema.parse(req.body);
      const row = get<{ id: number; is_active: number; password_hash: string; role: string }>(
        'SELECT id, is_active, password_hash, role FROM users WHERE email = ? COLLATE NOCASE',
        payload.email,
      );
      if (!row || !verifyPassword(payload.password, row.password_hash)) {
        throw new HttpError(401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة.');
      }
      if (!row.is_active) {
        throw new HttpError(403, 'تم تعطيل هذا الحساب. تواصل مع الدعم لمزيد من المعلومات.');
      }
      if (row.id === developerUserId() && row.role !== 'admin') {
        run("UPDATE users SET role = 'admin' WHERE id = ?", row.id);
      }

      const token = createSession(row.id, payload.remember, req.headers['user-agent'] ?? '');
      setSessionCookie(res, token, payload.remember);
      touchLastActive(row.id);
      const user = findSessionUser(token);
      if (!user) throw new HttpError(500, 'تعذر إنشاء الجلسة.');
      res.json({ user: publicUser(user) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: { message: error.issues[0]?.message ?? 'بيانات غير صحيحة.' } });
        return;
      }
      next(error);
    }
  },
);

authRouter.post('/logout', (req, res) => {
  destroySession(readCookie(req, SESSION_COOKIE));
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  const user = findSessionUser(readCookie(req, SESSION_COOKIE));
  if (!user) {
    res.status(401).json({ error: { message: 'لا توجد جلسة نشطة.' } });
    return;
  }
  touchLastActive(user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post(
  '/forgot-password',
  rateLimit({ key: 'forgot', limit: 5, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
    const email = String(req.body?.email ?? '').trim();
    if (!email) {
      res.status(400).json({ error: { message: 'البريد الإلكتروني مطلوب.' } });
      return;
    }
    const generic = {
      ok: true,
      message:
        'إذا كان البريد مسجلًا لدينا فستصلك رسالة تحتوي رابط إعادة تعيين كلمة المرور خلال دقائق.',
      deliveryConfigured: Boolean(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM),
    };

    const row = get<{ id: number; username: string }>(
      'SELECT id, username FROM users WHERE email = ? COLLATE NOCASE',
      email,
    );
    if (!row) {
      res.json(generic);
      return;
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    run(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      row.id,
      hashToken(token),
      expiresAt,
    );

    const base = process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    const link = `${base}/reset-password?token=${token}`;
    const result = await sendMail({
      to: email,
      subject: 'إعادة تعيين كلمة المرور – NERD',
      text: `مرحبًا ${row.username}،\n\nلإعادة تعيين كلمة المرور افتح الرابط التالي خلال ساعة:\n${link}\n\nإذا لم تطلب ذلك تجاهل هذه الرسالة.`,
    });

    res.json({
      ...generic,
      deliveryConfigured: result.delivered,
      deliveryReason: result.delivered ? undefined : result.reason,
    });
  },
);

authRouter.post(
  '/reset-password',
  rateLimit({ key: 'reset', limit: 10, windowMs: 60 * 60 * 1000 }),
  (req, res, next) => {
    try {
      const schema = z
        .object({
          token: z.string().min(10, 'رابط إعادة التعيين غير صحيح.'),
          password: z.string().min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.'),
          confirmPassword: z.string(),
        })
        .refine((value) => value.password === value.confirmPassword, {
          message: 'كلمة المرور وتأكيدها غير متطابقين.',
          path: ['confirmPassword'],
        });
      const payload = schema.parse(req.body);
      assertPasswordPolicy(payload.password);

      const record = get<{ id: number; user_id: number; expires_at: string; used_at: string | null }>(
        'SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?',
        hashToken(payload.token),
      );
      if (!record || record.used_at) {
        throw new HttpError(400, 'رابط إعادة التعيين غير صالح أو مستخدم مسبقًا.');
      }
      if (new Date(record.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()) {
        throw new HttpError(400, 'انتهت صلاحية رابط إعادة التعيين. اطلب رابطًا جديدًا.');
      }

      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(payload.password), record.user_id);
      run('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?', nowIso(), record.id);
      destroyAllSessions(record.user_id);
      createNotification(
        record.user_id,
        'security',
        'تم تغيير كلمة المرور',
        'تم تعيين كلمة مرور جديدة لحسابك، وتم إنهاء جميع الجلسات الأخرى.',
      );
      res.json({ ok: true, message: 'تم تعيين كلمة المرور الجديدة. يمكنك تسجيل الدخول الآن.' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: { message: error.issues[0]?.message ?? 'بيانات غير صحيحة.' } });
        return;
      }
      next(error);
    }
  },
);

authRouter.post('/change-password', (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;

    const schema = z
      .object({
        currentPassword: z.string().min(1, 'كلمة المرور الحالية مطلوبة.'),
        newPassword: z.string().min(8, 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.'),
        confirmPassword: z.string(),
      })
      .refine((value) => value.newPassword === value.confirmPassword, {
        message: 'كلمة المرور الجديدة وتأكيدها غير متطابقين.',
        path: ['confirmPassword'],
      });
    const payload = schema.parse(req.body);

    const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', user.id);
    if (!row || !verifyPassword(payload.currentPassword, row.password_hash)) {
      throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة.');
    }
    assertPasswordPolicy(payload.newPassword);
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(payload.newPassword), user.id);

    const currentToken = readCookie(req, SESSION_COOKIE);
    destroyAllSessions(user.id, currentToken);
    res.json({ ok: true, message: 'تم تحديث كلمة المرور.' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: error.issues[0]?.message ?? 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

export function sessionCountFor(userId: number): number {
  return all<{ count: number }>('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?', userId)[0]?.count ?? 0;
}

export { toAuthUser };
