import type { NextFunction, Request, Response } from 'express';
import { findSessionUser, readCookie, SESSION_COOKIE } from '../auth.ts';
import { get, run } from '../db.ts';

export function settingValue(key: string, fallback = ''): string {
  return get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', key)?.value ?? fallback;
}

export function settingEnabled(key: string, fallback = false): boolean {
  const value = settingValue(key, fallback ? '1' : '0');
  return value === '1' || value === 'true';
}

export function saveSetting(key: string, value: string): void {
  run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    key,
    value,
  );
}

export function maintenanceState(): { enabled: boolean; message: string } {
  return {
    enabled: settingEnabled('maintenance_mode'),
    message: settingValue(
      'maintenance_message',
      'نيرد يخضع لصيانة سريعة. سنعود قريبًا بإذن الله.',
    ),
  };
}

function sessionUser(req: Request) {
  return findSessionUser(readCookie(req, SESSION_COOKIE));
}

/** يمنع استخدام التطبيق للطلاب أثناء الصيانة العامة، مع إبقاء الدخول ولوحة المطوّر. */
export function maintenanceGate(req: Request, res: Response, next: NextFunction): void {
  const state = maintenanceState();
  if (!state.enabled) {
    next();
    return;
  }
  const allowed =
    req.path.startsWith('/auth') ||
    req.path === '/status' ||
    req.path.startsWith('/developer');
  if (allowed) {
    next();
    return;
  }
  const user = sessionUser(req);
  if (user?.isDeveloper) {
    next();
    return;
  }
  res.status(503).json({
    error: {
      message: state.message,
      code: 'maintenance',
    },
  });
}

const PREFIX_TOOL: Array<[RegExp, string]> = [
  [/^\/contents(?:\/|$)/, 'content-library'],
  [/^\/books(?:\/|$)/, 'books'],
  [/^\/tests(?:\/|$)/, 'tests'],
  [/^\/bank(?:\/|$)/, 'question-bank'],
  [/^\/summaries(?:\/|$)/, 'summary'],
  [/^\/schedule(?:\/|$)/, 'schedule'],
  [/^\/search(?:\/|$)/, 'global-search'],
  [/^\/challenge(?:\/|$)/, 'daily-challenge'],
  [/^\/ai\/chat(?:\/|$)/, 'ai-chat'],
  [/^\/ai\/english(?:\/|$)/, 'english-grammar'],
  [/^\/ai\/arabic(?:\/|$)/, 'arabic-grammar'],
];

const STUDY_TOOL_KEYS: Record<string, string> = {
  teacher: 'teacher',
  solver: 'solver',
  grader: 'grader',
  expression: 'expression',
};

export function toolKeyForRequest(req: Request): string | null {
  if (req.path === '/ai/tools') {
    const mode = String((req.body as { mode?: unknown } | undefined)?.mode ?? '');
    return STUDY_TOOL_KEYS[mode] ?? null;
  }
  for (const [pattern, key] of PREFIX_TOOL) {
    if (pattern.test(req.path)) return key;
  }
  return null;
}

/** إيقاف الأداة يُفرض على الخادم، وليس بإخفاء الزر فقط. */
export function featureGate(req: Request, res: Response, next: NextFunction): void {
  const key = toolKeyForRequest(req);
  if (!key) {
    next();
    return;
  }
  const flag = get<{ is_enabled: number; title_ar: string; maintenance_message: string | null }>(
    'SELECT is_enabled, title_ar, maintenance_message FROM feature_flags WHERE key = ?',
    key,
  );
  if (!flag || flag.is_enabled) {
    next();
    return;
  }
  res.status(503).json({
    error: {
      message:
        flag.maintenance_message?.trim() ||
        `${flag.title_ar} متوقفة مؤقتًا من لوحة المطوّر. جرّب لاحقًا.`,
      code: 'feature_disabled',
    },
  });
}
