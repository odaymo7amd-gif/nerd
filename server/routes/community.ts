import { Router } from 'express';
import { z } from 'zod';
import { all, get, run } from '../db.ts';
import { requireUser } from '../auth.ts';
import { HttpError, rateLimit } from '../http.ts';
import { join } from 'node:path';
import { uploadRoot } from '../storage.ts';

export const feedbackRouter = Router();
export const adsRouter = Router();

const CATEGORIES = ['technical', 'suggestion', 'ai', 'account', 'tool', 'other'] as const;

function mapReport(row: {
  id: number;
  category: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  replies_count?: number;
}) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    repliesCount: Number(row.replies_count ?? 0),
  };
}

feedbackRouter.get('/feedback', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const rows = all<{
    id: number;
    category: string;
    title: string;
    body: string;
    status: string;
    created_at: string;
    updated_at: string;
    resolved_at: string | null;
    replies_count: number;
  }>(
    `SELECT r.id, r.category, r.title, r.body, r.status, r.created_at, r.updated_at, r.resolved_at,
            (SELECT COUNT(*) FROM feedback_replies fr WHERE fr.report_id = r.id) AS replies_count
       FROM feedback_reports r
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
      LIMIT 50`,
    user.id,
  );
  res.json({ reports: rows.map(mapReport) });
});

const createReportSchema = z.object({
  category: z.enum(CATEGORIES),
  title: z.string().trim().min(5, 'اكتب عنوانًا واضحًا من 5 أحرف على الأقل.').max(120),
  body: z.string().trim().min(20, 'اكتب تفاصيل أكثر (20 حرفًا على الأقل).').max(4_000),
});

feedbackRouter.post(
  '/feedback',
  rateLimit({ key: 'feedback-create', limit: 5, windowMs: 60 * 60 * 1000 }),
  (req, res, next) => {
    try {
      const user = requireUser(req, res);
      if (!user) return;
      const enabled = get<{ value: string }>(
        "SELECT value FROM app_settings WHERE key = 'feedback_enabled'",
      )?.value;
      if (enabled === '0') throw new HttpError(503, 'مركز الشكاوى والاقتراحات متوقف مؤقتًا.', 'feedback_disabled');
      const payload = createReportSchema.parse(req.body);
      const result = run(
        `INSERT INTO feedback_reports (user_id, category, title, body) VALUES (?, ?, ?, ?)`,
        user.id,
        payload.category,
        payload.title,
        payload.body,
      );
      run(
        `INSERT INTO activity_log (user_id, kind, title, detail) VALUES (?, 'feedback', 'إرسال بلاغ', ?)`,
        user.id,
        payload.title,
      );
      res.status(201).json({ id: result.lastInsertRowid, message: 'وصل بلاغك إلى فريق نيرد.' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: { message: error.issues[0]?.message ?? 'بيانات غير صحيحة.' } });
        return;
      }
      next(error);
    }
  },
);

feedbackRouter.get('/feedback/:id', (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف البلاغ غير صحيح.');
    const report = get<{
      id: number;
      category: string;
      title: string;
      body: string;
      status: string;
      created_at: string;
      updated_at: string;
      resolved_at: string | null;
    }>(
      `SELECT id, category, title, body, status, created_at, updated_at, resolved_at
         FROM feedback_reports WHERE id = ? AND user_id = ?`,
      id,
      user.id,
    );
    if (!report) throw new HttpError(404, 'البلاغ غير موجود.');
    const replies = all<{
      id: number;
      body: string;
      author_role: string;
      created_at: string;
      author_name: string | null;
    }>(
      `SELECT fr.id, fr.body, fr.author_role, fr.created_at, u.username AS author_name
         FROM feedback_replies fr
         LEFT JOIN users u ON u.id = fr.author_id
        WHERE fr.report_id = ? ORDER BY fr.created_at, fr.id`,
      id,
    );
    res.json({
      report: mapReport({ ...report, replies_count: replies.length }),
      replies: replies.map((reply) => ({
        id: reply.id,
        body: reply.body,
        authorRole: reply.author_role,
        authorName: reply.author_role === 'admin' ? 'فريق نيرد' : reply.author_name,
        createdAt: reply.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ---------- الإعلانات الداخلية ----------
adsRouter.get('/ads/active', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const rows = all<{
    id: number;
    title: string;
    body: string;
    image_path: string | null;
    audience: string;
    starts_at: string | null;
    ends_at: string | null;
  }>(
    `SELECT id, title, body, image_path, audience, starts_at, ends_at
       FROM ads
      WHERE is_active = 1
        AND (starts_at IS NULL OR starts_at <= datetime('now'))
        AND (ends_at IS NULL OR ends_at >= datetime('now'))
      ORDER BY created_at DESC`,
  );
  const meta = get<{ created_at: string; last_active_at: string | null }>(
    'SELECT created_at, last_active_at FROM users WHERE id = ?',
    user.id,
  );
  const eligible = rows.filter((ad) => {
    if (ad.audience === 'new') return Boolean(meta && meta.created_at >= sevenDaysAgo());
    if (ad.audience === 'active') return Boolean(meta?.last_active_at && meta.last_active_at >= sevenDaysAgo());
    return true;
  });
  const ad = eligible[0];
  res.json({
    ad: ad
      ? {
          id: ad.id,
          title: ad.title,
          body: ad.body,
          imageUrl: ad.image_path ? `/api/ads/${ad.id}/image` : null,
          startsAt: ad.starts_at,
          endsAt: ad.ends_at,
        }
      : null,
  });
});

function sevenDaysAgo(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
}

adsRouter.get('/ads/:id/image', (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'معرّف الإعلان غير صحيح.');
    const ad = get<{ image_path: string | null }>('SELECT image_path FROM ads WHERE id = ?', id);
    if (!ad?.image_path) throw new HttpError(404, 'لا توجد صورة لهذا الإعلان.');
    const absolute = join(uploadRoot, 'ads', ad.image_path);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(absolute);
  } catch (error) {
    next(error);
  }
});
