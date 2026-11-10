import { Router } from 'express';
import { z } from 'zod';
import { all, get, run } from '../db.ts';
import { requireAdmin } from '../auth.ts';
import { HttpError } from '../http.ts';

export const adminRouter = Router();

function logAdminAction(adminId: number, action: string, target: string, detail: string): void {
  run(
    'INSERT INTO admin_activity_logs (admin_id, action, target, detail) VALUES (?, ?, ?, ?)',
    adminId,
    action,
    target,
    detail,
  );
}

adminRouter.get('/admin/overview', (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const counts = get<{
    users: number;
    active_7d: number;
    admins: number;
    books: number;
    tests: number;
    ai_requests: number;
    storage_bytes: number;
    ai_cost: number;
  }>(
    `SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM users WHERE last_active_at >= datetime('now', '-7 days')) AS active_7d,
      (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins,
      (SELECT COUNT(*) FROM books) AS books,
      (SELECT COUNT(*) FROM tests) AS tests,
      (SELECT COUNT(*) FROM ai_usage_logs) AS ai_requests,
      (SELECT COALESCE(SUM(size_bytes), 0) FROM books) AS storage_bytes,
      (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage_logs) AS ai_cost`,
  );

  const signups = all<{ day: string; count: number }>(
    `SELECT date(created_at) AS day, COUNT(*) AS count
       FROM users
      WHERE created_at >= datetime('now', '-14 days')
      GROUP BY date(created_at)
      ORDER BY day`,
  );

  const settings = all<{ key: string; value: string }>('SELECT key, value FROM app_settings ORDER BY key');

  res.json({
    counts: {
      users: counts?.users ?? 0,
      active7d: counts?.active_7d ?? 0,
      admins: counts?.admins ?? 0,
      books: counts?.books ?? 0,
      tests: counts?.tests ?? 0,
      aiRequests: counts?.ai_requests ?? 0,
      storageBytes: counts?.storage_bytes ?? 0,
      aiCostUsd: counts?.ai_cost ?? 0,
    },
    signups,
    settings: Object.fromEntries(settings.map((row) => [row.key, row.value])),
  });
});

adminRouter.get('/admin/users', (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const q = String(req.query.q ?? '').trim();
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  const like = `%${q}%`;

  const rows = all<{
    id: number;
    username: string;
    email: string;
    role: 'student' | 'admin';
    is_active: number;
    created_at: string;
    last_active_at: string | null;
    grade_name: string | null;
    tests_completed: number;
    points: number;
  }>(
    `SELECT u.id, u.username, u.email, u.role, u.is_active, u.created_at, u.last_active_at,
            g.name_ar AS grade_name,
            COALESCE(st.tests_completed, 0) AS tests_completed,
            COALESCE(st.points, 0) AS points
       FROM users u
       LEFT JOIN grade_levels g ON g.id = u.grade_level_id
       LEFT JOIN user_statistics st ON st.user_id = u.id
      WHERE (? = '' OR u.username LIKE ? OR u.email LIKE ?)
      ORDER BY u.created_at DESC
      LIMIT ?`,
    q,
    like,
    like,
    limit,
  );

  res.json({
    users: rows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      role: row.role,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
      gradeName: row.grade_name,
      testsCompleted: row.tests_completed,
      points: row.points,
    })),
  });
});

const userPatchSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.enum(['student', 'admin']).optional(),
});

adminRouter.patch('/admin/users/:id', (req, res, next) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) throw new HttpError(400, 'معرّف المستخدم غير صحيح.');
    if (targetId === admin.id) {
      throw new HttpError(400, 'لا يمكنك تعديل صلاحيات حسابك الشخصي من هنا.');
    }

    const target = get<{ id: number; role: string; is_active: number }>(
      'SELECT id, role, is_active FROM users WHERE id = ?',
      targetId,
    );
    if (!target) throw new HttpError(404, 'المستخدم غير موجود.');

    const payload = userPatchSchema.parse(req.body);

    if (payload.isActive !== undefined) {
      run('UPDATE users SET is_active = ? WHERE id = ?', payload.isActive ? 1 : 0, targetId);
      if (!payload.isActive) run('DELETE FROM sessions WHERE user_id = ?', targetId);
      logAdminAction(
        admin.id,
        payload.isActive ? 'user.activate' : 'user.deactivate',
        `user:${targetId}`,
        payload.isActive ? 'تفعيل حساب مستخدم' : 'تعطيل حساب مستخدم',
      );
    }

    if (payload.role !== undefined) {
      run('UPDATE users SET role = ? WHERE id = ?', payload.role, targetId);
      logAdminAction(
        admin.id,
        'user.role',
        `user:${targetId}`,
        `تغيير الصلاحية إلى ${payload.role === 'admin' ? 'مشرف' : 'طالب'}`,
      );
    }

    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

adminRouter.get('/admin/subjects', (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const rows = all<{
    id: number;
    name_ar: string;
    code: string;
    curriculum_id: number;
    curriculum_name: string;
    is_active: number;
    grade_count: number;
  }>(
    `SELECT s.id, s.name_ar, s.code, s.curriculum_id, c.name_ar AS curriculum_name, s.is_active,
            (SELECT COUNT(*) FROM units un WHERE un.subject_id = s.id) AS grade_count
       FROM subjects s
       JOIN curricula c ON c.id = s.curriculum_id
      ORDER BY c.id, s.sort_order, s.id`,
  );
  res.json({
    subjects: rows.map((row) => ({
      id: row.id,
      name: row.name_ar,
      code: row.code,
      curriculumId: row.curriculum_id,
      curriculumName: row.curriculum_name,
      isActive: Boolean(row.is_active),
      unitsCount: row.grade_count,
    })),
  });
});

const subjectSchema = z.object({
  name: z.string().trim().min(2, 'اسم المادة قصير جدًا.').max(60),
  code: z.string().trim().min(2).max(10),
  curriculumId: z.number().int().positive(),
});

adminRouter.post('/admin/subjects', (req, res, next) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const payload = subjectSchema.parse(req.body);
    const curriculum = get<{ id: number }>('SELECT id FROM curricula WHERE id = ?', payload.curriculumId);
    if (!curriculum) throw new HttpError(400, 'المنهاج غير موجود.');
    const exists = get<{ id: number }>(
      'SELECT id FROM subjects WHERE curriculum_id = ? AND name_ar = ?',
      payload.curriculumId,
      payload.name,
    );
    if (exists) throw new HttpError(409, 'هذه المادة موجودة مسبقًا في هذا المنهاج.');

    const order = get<{ max: number }>(
      'SELECT COALESCE(MAX(sort_order), 0) AS max FROM subjects WHERE curriculum_id = ?',
      payload.curriculumId,
    );
    const created = run(
      'INSERT INTO subjects (curriculum_id, name_ar, code, sort_order) VALUES (?, ?, ?, ?)',
      payload.curriculumId,
      payload.name,
      payload.code.toUpperCase(),
      (order?.max ?? 0) + 1,
    );
    logAdminAction(admin.id, 'subject.create', `subject:${created.lastInsertRowid}`, `إضافة مادة ${payload.name}`);
    res.status(201).json({ id: created.lastInsertRowid });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: error.issues[0]?.message ?? 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

adminRouter.patch('/admin/subjects/:id', (req, res, next) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'معرّف المادة غير صحيح.');
    const subject = get<{ id: number; name_ar: string }>('SELECT id, name_ar FROM subjects WHERE id = ?', id);
    if (!subject) throw new HttpError(404, 'المادة غير موجودة.');

    const schema = z.object({
      name: z.string().trim().min(2).max(60).optional(),
      isActive: z.boolean().optional(),
    });
    const payload = schema.parse(req.body);

    if (payload.name) {
      const exists = get<{ id: number }>(
        'SELECT id FROM subjects WHERE name_ar = ? AND id <> ?',
        payload.name,
        id,
      );
      if (exists) throw new HttpError(409, 'اسم المادة مستخدم مسبقًا.');
      run('UPDATE subjects SET name_ar = ? WHERE id = ?', payload.name, id);
    }
    if (payload.isActive !== undefined) {
      run('UPDATE subjects SET is_active = ? WHERE id = ?', payload.isActive ? 1 : 0, id);
    }
    logAdminAction(admin.id, 'subject.update', `subject:${id}`, `تعديل مادة ${subject.name_ar}`);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

adminRouter.delete('/admin/subjects/:id', (req, res, next) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'معرّف المادة غير صحيح.');
    const subject = get<{ id: number; name_ar: string }>('SELECT id, name_ar FROM subjects WHERE id = ?', id);
    if (!subject) throw new HttpError(404, 'المادة غير موجودة.');
    run('UPDATE subjects SET is_active = 0 WHERE id = ?', id);
    logAdminAction(admin.id, 'subject.delete', `subject:${id}`, `تعطيل مادة ${subject.name_ar}`);
    res.json({ ok: true, message: 'تم تعطيل المادة. الكتب المرتبطة بها محفوظة.' });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/admin/features', (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const rows = all<{
    key: string;
    title_ar: string;
    description_ar: string;
    phase: number;
    is_enabled: number;
    href: string | null;
  }>('SELECT key, title_ar, description_ar, phase, is_enabled, href FROM feature_flags ORDER BY sort_order');
  res.json({
    features: rows.map((row) => ({
      key: row.key,
      title: row.title_ar,
      description: row.description_ar,
      phase: row.phase,
      enabled: Boolean(row.is_enabled),
      href: row.href,
    })),
  });
});

adminRouter.patch('/admin/features/:key', (req, res, next) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const key = String(req.params.key);
    const flag = get<{ key: string }>('SELECT key FROM feature_flags WHERE key = ?', key);
    if (!flag) throw new HttpError(404, 'الميزة غير موجودة.');
    const payload = z.object({ enabled: z.boolean() }).parse(req.body);
    run('UPDATE feature_flags SET is_enabled = ? WHERE key = ?', payload.enabled ? 1 : 0, key);
    logAdminAction(
      admin.id,
      'feature.toggle',
      `feature:${key}`,
      payload.enabled ? 'تفعيل ميزة' : 'تعطيل ميزة',
    );
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

adminRouter.get('/admin/logs', (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const rows = all<{
    id: number;
    action: string;
    target: string | null;
    detail: string | null;
    created_at: string;
    admin_name: string | null;
  }>(
    `SELECT l.id, l.action, l.target, l.detail, l.created_at, u.username AS admin_name
       FROM admin_activity_logs l
       LEFT JOIN users u ON u.id = l.admin_id
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 100`,
  );
  res.json({
    logs: rows.map((row) => ({
      id: row.id,
      action: row.action,
      target: row.target,
      detail: row.detail,
      createdAt: row.created_at,
      adminName: row.admin_name,
    })),
  });
});

adminRouter.get('/admin/ai-usage', (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const rows = all<{
    id: number;
    task: string;
    provider: string | null;
    model: string | null;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    status: string;
    created_at: string;
    username: string | null;
  }>(
    `SELECT l.id, l.task, l.provider, l.model, l.tokens_in, l.tokens_out, l.cost_usd, l.status, l.created_at,
            u.username
       FROM ai_usage_logs l
       LEFT JOIN users u ON u.id = l.user_id
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 100`,
  );
  const totals = get<{ requests: number; tokens: number; cost: number }>(
    `SELECT COUNT(*) AS requests, COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens, COALESCE(SUM(cost_usd), 0) AS cost
       FROM ai_usage_logs`,
  );
  res.json({
    totals: {
      requests: totals?.requests ?? 0,
      tokens: totals?.tokens ?? 0,
      costUsd: totals?.cost ?? 0,
    },
    logs: rows.map((row) => ({
      id: row.id,
      task: row.task,
      provider: row.provider,
      model: row.model,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      costUsd: row.cost_usd,
      status: row.status,
      createdAt: row.created_at,
      username: row.username,
    })),
  });
});
