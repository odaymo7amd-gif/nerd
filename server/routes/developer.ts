import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { all, get, run } from '../db.ts';
import {
  createNotification,
  requireDeveloper,
  type AuthUser,
} from '../auth.ts';
import { HttpError } from '../http.ts';
import { developerUserId } from '../developerConfig.ts';
import { removeUserUploadDirectory, uploadRoot } from '../storage.ts';
import { aiProviderStatus, probeProvider, taskRoutingOverview } from '../ai/router.ts';
import { lastProviderError, providerEventSummary } from '../ai/monitor.ts';
import { runtimeMetrics } from '../metrics.ts';
import { maintenanceState, saveSetting, settingEnabled, settingValue } from '../developer/runtime.ts';

export const developerRouter = Router();

type RangeKey = 'today' | '7d' | '30d' | '90d' | 'all';

const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'اليوم',
  '7d': 'آخر 7 أيام',
  '30d': 'آخر 30 يومًا',
  '90d': 'آخر 90 يومًا',
  all: 'كل الفترات',
};

function parseRange(raw: unknown): RangeKey {
  return raw === 'today' || raw === '7d' || raw === '30d' || raw === '90d' || raw === 'all'
    ? raw
    : '7d';
}

function startOfUtcDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function sqlDate(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function rangeBounds(range: RangeKey) {
  const days = range === 'today' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : null;
  const now = new Date();
  const from = days ? new Date(startOfUtcDay(now).getTime() - (days - 1) * 86_400_000) : new Date(0);
  const previousFrom = days ? new Date(from.getTime() - days * 86_400_000) : null;
  const seriesFrom = new Date(startOfUtcDay(now).getTime() - 29 * 86_400_000);
  return {
    range,
    label: RANGE_LABELS[range],
    days,
    from: sqlDate(from),
    previousFrom: previousFrom ? sqlDate(previousFrom) : null,
    seriesFrom: sqlDate(range === 'today' ? startOfUtcDay(now) : seriesFrom),
  };
}

function dateKeys(from: string): string[] {
  const start = new Date(`${from.slice(0, 10)}T00:00:00Z`);
  const end = startOfUtcDay();
  const keys: string[] = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    keys.push(cursor.toISOString().slice(0, 10));
  }
  return keys.slice(-31);
}

function count(sql: string, ...params: Array<string | number | null>): number {
  return Number(get<{ n: number }>(sql, ...params)?.n ?? 0);
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function adminOf(res: { locals: Record<string, unknown> }): AuthUser {
  return res.locals.developer as AuthUser;
}

function audit(adminId: number, action: string, target: string, detail: string): void {
  run(
    'INSERT INTO admin_activity_logs (admin_id, action, target, detail) VALUES (?, ?, ?, ?)',
    adminId,
    action,
    target,
    detail,
  );
}

function sameOriginOnly(req: { method: string; get(name: string): string | undefined }): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

developerRouter.use((req, res, next) => {
  const admin = requireDeveloper(req, res);
  if (!admin) return;
  if (!sameOriginOnly(req)) {
    res.status(403).json({ error: { message: 'طلب إداري من أصل غير موثوق.' } });
    return;
  }
  res.locals.developer = admin;
  next();
});

const ACTIVITY_FEATURE: Record<string, string> = {
  books: 'books',
  content: 'content-library',
  test: 'tests',
  summary: 'summary',
  schedule: 'schedule',
  challenge: 'daily-challenge',
};

function taskFeature(task: string): string | null {
  const value = task.toLowerCase();
  if (value.includes('teacher')) return 'teacher';
  if (value.includes('solver')) return 'solver';
  if (value.includes('grader')) return 'grader';
  if (value.includes('expression') || value.includes('writing')) return 'expression';
  if (value.includes('english')) return 'english-grammar';
  if (value.includes('arabic')) return 'arabic-grammar';
  if (value.includes('chat')) return 'ai-chat';
  if (value.includes('summary') || value.includes('kit')) return 'summary';
  if (value.includes('test') || value.includes('exam') || value.includes('quiz')) return 'tests';
  if (value.includes('bank')) return 'question-bank';
  if (value.includes('search')) return 'global-search';
  if (value.includes('content')) return 'content-library';
  return null;
}

export interface ToolUsage {
  key: string;
  title: string;
  href: string | null;
  enabled: boolean;
  uses: number;
  users: number;
  share: number;
}

function toolUsage(from: string, userId?: number): ToolUsage[] {
  const userFilter = userId ? ' AND user_id = ?' : '';
  const activity = all<{ kind: string; uses: number; users: number }>(
    `SELECT kind, COUNT(*) AS uses, COUNT(DISTINCT user_id) AS users
       FROM activity_log
      WHERE created_at >= ?${userFilter}
      GROUP BY kind`,
    ...(userId ? [from, userId] : [from]),
  );
  const ai = all<{ task: string; uses: number; users: number }>(
    `SELECT task, COUNT(*) AS uses, COUNT(DISTINCT user_id) AS users
       FROM ai_usage_logs
      WHERE status = 'success' AND created_at >= ?${userFilter}
      GROUP BY task`,
    ...(userId ? [from, userId] : [from]),
  );
  const flags = all<{ key: string; title_ar: string; href: string | null; is_enabled: number }>(
    'SELECT key, title_ar, href, is_enabled FROM feature_flags ORDER BY sort_order',
  );
  const aggregate = new Map<string, { uses: number; users: number }>();
  for (const row of activity) {
    const key = ACTIVITY_FEATURE[row.kind];
    if (!key) continue;
    const current = aggregate.get(key) ?? { uses: 0, users: 0 };
    current.uses += Number(row.uses);
    current.users += Number(row.users);
    aggregate.set(key, current);
  }
  for (const row of ai) {
    const key = taskFeature(row.task);
    if (!key) continue;
    // لا نضاعف عدّ الاختبارات/الملخصات: نشاط المستخدم يغطيها بالفعل.
    if (['tests', 'summary', 'content-library', 'question-bank'].includes(key)) {
      const hasActivity = activity.some((item) => ACTIVITY_FEATURE[item.kind] === key);
      if (hasActivity) continue;
    }
    const current = aggregate.get(key) ?? { uses: 0, users: 0 };
    current.uses += Number(row.uses);
    current.users += Number(row.users);
    aggregate.set(key, current);
  }
  const total = [...aggregate.values()].reduce((sum, item) => sum + item.uses, 0);
  return flags
    .map((flag) => {
      const value = aggregate.get(flag.key) ?? { uses: 0, users: 0 };
      return {
        key: flag.key,
        title: flag.title_ar,
        href: flag.href,
        enabled: Boolean(flag.is_enabled),
        uses: value.uses,
        users: value.users,
        share: total > 0 ? Number(((value.uses / total) * 100).toFixed(1)) : 0,
      };
    })
    .sort((a, b) => b.uses - a.uses || a.title.localeCompare(b.title, 'ar'));
}

function providerCards(from: string) {
  const configured = aiProviderStatus();
  const events = providerEventSummary(from);
  return configured.providers.map((provider) => {
    const event = events.find((item) => item.providerId === provider.id);
    const lastError = lastProviderError(provider.id);
    const lastHealth = get<{ status: string; created_at: string; latency_ms: number }>(
      `SELECT status, created_at, latency_ms FROM ai_provider_events
        WHERE provider_id = ? AND task = 'health-check'
        ORDER BY id DESC LIMIT 1`,
      provider.id,
    );
    return {
      ...provider,
      configured: provider.configured,
      requests: event?.requests ?? 0,
      successes: event?.successes ?? 0,
      failures: event?.failures ?? 0,
      successRate: event && event.requests > 0 ? Number(((event.successes / event.requests) * 100).toFixed(1)) : null,
      avgLatencyMs: event?.avgLatencyMs ?? 0,
      tokensIn: event?.tokensIn ?? 0,
      tokensOut: event?.tokensOut ?? 0,
      costUsd: event?.costUsd ?? 0,
      fallbacks: event?.fallbacks ?? 0,
      lastSeenAt: event?.lastSeenAt ?? null,
      lastError: lastError?.message ?? null,
      lastErrorAt: lastError?.createdAt ?? null,
      lastHealthCheck: lastHealth
        ? { status: lastHealth.status, createdAt: lastHealth.created_at, latencyMs: lastHealth.latency_ms }
        : null,
      connection:
        !provider.configured
          ? 'unconfigured'
          : lastHealth?.status === 'success'
            ? 'verified'
            : lastHealth?.status === 'failed'
              ? 'failed'
              : 'unverified',
    };
  });
}

developerRouter.get('/context', (_req, res) => {
  const admin = adminOf(res);
  const state = maintenanceState();
  res.json({
    admin: {
      username: admin.username,
      email: admin.email,
      memberSince: admin.createdAt,
    },
    maintenance: state,
    services: {
      database: 'ok',
      server: 'ok',
      aiConfigured: aiProviderStatus().providers.some((provider) => provider.configured),
    },
    counts: {
      unreadFeedback: count("SELECT COUNT(*) AS n FROM feedback_reports WHERE status IN ('new', 'reviewing')"),
      scheduledNotifications: count("SELECT COUNT(*) AS n FROM notification_campaigns WHERE status = 'scheduled'"),
      disabledTools: count('SELECT COUNT(*) AS n FROM feature_flags WHERE is_enabled = 0'),
    },
  });
});

developerRouter.get('/overview', (req, res) => {
  const bounds = rangeBounds(parseRange(req.query.range));
  const rangeEnd = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const metrics = {
    users: count('SELECT COUNT(*) AS n FROM users'),
    activeToday: count("SELECT COUNT(*) AS n FROM users WHERE last_active_at >= datetime('now', 'start of day')"),
    newUsers: count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', bounds.from),
    disabledUsers: count('SELECT COUNT(*) AS n FROM users WHERE is_active = 0'),
    aiToday: count("SELECT COUNT(*) AS n FROM ai_usage_logs WHERE created_at >= datetime('now', 'start of day')"),
    aiRequests: count('SELECT COUNT(*) AS n FROM ai_usage_logs WHERE created_at >= ?', bounds.from),
    aiSuccess: count("SELECT COUNT(*) AS n FROM ai_usage_logs WHERE status = 'success' AND created_at >= ?", bounds.from),
    aiFailed: count("SELECT COUNT(*) AS n FROM ai_usage_logs WHERE status = 'failed' AND created_at >= ?", bounds.from),
    activeTools: count('SELECT COUNT(*) AS n FROM feature_flags WHERE is_enabled = 1'),
    feedbackOpen: count("SELECT COUNT(*) AS n FROM feedback_reports WHERE status IN ('new', 'reviewing', 'in_progress')"),
  };
  const previous = bounds.previousFrom
    ? {
        newUsers: count(
          'SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?',
          bounds.previousFrom,
          bounds.from,
        ),
        aiRequests: count(
          'SELECT COUNT(*) AS n FROM ai_usage_logs WHERE created_at >= ? AND created_at < ?',
          bounds.previousFrom,
          bounds.from,
        ),
      }
    : null;

  const dates = dateKeys(bounds.seriesFrom);
  const signupRows = all<{ day: string; count: number }>(
    `SELECT date(created_at) AS day, COUNT(*) AS count FROM users
      WHERE created_at >= ? GROUP BY date(created_at)`,
    bounds.seriesFrom,
  );
  const aiRows = all<{ day: string; count: number; success: number; failed: number }>(
    `SELECT date(created_at) AS day, COUNT(*) AS count,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM ai_usage_logs WHERE created_at >= ? GROUP BY date(created_at)`,
    bounds.seriesFrom,
  );
  const activeRows = all<{ day: string; count: number }>(
    `SELECT date(created_at) AS day, COUNT(DISTINCT user_id) AS count
       FROM activity_log WHERE created_at >= ? GROUP BY date(created_at)`,
    bounds.seriesFrom,
  );
  const providerEvents = all<{
    id: number;
    provider_name: string;
    task: string;
    error_code: string | null;
    error_message: string | null;
    created_at: string;
  }>(
    `SELECT id, provider_name, task, error_code, error_message, created_at
       FROM ai_provider_events WHERE status = 'failed'
      ORDER BY id DESC LIMIT 5`,
  );
  const systemErrors = all<{ id: number; source: string; code: string | null; message: string; created_at: string }>(
    'SELECT id, source, code, message, created_at FROM system_errors ORDER BY id DESC LIMIT 5',
  );
  const recentActivity = all<{
    id: number;
    kind: string;
    title: string;
    detail: string | null;
    created_at: string;
    username: string | null;
  }>(
    `SELECT a.id, a.kind, a.title, a.detail, a.created_at, u.username
       FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.id DESC LIMIT 8`,
  );

  res.json({
    range: bounds.range,
    rangeLabel: bounds.label,
    from: bounds.from,
    generatedAt: rangeEnd,
    metrics,
    deltas: {
      newUsers: previous ? percentChange(metrics.newUsers, previous.newUsers) : null,
      aiRequests: previous ? percentChange(metrics.aiRequests, previous.aiRequests) : null,
    },
    successRate:
      metrics.aiSuccess + metrics.aiFailed > 0
        ? Number(((metrics.aiSuccess / (metrics.aiSuccess + metrics.aiFailed)) * 100).toFixed(1))
        : null,
    failureRate:
      metrics.aiSuccess + metrics.aiFailed > 0
        ? Number(((metrics.aiFailed / (metrics.aiSuccess + metrics.aiFailed)) * 100).toFixed(1))
        : null,
    series: dates.map((day) => ({
      day,
      signups: Number(signupRows.find((row) => row.day === day)?.count ?? 0),
      ai: Number(aiRows.find((row) => row.day === day)?.count ?? 0),
      active: Number(activeRows.find((row) => row.day === day)?.count ?? 0),
    })),
    topTools: toolUsage(bounds.from).slice(0, 8),
    providers: providerCards(bounds.from),
    errors: [
      ...providerEvents.map((row) => ({
        id: `ai-${row.id}`,
        source: `AI · ${row.provider_name}`,
        title: row.error_code ?? row.task,
        message: row.error_message ?? 'فشل طلب ذكاء اصطناعي.',
        createdAt: row.created_at,
      })),
      ...systemErrors.map((row) => ({
        id: `sys-${row.id}`,
        source: row.source,
        title: row.code ?? 'server_error',
        message: row.message,
        createdAt: row.created_at,
      })),
    ]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8),
    activity: recentActivity.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      detail: row.detail,
      username: row.username,
      createdAt: row.created_at,
    })),
  });
});

// ---------- المستخدمون ----------
function usersQuery(input: {
  q: string;
  status: string;
  sort: string;
  page: number;
  limit: number;
}) {
  const conditions = ['1 = 1'];
  const params: Array<string | number> = [];
  if (input.q) {
    conditions.push('(u.username LIKE ? OR u.email LIKE ? OR CAST(u.id AS TEXT) = ?)');
    const like = `%${input.q}%`;
    params.push(like, like, input.q);
  }
  if (input.status === 'active') conditions.push('u.is_active = 1');
  if (input.status === 'disabled') conditions.push('u.is_active = 0');
  if (input.status === 'new') conditions.push("u.created_at >= datetime('now', '-7 days')");
  const order =
    input.sort === 'oldest'
      ? 'u.created_at ASC'
      : input.sort === 'name'
        ? 'u.username COLLATE NOCASE ASC'
        : input.sort === 'active'
          ? 'COALESCE(u.last_active_at, u.created_at) DESC'
          : 'u.created_at DESC';
  return { where: conditions.join(' AND '), params, order };
}

developerRouter.get('/users', (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(50, Math.max(5, Number(req.query.limit ?? 20) || 20));
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  const status = String(req.query.status ?? 'all');
  const sort = String(req.query.sort ?? 'newest');
  const query = usersQuery({ q, status, sort, page, limit });
  const total = count(`SELECT COUNT(*) AS n FROM users u WHERE ${query.where}`, ...query.params);
  const rows = all<{
    id: number;
    username: string;
    email: string;
    role: string;
    is_active: number;
    created_at: string;
    last_active_at: string | null;
    grade_name: string | null;
    ai_requests: number;
    ai_failures: number;
    tests_count: number;
    summaries_count: number;
    contents_count: number;
    top_kind: string | null;
  }>(
    `SELECT u.id, u.username, u.email, u.role, u.is_active, u.created_at, u.last_active_at,
            g.name_ar AS grade_name,
            (SELECT COUNT(*) FROM ai_usage_logs l WHERE l.user_id = u.id) AS ai_requests,
            (SELECT COUNT(*) FROM ai_usage_logs l WHERE l.user_id = u.id AND l.status = 'failed') AS ai_failures,
            (SELECT COUNT(*) FROM tests t WHERE t.user_id = u.id) AS tests_count,
            (SELECT COUNT(*) FROM summaries s WHERE s.user_id = u.id) AS summaries_count,
            (SELECT COUNT(*) FROM study_contents c WHERE c.user_id = u.id) AS contents_count,
            (SELECT a.kind FROM activity_log a WHERE a.user_id = u.id
              GROUP BY a.kind ORDER BY COUNT(*) DESC, MAX(a.created_at) DESC LIMIT 1) AS top_kind
       FROM users u
       LEFT JOIN grade_levels g ON g.id = u.grade_level_id
      WHERE ${query.where}
      ORDER BY ${query.order}
      LIMIT ? OFFSET ?`,
    ...query.params,
    limit,
    (page - 1) * limit,
  );
  res.json({
    users: rows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      role: row.role,
      isActive: Boolean(row.is_active),
      isDeveloper: row.id === developerUserId(),
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
      gradeName: row.grade_name,
      aiRequests: Number(row.ai_requests),
      aiFailures: Number(row.ai_failures),
      testsCount: Number(row.tests_count),
      summariesCount: Number(row.summaries_count),
      contentsCount: Number(row.contents_count),
      topTool: row.top_kind ? ACTIVITY_FEATURE[row.top_kind] ?? row.top_kind : null,
    })),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    counts: {
      all: count('SELECT COUNT(*) AS n FROM users'),
      active: count('SELECT COUNT(*) AS n FROM users WHERE is_active = 1'),
      disabled: count('SELECT COUNT(*) AS n FROM users WHERE is_active = 0'),
      new: count("SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-7 days')"),
    },
  });
});

developerRouter.get('/users/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف المستخدم غير صحيح.');
    const user = get<{
      id: number;
      username: string;
      email: string;
      role: string;
      is_active: number;
      created_at: string;
      last_active_at: string | null;
      onboarded_at: string | null;
      grade_name: string | null;
      curriculum_name: string | null;
      country_name: string | null;
      theme: string;
    }>(
      `SELECT u.id, u.username, u.email, u.role, u.is_active, u.created_at, u.last_active_at,
              u.onboarded_at, u.theme, g.name_ar AS grade_name,
              c.name_ar AS curriculum_name, co.name_ar AS country_name
         FROM users u
         LEFT JOIN grade_levels g ON g.id = u.grade_level_id
         LEFT JOIN curricula c ON c.id = u.curriculum_id
         LEFT JOIN countries co ON co.id = u.country_id
        WHERE u.id = ?`,
      id,
    );
    if (!user) throw new HttpError(404, 'المستخدم غير موجود.');
    const stats = get<{
      study_minutes: number;
      tests_completed: number;
      points: number;
      streak_days: number;
      questions_answered: number;
    }>(
      `SELECT study_minutes, tests_completed, points, streak_days, questions_answered
         FROM user_statistics WHERE user_id = ?`,
      id,
    );
    const counts = get<{
      contents: number;
      tests: number;
      summaries: number;
      books: number;
      conversations: number;
      feedback: number;
      sessions: number;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM study_contents WHERE user_id = ?) AS contents,
        (SELECT COUNT(*) FROM tests WHERE user_id = ?) AS tests,
        (SELECT COUNT(*) FROM summaries WHERE user_id = ?) AS summaries,
        (SELECT COUNT(*) FROM books WHERE user_id = ? AND is_content_source = 0) AS books,
        (SELECT COUNT(*) FROM chat_conversations WHERE user_id = ?) AS conversations,
        (SELECT COUNT(*) FROM feedback_reports WHERE user_id = ?) AS feedback,
        (SELECT COUNT(*) FROM sessions WHERE user_id = ?) AS sessions`,
      id,
      id,
      id,
      id,
      id,
      id,
      id,
    );
    const ai = get<{
      requests: number;
      success: number;
      failed: number;
      tokens_in: number;
      tokens_out: number;
      cost: number;
    }>(
      `SELECT COUNT(*) AS requests,
              SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              COALESCE(SUM(tokens_in), 0) AS tokens_in,
              COALESCE(SUM(tokens_out), 0) AS tokens_out,
              COALESCE(SUM(cost_usd), 0) AS cost
         FROM ai_usage_logs WHERE user_id = ?`,
      id,
    );
    const activity = all<{ id: number; kind: string; title: string; detail: string | null; created_at: string }>(
      `SELECT id, kind, title, detail, created_at FROM activity_log
        WHERE user_id = ? ORDER BY id DESC LIMIT 25`,
      id,
    );
    const aiLogs = all<{
      id: number;
      task: string;
      provider: string | null;
      model: string | null;
      tokens_in: number;
      tokens_out: number;
      cost_usd: number;
      status: string;
      created_at: string;
    }>(
      `SELECT id, task, provider, model, tokens_in, tokens_out, cost_usd, status, created_at
         FROM ai_usage_logs WHERE user_id = ? ORDER BY id DESC LIMIT 25`,
      id,
    );
    const reports = all<{
      id: number;
      title: string;
      category: string;
      status: string;
      created_at: string;
    }>(
      `SELECT id, title, category, status, created_at FROM feedback_reports
        WHERE user_id = ? ORDER BY id DESC LIMIT 8`,
      id,
    );
    res.json({
      user: {
        ...user,
        isActive: Boolean(user.is_active),
        isDeveloper: user.id === developerUserId(),
        onboarded: Boolean(user.onboarded_at),
      },
      stats: {
        studyMinutes: Number(stats?.study_minutes ?? 0),
        testsCompleted: Number(stats?.tests_completed ?? 0),
        points: Number(stats?.points ?? 0),
        streakDays: Number(stats?.streak_days ?? 0),
        questionsAnswered: Number(stats?.questions_answered ?? 0),
      },
      counts,
      ai: {
        requests: Number(ai?.requests ?? 0),
        success: Number(ai?.success ?? 0),
        failed: Number(ai?.failed ?? 0),
        tokensIn: Number(ai?.tokens_in ?? 0),
        tokensOut: Number(ai?.tokens_out ?? 0),
        costUsd: Number(ai?.cost ?? 0),
      },
      topTools: toolUsage('1970-01-01 00:00:00', id).slice(0, 5),
      activity: activity.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        detail: row.detail,
        createdAt: row.created_at,
      })),
      aiLogs: aiLogs.map((row) => ({
        id: row.id,
        task: row.task,
        provider: row.provider,
        model: row.model,
        tokensIn: row.tokens_in,
        tokensOut: row.tokens_out,
        costUsd: row.cost_usd,
        status: row.status,
        createdAt: row.created_at,
      })),
      feedback: reports.map((row) => ({
        id: row.id,
        title: row.title,
        category: row.category,
        status: row.status,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

developerRouter.patch('/users/:id', (req, res, next) => {
  try {
    const admin = adminOf(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف المستخدم غير صحيح.');
    if (id === developerUserId()) throw new HttpError(400, 'لا يمكن تعطيل حساب المطوّر الرئيسي.');
    const target = get<{ id: number; is_active: number }>('SELECT id, is_active FROM users WHERE id = ?', id);
    if (!target) throw new HttpError(404, 'المستخدم غير موجود.');
    const payload = z.object({ isActive: z.boolean() }).parse(req.body);
    run('UPDATE users SET is_active = ? WHERE id = ?', payload.isActive ? 1 : 0, id);
    if (!payload.isActive) run('DELETE FROM sessions WHERE user_id = ?', id);
    audit(
      admin.id,
      payload.isActive ? 'user.activate' : 'user.deactivate',
      `user:${id}`,
      payload.isActive ? 'إعادة تفعيل حساب' : 'تعطيل حساب وإلغاء جلساته',
    );
    res.json({ ok: true, isActive: payload.isActive });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

developerRouter.delete('/users/:id', async (req, res, next) => {
  try {
    const admin = adminOf(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف المستخدم غير صحيح.');
    if (id === developerUserId() || id === admin.id) {
      throw new HttpError(400, 'لا يمكن حذف حساب المطوّر الرئيسي.');
    }
    const target = get<{ id: number; username: string }>('SELECT id, username FROM users WHERE id = ?', id);
    if (!target) throw new HttpError(404, 'المستخدم غير موجود.');
    const payload = z
      .object({ confirmation: z.literal('DELETE'), username: z.string().trim() })
      .parse(req.body);
    if (payload.username !== target.username) {
      throw new HttpError(400, 'اسم المستخدم للتأكيد غير مطابق.');
    }

    await removeUserUploadDirectory(id).catch((error) => {
      console.error('[nerd/developer] تعذّر حذف ملفات المستخدم:', (error as Error).message);
    });
    run('DELETE FROM users WHERE id = ?', id);
    audit(admin.id, 'user.delete', `user:${id}`, 'حذف حساب نهائيًا مع بياناته وملفاته (المعرّف فقط).');
    res.json({ ok: true, message: 'تم حذف الحساب وبياناته وملفاته نهائيًا.' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: 'تأكيد الحذف غير صحيح.' } });
      return;
    }
    next(error);
  }
});

// ---------- التحليلات ----------
function analyticsPayload(range: RangeKey) {
  const bounds = rangeBounds(range);
  const dates = dateKeys(bounds.seriesFrom);
  const newUsers = count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', bounds.from);
  const activeToday = count(
    "SELECT COUNT(DISTINCT user_id) AS n FROM activity_log WHERE created_at >= datetime('now', 'start of day')",
  );
  const wau = count("SELECT COUNT(*) AS n FROM users WHERE last_active_at >= datetime('now', '-7 days')");
  const mau = count("SELECT COUNT(*) AS n FROM users WHERE last_active_at >= datetime('now', '-30 days')");
  const eligible7 = count("SELECT COUNT(*) AS n FROM users WHERE created_at <= datetime('now', '-7 days')");
  const retained7 = count(
    "SELECT COUNT(*) AS n FROM users WHERE created_at <= datetime('now', '-7 days') AND last_active_at >= datetime('now', '-7 days')",
  );
  const eligible30 = count("SELECT COUNT(*) AS n FROM users WHERE created_at <= datetime('now', '-30 days')");
  const churned30 = count(
    "SELECT COUNT(*) AS n FROM users WHERE created_at <= datetime('now', '-30 days') AND (last_active_at IS NULL OR last_active_at < datetime('now', '-30 days'))",
  );
  const signupRows = all<{ day: string; count: number }>(
    'SELECT date(created_at) AS day, COUNT(*) AS count FROM users WHERE created_at >= ? GROUP BY date(created_at)',
    bounds.seriesFrom,
  );
  const activeRows = all<{ day: string; count: number }>(
    `SELECT date(created_at) AS day, COUNT(DISTINCT user_id) AS count
       FROM activity_log WHERE created_at >= ? GROUP BY date(created_at)`,
    bounds.seriesFrom,
  );
  const aiRows = all<{ day: string; count: number; success: number; failed: number; tokens: number; cost: number }>(
    `SELECT date(created_at) AS day, COUNT(*) AS count,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens,
            COALESCE(SUM(cost_usd), 0) AS cost
       FROM ai_usage_logs WHERE created_at >= ? GROUP BY date(created_at)`,
    bounds.seriesFrom,
  );
  const providers = all<{
    provider: string;
    model: string | null;
    requests: number;
    success: number;
    failed: number;
    tokens: number;
    cost: number;
  }>(
    `SELECT COALESCE(provider, 'غير معروف') AS provider, model,
            COUNT(*) AS requests,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens,
            COALESCE(SUM(cost_usd), 0) AS cost
       FROM ai_usage_logs WHERE created_at >= ?
      GROUP BY provider, model ORDER BY requests DESC`,
    bounds.from,
  );
  const totals = get<{
    ai_requests: number;
    ai_success: number;
    ai_failed: number;
    tokens: number;
    cost: number;
    tests: number;
    summaries: number;
    contents: number;
    books: number;
    questions: number;
  }>(
    `SELECT
      (SELECT COUNT(*) FROM ai_usage_logs WHERE created_at >= ?) AS ai_requests,
      (SELECT COUNT(*) FROM ai_usage_logs WHERE status = 'success' AND created_at >= ?) AS ai_success,
      (SELECT COUNT(*) FROM ai_usage_logs WHERE status = 'failed' AND created_at >= ?) AS ai_failed,
      (SELECT COALESCE(SUM(tokens_in + tokens_out), 0) FROM ai_usage_logs WHERE created_at >= ?) AS tokens,
      (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage_logs WHERE created_at >= ?) AS cost,
      (SELECT COUNT(*) FROM tests WHERE created_at >= ?) AS tests,
      (SELECT COUNT(*) FROM summaries WHERE created_at >= ?) AS summaries,
      (SELECT COUNT(*) FROM study_contents WHERE created_at >= ?) AS contents,
      (SELECT COUNT(*) FROM books WHERE created_at >= ?) AS books,
      (SELECT COUNT(*) FROM questions WHERE created_at >= ?) AS questions`,
    bounds.from,
    bounds.from,
    bounds.from,
    bounds.from,
    bounds.from,
    bounds.from,
    bounds.from,
    bounds.from,
    bounds.from,
  );
  const previous = bounds.previousFrom
    ? {
        newUsers: count(
          'SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?',
          bounds.previousFrom,
          bounds.from,
        ),
        aiRequests: count(
          'SELECT COUNT(*) AS n FROM ai_usage_logs WHERE created_at >= ? AND created_at < ?',
          bounds.previousFrom,
          bounds.from,
        ),
      }
    : null;

  return {
    range: bounds.range,
    rangeLabel: bounds.label,
    generatedAt: new Date().toISOString(),
    metrics: {
      totalUsers: count('SELECT COUNT(*) AS n FROM users'),
      newUsers,
      activeToday,
      wau,
      mau,
      retentionRate: eligible7 > 0 ? Number(((retained7 / eligible7) * 100).toFixed(1)) : null,
      churnRate: eligible30 > 0 ? Number(((churned30 / eligible30) * 100).toFixed(1)) : null,
      aiRequests: Number(totals?.ai_requests ?? 0),
      aiSuccess: Number(totals?.ai_success ?? 0),
      aiFailed: Number(totals?.ai_failed ?? 0),
      tokens: Number(totals?.tokens ?? 0),
      costUsd: Number(totals?.cost ?? 0),
      tests: Number(totals?.tests ?? 0),
      summaries: Number(totals?.summaries ?? 0),
      contents: Number(totals?.contents ?? 0),
      books: Number(totals?.books ?? 0),
      questions: Number(totals?.questions ?? 0),
    },
    deltas: {
      newUsers: previous ? percentChange(newUsers, previous.newUsers) : null,
      aiRequests: previous ? percentChange(Number(totals?.ai_requests ?? 0), previous.aiRequests) : null,
    },
    series: dates.map((day) => {
      const signup = signupRows.find((row) => row.day === day);
      const active = activeRows.find((row) => row.day === day);
      const ai = aiRows.find((row) => row.day === day);
      return {
        day,
        newUsers: Number(signup?.count ?? 0),
        activeUsers: Number(active?.count ?? 0),
        aiRequests: Number(ai?.count ?? 0),
        aiSuccess: Number(ai?.success ?? 0),
        aiFailed: Number(ai?.failed ?? 0),
        tokens: Number(ai?.tokens ?? 0),
        costUsd: Number(ai?.cost ?? 0),
      };
    }),
    tools: toolUsage(bounds.from),
    providers: providers.map((row) => ({
      provider: row.provider,
      model: row.model,
      requests: Number(row.requests),
      success: Number(row.success),
      failed: Number(row.failed),
      successRate:
        Number(row.requests) > 0 ? Number(((Number(row.success) / Number(row.requests)) * 100).toFixed(1)) : null,
      tokens: Number(row.tokens),
      costUsd: Number(row.cost),
    })),
  };
}

developerRouter.get('/analytics', (req, res) => {
  res.json(analyticsPayload(parseRange(req.query.range)));
});

developerRouter.get('/analytics/export', (req, res) => {
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  const payload = analyticsPayload(parseRange(req.query.range));
  const summary = [
    { المؤشر: 'الفترة', القيمة: payload.rangeLabel },
    { المؤشر: 'إجمالي المستخدمين', القيمة: payload.metrics.totalUsers },
    { المؤشر: 'مستخدمون جدد', القيمة: payload.metrics.newUsers },
    { المؤشر: 'نشطون اليوم', القيمة: payload.metrics.activeToday },
    { المؤشر: 'نشطون أسبوعيًا', القيمة: payload.metrics.wau },
    { المؤشر: 'نشطون شهريًا', القيمة: payload.metrics.mau },
    { المؤشر: 'معدل العودة', القيمة: payload.metrics.retentionRate ?? 'غير متاح' },
    { المؤشر: 'طلبات الذكاء الاصطناعي', القيمة: payload.metrics.aiRequests },
    { المؤشر: 'طلبات ناجحة', القيمة: payload.metrics.aiSuccess },
    { المؤشر: 'طلبات فاشلة', القيمة: payload.metrics.aiFailed },
    { المؤشر: 'إجمالي الرموز', القيمة: payload.metrics.tokens },
    { المؤشر: 'التكلفة التقديرية', القيمة: payload.metrics.costUsd },
    { المؤشر: 'اختبارات منشأة', القيمة: payload.metrics.tests },
    { المؤشر: 'ملخصات منشأة', القيمة: payload.metrics.summaries },
    { المؤشر: 'محتوى مرفوع', القيمة: payload.metrics.contents },
  ];
  const daily = payload.series.map((row) => ({
    اليوم: row.day,
    'مستخدمون جدد': row.newUsers,
    'مستخدمون نشطون': row.activeUsers,
    'طلبات AI': row.aiRequests,
    'طلبات ناجحة': row.aiSuccess,
    'طلبات فاشلة': row.aiFailed,
    الرموز: row.tokens,
    'التكلفة $': row.costUsd,
  }));
  const tools = payload.tools.map((row) => ({
    الأداة: row.title,
    'مرات الاستخدام': row.uses,
    'عدد المستخدمين': row.users,
    'النسبة %': row.share,
    الحالة: row.enabled ? 'مفعّلة' : 'متوقفة',
  }));
  const providers = payload.providers.map((row) => ({
    المزود: row.provider,
    النموذج: row.model ?? '',
    الطلبات: row.requests,
    الناجحة: row.success,
    الفاشلة: row.failed,
    'نسبة النجاح %': row.successRate ?? '',
    الرموز: row.tokens,
    'التكلفة $': row.costUsd,
  }));
  if (format === 'csv') {
    const sheet = XLSX.utils.json_to_sheet(summary);
    const csv = '\uFEFF' + XLSX.utils.sheet_to_csv(sheet);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="nerd-analytics.csv"');
    res.send(csv);
    return;
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), 'الملخص');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(daily), 'الاستخدام اليومي');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(tools), 'الأدوات');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(providers), 'مزودو AI');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="nerd-analytics.xlsx"');
  res.send(buffer);
});

// ---------- مراقبة الذكاء الاصطناعي ----------
developerRouter.get('/ai', (req, res) => {
  const range = parseRange(req.query.range);
  const bounds = rangeBounds(range);
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(50, Math.max(10, Number(req.query.limit ?? 25) || 25));
  const status = String(req.query.status ?? 'all');
  const task = String(req.query.task ?? '').trim();
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  const conditions = ['l.created_at >= ?'];
  const params: Array<string | number> = [bounds.from];
  if (status === 'success' || status === 'failed') {
    conditions.push('l.status = ?');
    params.push(status);
  }
  if (task) {
    conditions.push('l.task = ?');
    params.push(task);
  }
  if (q) {
    conditions.push('(u.username LIKE ? OR l.model LIKE ? OR l.provider LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const where = conditions.join(' AND ');
  const total = count(
    `SELECT COUNT(*) AS n FROM ai_usage_logs l LEFT JOIN users u ON u.id = l.user_id WHERE ${where}`,
    ...params,
  );
  const logs = all<{
    id: number;
    task: string;
    provider: string | null;
    model: string | null;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    status: string;
    error_code: string | null;
    latency_ms: number | null;
    created_at: string;
    username: string | null;
  }>(
    `SELECT l.id, l.task, l.provider, l.model, l.tokens_in, l.tokens_out, l.cost_usd,
            l.status, l.error_code, l.latency_ms, l.created_at, u.username
       FROM ai_usage_logs l LEFT JOIN users u ON u.id = l.user_id
      WHERE ${where}
      ORDER BY l.id DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    (page - 1) * limit,
  );
  const totals = get<{
    requests: number;
    success: number;
    failed: number;
    tokens: number;
    cost: number;
  }>(
    `SELECT COUNT(*) AS requests,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens,
            COALESCE(SUM(cost_usd), 0) AS cost
       FROM ai_usage_logs WHERE created_at >= ?`,
    bounds.from,
  );
  const errors = all<{
    id: number;
    provider_name: string;
    task: string;
    model: string | null;
    error_code: string | null;
    error_message: string | null;
    created_at: string;
  }>(
    `SELECT id, provider_name, task, model, error_code, error_message, created_at
       FROM ai_provider_events
      WHERE status = 'failed' AND created_at >= ?
      ORDER BY id DESC LIMIT 40`,
    bounds.from,
  );
  const errorGroups = all<{
    provider_name: string;
    task: string;
    error_code: string | null;
    repeats: number;
    last_at: string;
  }>(
    `SELECT provider_name, task, error_code, COUNT(*) AS repeats, MAX(created_at) AS last_at
       FROM ai_provider_events
      WHERE status = 'failed' AND created_at >= ?
      GROUP BY provider_name, task, error_code
      ORDER BY repeats DESC LIMIT 15`,
    bounds.from,
  );
  const taskRows = all<{ task: string; requests: number }>(
    `SELECT task, COUNT(*) AS requests FROM ai_usage_logs
      WHERE created_at >= ? GROUP BY task ORDER BY requests DESC`,
    bounds.from,
  );
  res.json({
    range,
    rangeLabel: bounds.label,
    providers: providerCards(bounds.from),
    routing: taskRoutingOverview(),
    totals: {
      requests: Number(totals?.requests ?? 0),
      success: Number(totals?.success ?? 0),
      failed: Number(totals?.failed ?? 0),
      tokens: Number(totals?.tokens ?? 0),
      costUsd: Number(totals?.cost ?? 0),
      successRate:
        Number(totals?.requests ?? 0) > 0
          ? Number(((Number(totals?.success ?? 0) / Number(totals?.requests ?? 1)) * 100).toFixed(1))
          : null,
    },
    logs: logs.map((row) => ({
      id: row.id,
      task: row.task,
      provider: row.provider,
      model: row.model,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      costUsd: row.cost_usd,
      status: row.status,
      errorCode: row.error_code,
      latencyMs: row.latency_ms,
      createdAt: row.created_at,
      username: row.username,
    })),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    tasks: taskRows.map((row) => ({ task: row.task, requests: row.requests })),
    errors: errors.map((row) => ({
      id: row.id,
      provider: row.provider_name,
      task: row.task,
      model: row.model,
      code: row.error_code,
      message: row.error_message,
      createdAt: row.created_at,
    })),
    errorGroups: errorGroups.map((row) => ({
      provider: row.provider_name,
      task: row.task,
      code: row.error_code,
      repeats: row.repeats,
      lastAt: row.last_at,
    })),
  });
});

developerRouter.post('/ai/providers/:id/check', async (req, res, next) => {
  try {
    const admin = adminOf(res);
    const id = String(req.params.id).toUpperCase();
    if (id !== 'A' && id !== 'B') throw new HttpError(400, 'المزوّد غير معروف.');
    const result = await probeProvider(id);
    audit(
      admin.id,
      'ai.provider.check',
      `provider:${id}`,
      result.ok ? 'فحص اتصال ناجح' : `فحص اتصال فاشل: ${result.message}`,
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ---------- الإشعارات والإعلانات ----------
export function sendNotificationCampaign(campaignId: number): { sent: number; status: string } {
  const campaign = get<{
    id: number;
    title: string;
    body: string;
    type: string;
    audience: string;
    target_user_id: number | null;
    status: string;
    created_by: number | null;
  }>('SELECT * FROM notification_campaigns WHERE id = ?', campaignId);
  if (!campaign) throw new HttpError(404, 'حملة الإشعار غير موجودة.');
  if (campaign.status !== 'scheduled') return { sent: Number(0), status: campaign.status };

  let recipients: Array<{ id: number }> = [];
  if (campaign.audience === 'user' && campaign.target_user_id) {
    recipients = all<{ id: number }>(
      'SELECT id FROM users WHERE id = ? AND is_active = 1 AND notifications_enabled = 1',
      campaign.target_user_id,
    );
  } else if (campaign.audience === 'active') {
    recipients = all<{ id: number }>(
      "SELECT id FROM users WHERE is_active = 1 AND notifications_enabled = 1 AND last_active_at >= datetime('now', '-7 days')",
    );
  } else if (campaign.audience === 'inactive') {
    recipients = all<{ id: number }>(
      "SELECT id FROM users WHERE is_active = 1 AND notifications_enabled = 1 AND (last_active_at IS NULL OR last_active_at < datetime('now', '-7 days'))",
    );
  } else if (campaign.audience === 'new') {
    recipients = all<{ id: number }>(
      "SELECT id FROM users WHERE is_active = 1 AND notifications_enabled = 1 AND created_at >= datetime('now', '-7 days')",
    );
  } else {
    recipients = all<{ id: number }>(
      'SELECT id FROM users WHERE is_active = 1 AND notifications_enabled = 1',
    );
  }

  for (const recipient of recipients) {
    run(
      `INSERT INTO notifications (user_id, type, title, body, campaign_id) VALUES (?, ?, ?, ?, ?)`,
      recipient.id,
      campaign.type,
      campaign.title,
      campaign.body,
      campaign.id,
    );
  }
  run(
    `UPDATE notification_campaigns
        SET status = 'sent', sent_at = datetime('now'), recipient_count = ?
      WHERE id = ?`,
    recipients.length,
    campaign.id,
  );
  if (campaign.created_by) {
    run(
      'INSERT INTO admin_activity_logs (admin_id, action, target, detail) VALUES (?, ?, ?, ?)',
      campaign.created_by,
      'notification.send',
      `campaign:${campaign.id}`,
      `إرسال إشعار إلى ${recipients.length} مستخدمًا`,
    );
  }
  return { sent: recipients.length, status: 'sent' };
}

developerRouter.get('/notifications', (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(50, Math.max(5, Number(req.query.limit ?? 20) || 20));
  const status = String(req.query.status ?? 'all');
  const where = status === 'all' ? '1 = 1' : 'c.status = ?';
  const params = status === 'all' ? [] : [status];
  const total = count(`SELECT COUNT(*) AS n FROM notification_campaigns c WHERE ${where}`, ...params);
  const rows = all<{
    id: number;
    title: string;
    body: string;
    type: string;
    audience: string;
    status: string;
    scheduled_at: string | null;
    sent_at: string | null;
    recipient_count: number;
    created_at: string;
    target_user_id: number | null;
    target_username: string | null;
    admin_name: string | null;
  }>(
    `SELECT c.id, c.title, c.body, c.type, c.audience, c.status, c.scheduled_at, c.sent_at,
            c.recipient_count, c.created_at, c.target_user_id, t.username AS target_username,
            a.username AS admin_name
       FROM notification_campaigns c
       LEFT JOIN users t ON t.id = c.target_user_id
       LEFT JOIN users a ON a.id = c.created_by
      WHERE ${where}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ? OFFSET ?`,
    ...params,
    limit,
    (page - 1) * limit,
  );
  res.json({
    campaigns: rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      type: row.type,
      audience: row.audience,
      status: row.status,
      scheduledAt: row.scheduled_at,
      sentAt: row.sent_at,
      recipientCount: row.recipient_count,
      createdAt: row.created_at,
      targetUserId: row.target_user_id,
      targetUsername: row.target_username,
      adminName: row.admin_name,
    })),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    counts: {
      all: count('SELECT COUNT(*) AS n FROM notification_campaigns'),
      scheduled: count("SELECT COUNT(*) AS n FROM notification_campaigns WHERE status = 'scheduled'"),
      sent: count("SELECT COUNT(*) AS n FROM notification_campaigns WHERE status = 'sent'"),
      cancelled: count("SELECT COUNT(*) AS n FROM notification_campaigns WHERE status = 'cancelled'"),
    },
  });
});

const campaignSchema = z.object({
  title: z.string().trim().min(3, 'عنوان الإشعار قصير جدًا.').max(120),
  body: z.string().trim().min(5, 'نص الإشعار قصير جدًا.').max(1_500),
  audience: z.enum(['all', 'active', 'inactive', 'new', 'user']).default('all'),
  targetUserId: z.number().int().positive().optional().nullable(),
  scheduledAt: z.string().trim().max(40).optional().nullable(),
});

developerRouter.post('/notifications', (req, res, next) => {
  try {
    const admin = adminOf(res);
    const payload = campaignSchema.parse(req.body);
    if (payload.audience === 'user') {
      if (!payload.targetUserId) throw new HttpError(400, 'اختر المستخدم المستهدف.');
      const target = get<{ id: number }>('SELECT id FROM users WHERE id = ?', payload.targetUserId);
      if (!target) throw new HttpError(404, 'المستخدم المستهدف غير موجود.');
    }
    let scheduledAt: string | null = null;
    if (payload.scheduledAt) {
      const date = new Date(payload.scheduledAt);
      if (Number.isNaN(date.getTime())) throw new HttpError(400, 'وقت الجدولة غير صحيح.');
      scheduledAt = sqlDate(date);
    }
    const shouldSchedule = Boolean(scheduledAt && new Date(`${scheduledAt.replace(' ', 'T')}Z`).getTime() > Date.now() + 60_000);
    const created = run(
      `INSERT INTO notification_campaigns
         (title, body, type, audience, target_user_id, status, scheduled_at, created_by)
       VALUES (?, ?, 'admin', ?, ?, ?, ?, ?)`,
      payload.title,
      payload.body,
      payload.audience,
      payload.audience === 'user' ? payload.targetUserId ?? null : null,
      shouldSchedule ? 'scheduled' : 'scheduled',
      scheduledAt,
      admin.id,
    );
    audit(admin.id, 'notification.create', `campaign:${created.lastInsertRowid}`, shouldSchedule ? 'جدولة إشعار' : 'إنشاء إشعار');
    const result = shouldSchedule ? { sent: 0, status: 'scheduled' } : sendNotificationCampaign(created.lastInsertRowid);
    res.status(201).json({ id: created.lastInsertRowid, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: error.issues[0]?.message ?? 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

developerRouter.post('/notifications/:id/cancel', (req, res, next) => {
  try {
    const admin = adminOf(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'معرّف الإشعار غير صحيح.');
    const campaign = get<{ id: number; status: string }>('SELECT id, status FROM notification_campaigns WHERE id = ?', id);
    if (!campaign) throw new HttpError(404, 'الإشعار غير موجود.');
    if (campaign.status !== 'scheduled') throw new HttpError(400, 'لا يمكن إلغاء إشعار أُرسل بالفعل.');
    run("UPDATE notification_campaigns SET status = 'cancelled' WHERE id = ?", id);
    audit(admin.id, 'notification.cancel', `campaign:${id}`, 'إلغاء إشعار مجدول');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export function runDueNotificationCampaigns(): number {
  const due = all<{ id: number }>(
    `SELECT id FROM notification_campaigns
      WHERE status = 'scheduled' AND scheduled_at IS NOT NULL
        AND scheduled_at <= datetime('now') ORDER BY id LIMIT 20`,
  );
  let sent = 0;
  for (const row of due) {
    try {
      sendNotificationCampaign(row.id);
      sent += 1;
    } catch (error) {
      run("UPDATE notification_campaigns SET status = 'failed' WHERE id = ?", row.id);
      console.error('[nerd/developer] تعذّر إرسال إشعار مجدول:', (error as Error).message);
    }
  }
  return sent;
}

// ---------- الإعلانات ----------
const adInputSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(5).max(1_500),
  imagePath: z.string().trim().max(120).optional().nullable(),
  audience: z.enum(['all', 'active', 'new']).default('all'),
  startsAt: z.string().trim().max(40).optional().nullable(),
  endsAt: z.string().trim().max(40).optional().nullable(),
  isActive: z.boolean().optional(),
});

function normalizeOptionalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'تاريخ العرض غير صحيح.');
  return sqlDate(date);
}

function adImageFile(name: string | null | undefined): string | null {
  if (!name) return null;
  if (!/^[a-f0-9-]+\.(png|jpe?g|webp)$/i.test(name)) {
    throw new HttpError(400, 'صيغة صورة الإعلان غير مدعومة.');
  }
  if (!existsSync(join(uploadRoot, 'ads', name))) throw new HttpError(400, 'صورة الإعلان غير موجودة.');
  return name;
}

developerRouter.get('/ads', (_req, res) => {
  const rows = all<{
    id: number;
    title: string;
    body: string;
    image_path: string | null;
    audience: string;
    starts_at: string | null;
    ends_at: string | null;
    is_active: number;
    created_at: string;
    updated_at: string;
  }>('SELECT * FROM ads ORDER BY created_at DESC, id DESC LIMIT 100');
  res.json({
    ads: rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      imagePath: row.image_path,
      imageUrl: row.image_path ? `/api/ads/${row.id}/image` : null,
      audience: row.audience,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
});

const adUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    callback(null, allowed.includes(file.mimetype));
  },
});

developerRouter.post('/ads/upload', adUpload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, 'اختر صورة للإعلان.');
    const extension = req.file.mimetype === 'image/png' ? 'png' : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const name = `${randomUUID()}.${extension}`;
    const directory = join(uploadRoot, 'ads');
    mkdirSync(directory, { recursive: true });
    await writeFile(join(directory, name), req.file.buffer);
    res.status(201).json({ imagePath: name, imageUrl: null });
  } catch (error) {
    next(error);
  }
});

developerRouter.post('/ads', (req, res, next) => {
  try {
    const admin = adminOf(res);
    const payload = adInputSchema.parse(req.body);
    const startsAt = normalizeOptionalDate(payload.startsAt);
    const endsAt = normalizeOptionalDate(payload.endsAt);
    if (startsAt && endsAt && endsAt <= startsAt) throw new HttpError(400, 'نهاية العرض يجب أن تكون بعد بدايته.');
    const imagePath = adImageFile(payload.imagePath);
    const created = run(
      `INSERT INTO ads (title, body, image_path, audience, starts_at, ends_at, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      payload.title,
      payload.body,
      imagePath,
      payload.audience,
      startsAt,
      endsAt,
      payload.isActive === false ? 0 : 1,
      admin.id,
    );
    audit(admin.id, 'ad.create', `ad:${created.lastInsertRowid}`, 'إنشاء إعلان داخلي');
    res.status(201).json({ id: created.lastInsertRowid });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: error.issues[0]?.message ?? 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

developerRouter.patch('/ads/:id', (req, res, next) => {
  try {
    const admin = adminOf(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'معرّف الإعلان غير صحيح.');
    const ad = get<{ id: number; image_path: string | null }>('SELECT id, image_path FROM ads WHERE id = ?', id);
    if (!ad) throw new HttpError(404, 'الإعلان غير موجود.');
    const payload = adInputSchema.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
    const startsAt = payload.startsAt !== undefined ? normalizeOptionalDate(payload.startsAt) : undefined;
    const endsAt = payload.endsAt !== undefined ? normalizeOptionalDate(payload.endsAt) : undefined;
    const imagePath = payload.imagePath !== undefined ? adImageFile(payload.imagePath) : undefined;
    if (payload.imagePath === null && ad.image_path) {
      awaitUnlinkAd(ad.image_path);
    }
    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    const assign = (column: string, value: string | number | null) => {
      fields.push(`${column} = ?`);
      values.push(value);
    };
    if (payload.title !== undefined) assign('title', payload.title);
    if (payload.body !== undefined) assign('body', payload.body);
    if (payload.audience !== undefined) assign('audience', payload.audience);
    if (imagePath !== undefined) assign('image_path', imagePath);
    if (startsAt !== undefined) assign('starts_at', startsAt);
    if (endsAt !== undefined) assign('ends_at', endsAt);
    if (payload.isActive !== undefined) assign('is_active', payload.isActive ? 1 : 0);
    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      values.push(id);
      run(`UPDATE ads SET ${fields.join(', ')} WHERE id = ?`, ...values);
    }
    audit(admin.id, 'ad.update', `ad:${id}`, 'تعديل إعلان داخلي');
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

function awaitUnlinkAd(name: string): void {
  void unlink(join(uploadRoot, 'ads', name)).catch(() => undefined);
}

developerRouter.delete('/ads/:id', (req, res, next) => {
  try {
    const admin = adminOf(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'معرّف الإعلان غير صحيح.');
    const ad = get<{ id: number; image_path: string | null }>('SELECT id, image_path FROM ads WHERE id = ?', id);
    if (!ad) throw new HttpError(404, 'الإعلان غير موجود.');
    run('DELETE FROM ads WHERE id = ?', id);
    if (ad.image_path) awaitUnlinkAd(ad.image_path);
    audit(admin.id, 'ad.delete', `ad:${id}`, 'حذف إعلان داخلي');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// ---------- إدارة الأدوات والصيانة ----------
developerRouter.get('/tools', (_req, res) => {
  const rows = all<{
    key: string;
    title_ar: string;
    description_ar: string;
    phase: number;
    is_enabled: number;
    href: string | null;
    sort_order: number;
    maintenance_message: string | null;
  }>('SELECT * FROM feature_flags ORDER BY sort_order, key');
  res.json({
    maintenance: maintenanceState(),
    tools: rows.map((row) => ({
      key: row.key,
      title: row.title_ar,
      description: row.description_ar,
      phase: row.phase,
      enabled: Boolean(row.is_enabled),
      href: row.href,
      order: row.sort_order,
      maintenanceMessage: row.maintenance_message,
    })),
  });
});

developerRouter.patch('/tools/:key', (req, res, next) => {
  try {
    const admin = adminOf(res);
    const key = String(req.params.key);
    const tool = get<{ key: string; title_ar: string; is_enabled: number }>(
      'SELECT key, title_ar, is_enabled FROM feature_flags WHERE key = ?',
      key,
    );
    if (!tool) throw new HttpError(404, 'الأداة غير موجودة.');
    const payload = z
      .object({
        enabled: z.boolean().optional(),
        maintenanceMessage: z.string().trim().max(500).nullable().optional(),
      })
      .parse(req.body);
    if (payload.enabled !== undefined) {
      run('UPDATE feature_flags SET is_enabled = ? WHERE key = ?', payload.enabled ? 1 : 0, key);
    }
    if (payload.maintenanceMessage !== undefined) {
      run(
        'UPDATE feature_flags SET maintenance_message = ? WHERE key = ?',
        payload.maintenanceMessage?.trim() || null,
        key,
      );
    }
    audit(
      admin.id,
      'tool.update',
      `feature:${key}`,
      `${tool.title_ar}: ${payload.enabled === undefined ? 'تعديل رسالة' : payload.enabled ? 'تشغيل' : 'إيقاف'}`,
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

developerRouter.patch('/maintenance', (req, res, next) => {
  try {
    const admin = adminOf(res);
    const payload = z
      .object({ enabled: z.boolean(), message: z.string().trim().min(5).max(500) })
      .parse(req.body);
    saveSetting('maintenance_mode', payload.enabled ? '1' : '0');
    saveSetting('maintenance_message', payload.message);
    run(
      "INSERT INTO admin_activity_logs (admin_id, action, target, detail) VALUES (?, 'maintenance.update', 'app', ?)",
      admin.id,
      payload.enabled ? 'تفعيل وضع الصيانة العام' : 'إلغاء وضع الصيانة العام',
    );
    res.json({ ok: true, maintenance: maintenanceState() });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: 'بيانات الصيانة غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

// ---------- صحة النظام ----------
function backupOverview() {
  const directory = join(process.cwd(), 'backups');
  if (!existsSync(directory)) {
    return { available: false, scriptAvailable: existsSync(join(process.cwd(), 'scripts', 'backup.mjs')), items: [] };
  }
  const items = readdirSync(directory)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .reverse()
    .slice(0, 5)
    .map((name) => {
      const dbFile = join(directory, name, 'nerd.db');
      const info = existsSync(dbFile) ? statSync(dbFile) : null;
      return {
        name,
        createdAt: info?.mtime.toISOString() ?? null,
        sizeBytes: info?.size ?? 0,
      };
    });
  return {
    available: items.length > 0,
    scriptAvailable: existsSync(join(process.cwd(), 'scripts', 'backup.mjs')),
    items,
  };
}

developerRouter.get('/health', (_req, res) => {
  const started = performance.now();
  const dbOk = get<{ ok: number }>('SELECT 1 AS ok')?.ok === 1;
  const dbLatencyMs = Math.max(0, Number((performance.now() - started).toFixed(2)));
  const ai = aiProviderStatus();
  const errors = all<{ id: number; source: string; code: string | null; message: string; path: string | null; created_at: string }>(
    'SELECT id, source, code, message, path, created_at FROM system_errors ORDER BY id DESC LIMIT 10',
  );
  const memory = process.memoryUsage();
  const dbStat = existsSync(join(process.cwd(), 'data', 'nerd.db'))
    ? statSync(join(process.cwd(), 'data', 'nerd.db'))
    : null;
  res.json({
    server: {
      status: 'ok',
      runtime: runtimeMetrics(),
      node: process.version,
      memoryMb: {
        rss: Number((memory.rss / 1024 / 1024).toFixed(1)),
        heapUsed: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
      },
    },
    database: {
      status: dbOk ? 'ok' : 'failed',
      latencyMs: dbLatencyMs,
      sizeBytes: dbStat?.size ?? 0,
      users: count('SELECT COUNT(*) AS n FROM users'),
      records:
        count('SELECT COUNT(*) AS n FROM study_contents') +
        count('SELECT COUNT(*) AS n FROM books') +
        count('SELECT COUNT(*) AS n FROM tests') +
        count('SELECT COUNT(*) AS n FROM summaries'),
    },
    ai: {
      status: !ai.configured ? 'warning' : 'ok',
      message: ai.configured
        ? 'مزوّدات الخادم مهيأة. الحالة الفعلية تتأكد من فحص الاتصال اليدوي.'
        : 'لا يوجد مزوّد ذكاء اصطناعي مهيأ على الخادم؛ تعمل مفاتيح المستخدمين كما هي.',
      providers: ai.providers,
    },
    storage: {
      status: existsSync(uploadRoot) ? 'ok' : 'warning',
      path: 'uploads (خادم محلي)',
    },
    backups: backupOverview(),
    errors: errors.map((row) => ({
      id: row.id,
      source: row.source,
      code: row.code,
      message: row.message,
      path: row.path,
      createdAt: row.created_at,
    })),
    generatedAt: new Date().toISOString(),
  });
});

// ---------- سجل النشاطات ----------
developerRouter.get('/activity', (req, res) => {
  const bounds = rangeBounds(parseRange(req.query.range));
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(50, Math.max(10, Number(req.query.limit ?? 25) || 25));
  const scope = String(req.query.scope ?? 'all');
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  const userId = Number(req.query.userId ?? 0) || null;
  const kind = String(req.query.kind ?? '').trim();
  const branches: Array<{ sql: string; params: Array<string | number | null> }> = [];
  const like = `%${q}%`;

  if (scope === 'all' || scope === 'users') {
    const extra: string[] = [];
    const params: Array<string | number | null> = [bounds.from];
    if (userId) {
      extra.push('a.user_id = ?');
      params.push(userId);
    }
    if (kind) {
      extra.push('a.kind = ?');
      params.push(kind);
    }
    if (q) {
      extra.push('(a.title LIKE ? OR a.detail LIKE ? OR u.username LIKE ?)');
      params.push(like, like, like);
    }
    branches.push({
      sql: `SELECT 'user' AS source, a.id AS source_id, a.kind AS kind, a.title, a.detail,
                   a.created_at, a.user_id, u.username AS actor, NULL AS result
              FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
             WHERE a.created_at >= ? ${extra.length ? `AND ${extra.join(' AND ')}` : ''}`,
      params,
    });
  }

  if (scope === 'all' || scope === 'admin') {
    const extra: string[] = [];
    const params: Array<string | number | null> = [bounds.from];
    if (q) {
      extra.push('(l.action LIKE ? OR l.detail LIKE ? OR u.username LIKE ?)');
      params.push(like, like, like);
    }
    branches.push({
      sql: `SELECT 'admin' AS source, l.id AS source_id, l.action AS kind, l.action AS title,
                   l.detail, l.created_at, l.admin_id AS user_id, u.username AS actor, l.target AS result
              FROM admin_activity_logs l LEFT JOIN users u ON u.id = l.admin_id
             WHERE l.created_at >= ? ${extra.length ? `AND ${extra.join(' AND ')}` : ''}`,
      params,
    });
  }

  if (scope === 'all' || scope === 'ai') {
    const extra: string[] = [];
    const params: Array<string | number | null> = [bounds.from];
    if (userId) {
      extra.push('l.user_id = ?');
      params.push(userId);
    }
    if (q) {
      extra.push('(l.task LIKE ? OR u.username LIKE ? OR l.provider LIKE ?)');
      params.push(like, like, like);
    }
    branches.push({
      sql: `SELECT 'ai' AS source, l.id AS source_id, 'ai' AS kind, l.task AS title,
                   COALESCE(l.error_message, l.model) AS detail, l.created_at, l.user_id,
                   u.username AS actor, l.status AS result
              FROM ai_usage_logs l LEFT JOIN users u ON u.id = l.user_id
             WHERE l.created_at >= ? ${extra.length ? `AND ${extra.join(' AND ')}` : ''}`,
      params,
    });
  }

  if (scope === 'all' || scope === 'errors') {
    const params: Array<string | number | null> = [bounds.from];
    const extra: string[] = [];
    if (q) {
      extra.push('(s.message LIKE ? OR s.source LIKE ?)');
      params.push(like, like);
    }
    branches.push({
      sql: `SELECT 'error' AS source, s.id AS source_id, s.source AS kind, s.code AS title,
                   s.message AS detail, s.created_at, NULL AS user_id, NULL AS actor, 'failed' AS result
              FROM system_errors s WHERE s.created_at >= ? ${extra.length ? `AND ${extra.join(' AND ')}` : ''}`,
      params,
    });
  }

  const union = branches.map((branch) => branch.sql).join(' UNION ALL ');
  const params = branches.flatMap((branch) => branch.params);
  const total = count(`SELECT COUNT(*) AS n FROM (${union})`, ...params);
  const rows = all<{
    source: string;
    source_id: number;
    kind: string;
    title: string;
    detail: string | null;
    created_at: string;
    user_id: number | null;
    actor: string | null;
    result: string | null;
  }>(
    `SELECT * FROM (${union}) ORDER BY created_at DESC, source_id DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    (page - 1) * limit,
  );
  res.json({
    range: bounds.range,
    rangeLabel: bounds.label,
    items: rows.map((row) => ({
      key: `${row.source}-${row.source_id}`,
      source: row.source,
      kind: row.kind,
      title: row.title,
      detail: row.detail,
      createdAt: row.created_at,
      userId: row.user_id,
      actor: row.actor,
      result: row.result,
    })),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

// ---------- مركز الشكاوى ----------
const feedbackStatuses = ['new', 'reviewing', 'in_progress', 'resolved', 'closed'] as const;
const feedbackCategories = ['technical', 'suggestion', 'ai', 'account', 'tool', 'other'] as const;

developerRouter.get('/feedback', (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(50, Math.max(10, Number(req.query.limit ?? 20) || 20));
  const status = String(req.query.status ?? 'all');
  const category = String(req.query.category ?? 'all');
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  const conditions = ['1 = 1'];
  const params: Array<string | number> = [];
  if (status !== 'all') {
    conditions.push('r.status = ?');
    params.push(status);
  }
  if (category !== 'all') {
    conditions.push('r.category = ?');
    params.push(category);
  }
  if (q) {
    conditions.push('(r.title LIKE ? OR r.body LIKE ? OR u.username LIKE ? OR CAST(r.id AS TEXT) = ?)');
    const like = `%${q}%`;
    params.push(like, like, like, q);
  }
  const total = count(
    `SELECT COUNT(*) AS n FROM feedback_reports r LEFT JOIN users u ON u.id = r.user_id
      WHERE ${conditions.join(' AND ')}`,
    ...params,
  );
  const rows = all<{
    id: number;
    category: string;
    title: string;
    body: string;
    status: string;
    created_at: string;
    updated_at: string;
    user_id: number;
    username: string;
    replies_count: number;
    last_reply_at: string | null;
  }>(
    `SELECT r.id, r.category, r.title, r.body, r.status, r.created_at, r.updated_at,
            r.user_id, u.username,
            (SELECT COUNT(*) FROM feedback_replies f WHERE f.report_id = r.id) AS replies_count,
            (SELECT MAX(f.created_at) FROM feedback_replies f WHERE f.report_id = r.id) AS last_reply_at
       FROM feedback_reports r LEFT JOIN users u ON u.id = r.user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY CASE r.status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
               r.created_at DESC
      LIMIT ? OFFSET ?`,
    ...params,
    limit,
    (page - 1) * limit,
  );
  res.json({
    reports: rows.map((row) => ({
      id: row.id,
      category: row.category,
      title: row.title,
      body: row.body,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      userId: row.user_id,
      username: row.username,
      repliesCount: row.replies_count,
      lastReplyAt: row.last_reply_at,
    })),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    counts: {
      all: count('SELECT COUNT(*) AS n FROM feedback_reports'),
      new: count("SELECT COUNT(*) AS n FROM feedback_reports WHERE status = 'new'"),
      reviewing: count("SELECT COUNT(*) AS n FROM feedback_reports WHERE status = 'reviewing'"),
      in_progress: count("SELECT COUNT(*) AS n FROM feedback_reports WHERE status = 'in_progress'"),
      resolved: count("SELECT COUNT(*) AS n FROM feedback_reports WHERE status = 'resolved'"),
      closed: count("SELECT COUNT(*) AS n FROM feedback_reports WHERE status = 'closed'"),
    },
  });
});

developerRouter.get('/feedback/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'معرّف البلاغ غير صحيح.');
    const report = get<{
      id: number;
      category: string;
      title: string;
      body: string;
      status: string;
      created_at: string;
      updated_at: string;
      resolved_at: string | null;
      user_id: number;
      username: string;
      email: string;
    }>(
      `SELECT r.*, u.username, u.email FROM feedback_reports r
       JOIN users u ON u.id = r.user_id WHERE r.id = ?`,
      id,
    );
    if (!report) throw new HttpError(404, 'البلاغ غير موجود.');
    const replies = all<{
      id: number;
      body: string;
      author_role: string;
      created_at: string;
      username: string | null;
    }>(
      `SELECT f.id, f.body, f.author_role, f.created_at, u.username
         FROM feedback_replies f LEFT JOIN users u ON u.id = f.author_id
        WHERE f.report_id = ? ORDER BY f.created_at, f.id`,
      id,
    );
    res.json({
      report: {
        id: report.id,
        category: report.category,
        title: report.title,
        body: report.body,
        status: report.status,
        createdAt: report.created_at,
        updatedAt: report.updated_at,
        resolvedAt: report.resolved_at,
        userId: report.user_id,
        username: report.username,
        email: report.email,
      },
      replies: replies.map((reply) => ({
        id: reply.id,
        body: reply.body,
        authorRole: reply.author_role,
        authorName: reply.author_role === 'admin' ? 'فريق نيرد' : reply.username,
        createdAt: reply.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

developerRouter.patch('/feedback/:id', (req, res, next) => {
  try {
    const admin = adminOf(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'معرّف البلاغ غير صحيح.');
    const report = get<{ id: number; status: string; category: string }>(
      'SELECT id, status, category FROM feedback_reports WHERE id = ?',
      id,
    );
    if (!report) throw new HttpError(404, 'البلاغ غير موجود.');
    const payload = z
      .object({
        status: z.enum(feedbackStatuses).optional(),
        category: z.enum(feedbackCategories).optional(),
      })
      .parse(req.body);
    if (payload.status !== undefined) {
      run(
        `UPDATE feedback_reports SET status = ?, updated_at = datetime('now'),
          resolved_at = CASE WHEN ? IN ('resolved', 'closed') THEN COALESCE(resolved_at, datetime('now')) ELSE NULL END
         WHERE id = ?`,
        payload.status,
        payload.status,
        id,
      );
    }
    if (payload.category !== undefined) {
      run("UPDATE feedback_reports SET category = ?, updated_at = datetime('now') WHERE id = ?", payload.category, id);
    }
    audit(admin.id, 'feedback.update', `feedback:${id}`, 'تحديث حالة/تصنيف بلاغ');
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

developerRouter.post('/feedback/:id/replies', (req, res, next) => {
  try {
    const admin = adminOf(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'معرّف البلاغ غير صحيح.');
    const report = get<{ id: number; user_id: number; status: string; title: string }>(
      'SELECT id, user_id, status, title FROM feedback_reports WHERE id = ?',
      id,
    );
    if (!report) throw new HttpError(404, 'البلاغ غير موجود.');
    const payload = z
      .object({
        body: z.string().trim().min(2, 'اكتب ردًا واضحًا.').max(2_000),
        status: z.enum(feedbackStatuses).optional(),
      })
      .parse(req.body);
    run(
      `INSERT INTO feedback_replies (report_id, author_id, author_role, body) VALUES (?, ?, 'admin', ?)`,
      id,
      admin.id,
      payload.body,
    );
    const nextStatus = payload.status ?? (report.status === 'new' ? 'in_progress' : report.status);
    run(
      `UPDATE feedback_reports SET status = ?, updated_at = datetime('now'),
        resolved_at = CASE WHEN ? IN ('resolved', 'closed') THEN COALESCE(resolved_at, datetime('now')) ELSE resolved_at END
       WHERE id = ?`,
      nextStatus,
      nextStatus,
      id,
    );
    createNotification(
      report.user_id,
      'feedback',
      'رد جديد على بلاغك',
      payload.body.slice(0, 500),
    );
    run(
      "INSERT INTO activity_log (user_id, kind, title, detail) VALUES (?, 'feedback', 'رد على بلاغ', ?)",
      report.user_id,
      report.title,
    );
    audit(admin.id, 'feedback.reply', `feedback:${id}`, 'الرد على بلاغ مستخدم');
    res.status(201).json({ ok: true, status: nextStatus });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: 'بيانات الرد غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

// ---------- إعدادات لوحة المطوّر ----------
developerRouter.get('/settings', (_req, res) => {
  const admin = adminOf(res);
  const ai = aiProviderStatus();
  const memory = process.memoryUsage();
  res.json({
    admin: {
      username: admin.username,
      email: admin.email,
      memberSince: admin.createdAt,
      role: 'المطوّر الرئيسي',
    },
    app: {
      name: settingValue('app_name', 'NERD'),
      aiDailyLimit: Number(settingValue('ai_daily_limit_per_user', '30')),
      feedbackEnabled: settingEnabled('feedback_enabled', true),
      maintenance: maintenanceState(),
    },
    services: {
      database: 'ok',
      server: 'ok',
      ai: ai.providers,
      storage: existsSync(uploadRoot) ? 'ok' : 'warning',
    },
    runtime: {
      ...runtimeMetrics(),
      memoryMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
      node: process.version,
    },
    backups: backupOverview(),
  });
});

developerRouter.patch('/settings', (req, res, next) => {
  try {
    const admin = adminOf(res);
    const payload = z
      .object({
        appName: z.string().trim().min(2).max(40).optional(),
        aiDailyLimit: z.number().int().min(1).max(500).optional(),
        feedbackEnabled: z.boolean().optional(),
        maintenanceEnabled: z.boolean().optional(),
        maintenanceMessage: z.string().trim().min(5).max(500).optional(),
      })
      .parse(req.body);
    if (payload.appName) saveSetting('app_name', payload.appName);
    if (payload.aiDailyLimit !== undefined) saveSetting('ai_daily_limit_per_user', String(payload.aiDailyLimit));
    if (payload.feedbackEnabled !== undefined) saveSetting('feedback_enabled', payload.feedbackEnabled ? '1' : '0');
    if (payload.maintenanceEnabled !== undefined) {
      if (!payload.maintenanceMessage) throw new HttpError(400, 'اكتب رسالة الصيانة مع تفعيل الوضع.');
      saveSetting('maintenance_mode', payload.maintenanceEnabled ? '1' : '0');
      saveSetting('maintenance_message', payload.maintenanceMessage);
    }
    audit(admin.id, 'settings.update', 'app', 'تعديل إعدادات لوحة المطوّر');
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: 'بيانات الإعدادات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});
