import { Router } from 'express';
import { z } from 'zod';
import { all, get, run } from '../db.ts';
import { HttpError } from '../http.ts';
import { removeBookDirectory, removeUserUploadDirectory } from '../storage.ts';
import { isDeveloperIdentity } from '../developerConfig.ts';
import {
  clearSessionCookie,
  createNotification,
  destroyAllSessions,
  logActivity,
  readCookie,
  requireUser,
  SESSION_COOKIE,
  touchLastActive,
  verifyPassword,
  type AuthUser,
} from '../auth.ts';

export const profileRouter = Router();

export interface StatsRow {
  study_minutes: number;
  questions_answered: number;
  tests_completed: number;
  saved_questions_count: number;
  points: number;
  streak_days: number;
  daily_goal_minutes: number;
  updated_at: string;
}

export function ensureStats(userId: number): StatsRow {
  let row = get<StatsRow>(
    'SELECT study_minutes, questions_answered, tests_completed, saved_questions_count, points, streak_days, daily_goal_minutes, updated_at FROM user_statistics WHERE user_id = ?',
    userId,
  );
  if (!row) {
    run('INSERT INTO user_statistics (user_id) VALUES (?)', userId);
    row = get<StatsRow>(
      'SELECT study_minutes, questions_answered, tests_completed, saved_questions_count, points, streak_days, daily_goal_minutes, updated_at FROM user_statistics WHERE user_id = ?',
      userId,
    );
  }
  return row!;
}

export function mapStats(row: StatsRow) {
  return {
    studyMinutes: row.study_minutes,
    questionsAnswered: row.questions_answered,
    testsCompleted: row.tests_completed,
    savedQuestions: row.saved_questions_count,
    points: row.points,
    streakDays: row.streak_days,
    dailyGoalMinutes: row.daily_goal_minutes,
    updatedAt: row.updated_at,
  };
}

function userProfile(user: AuthUser) {
  const meta = get<{
    country_name: string | null;
    curriculum_name: string | null;
    grade_name: string | null;
    semester_name: string | null;
  }>(
    `SELECT co.name_ar AS country_name,
            cu.name_ar AS curriculum_name,
            g.name_ar  AS grade_name,
            s.name_ar  AS semester_name
       FROM users u
       LEFT JOIN countries co ON co.id = u.country_id
       LEFT JOIN curricula cu ON cu.id = u.curriculum_id
       LEFT JOIN grade_levels g ON g.id = u.grade_level_id
       LEFT JOIN semesters s ON s.id = u.semester_id
      WHERE u.id = ?`,
    user.id,
  );

  const subjects = all<{ id: number; name_ar: string }>(
    `SELECT s.id, s.name_ar FROM user_subjects us
       JOIN subjects s ON s.id = us.subject_id
      WHERE us.user_id = ?
      ORDER BY s.sort_order`,
    user.id,
  );

  const counts = get<{ books: number; contents: number; summaries: number; tests: number; questions: number }>(
    `SELECT
       (SELECT COUNT(*) FROM books WHERE user_id = ? AND is_content_source = 0) AS books,
       (SELECT COUNT(*) FROM study_contents WHERE user_id = ?) AS contents,
       (SELECT COUNT(*) FROM summaries WHERE user_id = ?) AS summaries,
       (SELECT COUNT(*) FROM tests WHERE user_id = ?) AS tests,
       (SELECT COUNT(*) FROM saved_questions WHERE user_id = ?) AS questions`,
    user.id,
    user.id,
    user.id,
    user.id,
    user.id,
  );

  return {
    user,
    stats: mapStats(ensureStats(user.id)),
    curriculum: {
      countryName: meta?.country_name ?? null,
      curriculumName: meta?.curriculum_name ?? null,
      gradeName: meta?.grade_name ?? null,
      semesterName: meta?.semester_name ?? null,
    },
    subjects,
    counts: counts ?? { books: 0, contents: 0, summaries: 0, tests: 0, questions: 0 },
  };
}

profileRouter.get('/profile', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json(userProfile(user));
});

const profileSchema = z.object({
  username: z.string().trim().min(3, 'اسم المستخدم قصير جدًا.').max(40).optional(),
  avatarUrl: z.string().trim().url('رابط الصورة غير صحيح.').max(500).nullable().optional(),
  countryId: z.number().int().positive().nullable().optional(),
  curriculumId: z.number().int().positive().nullable().optional(),
  gradeLevelId: z.number().int().positive().nullable().optional(),
  semesterId: z.number().int().positive().nullable().optional(),
  subjectIds: z.array(z.number().int().positive()).max(20).optional(),
});

profileRouter.patch('/profile', (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;

    const payload = profileSchema.parse(req.body);

    if (payload.username) {
      const taken = get<{ id: number }>(
        'SELECT id FROM users WHERE lower(username) = lower(?) AND id <> ?',
        payload.username,
        user.id,
      );
      if (taken) throw new HttpError(409, 'اسم المستخدم مستخدم مسبقًا، جرّب اسمًا آخر.');
    }

    const checks: Array<[string, number | null | undefined]> = [
      ['countries', payload.countryId],
      ['curricula', payload.curriculumId],
      ['grade_levels', payload.gradeLevelId],
      ['semesters', payload.semesterId],
    ];
    for (const [table, id] of checks) {
      if (id === undefined || id === null) continue;
      const found = get<{ id: number }>(`SELECT id FROM ${table} WHERE id = ? AND is_active = 1`, id);
      if (!found) throw new HttpError(400, 'أحد العناصر المختارة غير متاح حاليًا.');
    }

    const updates: string[] = [];
    const params: Array<string | number | null> = [];
    const assign = (column: string, value: string | number | null) => {
      updates.push(`${column} = ?`);
      params.push(value);
    };

    if (payload.username !== undefined) assign('username', payload.username);
    if (payload.avatarUrl !== undefined) assign('avatar_url', payload.avatarUrl);
    if (payload.countryId !== undefined) assign('country_id', payload.countryId);
    if (payload.curriculumId !== undefined) assign('curriculum_id', payload.curriculumId);
    if (payload.gradeLevelId !== undefined) assign('grade_level_id', payload.gradeLevelId);
    if (payload.semesterId !== undefined) assign('semester_id', payload.semesterId);

    if (updates.length > 0) {
      params.push(user.id);
      run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...params);
    }

    if (payload.subjectIds) {
      for (const subjectId of payload.subjectIds) {
        const subject = get<{ id: number }>('SELECT id FROM subjects WHERE id = ? AND is_active = 1', subjectId);
        if (!subject) throw new HttpError(400, 'إحدى المواد المختارة غير متاحة.');
      }
      run('DELETE FROM user_subjects WHERE user_id = ?', user.id);
      for (const subjectId of payload.subjectIds) {
        run('INSERT OR IGNORE INTO user_subjects (user_id, subject_id) VALUES (?, ?)', user.id, subjectId);
      }
    }

    const refreshed = get<{
      id: number;
      username: string;
      country_id: number | null;
      curriculum_id: number | null;
      grade_level_id: number | null;
      semester_id: number | null;
      onboarded_at: string | null;
    }>(
      'SELECT id, username, country_id, curriculum_id, grade_level_id, semester_id, onboarded_at FROM users WHERE id = ?',
      user.id,
    );

    if (
      refreshed &&
      !refreshed.onboarded_at &&
      refreshed.country_id &&
      refreshed.curriculum_id &&
      refreshed.grade_level_id
    ) {
      const created = new Date().toISOString().replace('T', ' ').slice(0, 19);
      run('UPDATE users SET onboarded_at = ? WHERE id = ?', created, user.id);
      logActivity(user.id, 'account', 'إكمال إعداد الحساب', 'تم تحديد الدولة والمنهاج والصف والمواد.');
      createNotification(
        user.id,
        'account',
        'تم تجهيز ملفك الدراسي',
        'أصبحت الصفحة الرئيسية مخصصة حسب صفك وموادك.',
      );
    }

    touchLastActive(user.id);
    const updatedUser = findFreshUser(user.id);
    if (!updatedUser) throw new HttpError(401, 'يجب تسجيل الدخول للمتابعة.');
    res.json(userProfile(updatedUser));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: error.issues[0]?.message ?? 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

function findFreshUser(userId: number): AuthUser | null {
  const row = get<{
    id: number;
    username: string;
    email: string;
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
  }>('SELECT * FROM users WHERE id = ?', userId);
  if (!row) return null;
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

const settingsSchema = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  notificationsEnabled: z.boolean().optional(),
});

profileRouter.patch('/settings', (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    const payload = settingsSchema.parse(req.body);

    if (payload.theme) run('UPDATE users SET theme = ? WHERE id = ?', payload.theme, user.id);
    if (payload.notificationsEnabled !== undefined) {
      run(
        'UPDATE users SET notifications_enabled = ? WHERE id = ?',
        payload.notificationsEnabled ? 1 : 0,
        user.id,
      );
    }
    const updated = findFreshUser(user.id);
    if (!updated) throw new HttpError(401, 'يجب تسجيل الدخول للمتابعة.');
    res.json({ user: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: error.issues[0]?.message ?? 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

profileRouter.delete('/account', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    const password = String(req.body?.password ?? '');
    const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', user.id);
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new HttpError(400, 'كلمة المرور غير صحيحة، لم يتم حذف الحساب.');
    }

    // احذف ملفات الكتب/المحتوى من القرص قبل حذف السجلات، وإلا بقيت نسخ يتيمة.
    const books = all<{ id: number }>('SELECT id FROM books WHERE user_id = ?', user.id);
    for (const book of books) {
      await removeBookDirectory(user.id, book.id);
    }
    await removeUserUploadDirectory(user.id);

    destroyAllSessions(user.id);
    run('DELETE FROM users WHERE id = ?', user.id);
    clearSessionCookie(res);
    res.json({ ok: true, message: 'تم حذف الحساب وجميع بياناته وملفاته.' });
  } catch (error) {
    next(error);
  }
});

// ---------- الإشعارات ----------
export const notificationsRouter = Router();

notificationsRouter.get('/notifications', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const rows = all<{
    id: number;
    type: string;
    title: string;
    body: string;
    is_read: number;
    created_at: string;
  }>(
    'SELECT id, type, title, body, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100',
    user.id,
  );
  const unread = rows.filter((row) => !row.is_read).length;
  res.json({
    unread,
    notifications: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      read: Boolean(row.is_read),
      createdAt: row.created_at,
    })),
  });
});

notificationsRouter.post('/notifications/read-all', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', user.id);
  res.json({ ok: true });
});

notificationsRouter.post('/notifications/:id/read', (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'معرّف الإشعار غير صحيح.');
    const result = run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', id, user.id);
    if (result.changes === 0) throw new HttpError(404, 'الإشعار غير موجود.');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export { SESSION_COOKIE, readCookie };
