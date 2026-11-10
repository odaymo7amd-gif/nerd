import { run } from './db.ts';

/** يسجّل ملخصًا تقنيًا فقط. لا تُسجَّل أجسام الطلبات أو الأسرار أو محتوى المستخدم. */
export function logSystemError(error: unknown, context: { path?: string; method?: string; source?: string } = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  try {
    run(
      `INSERT INTO system_errors (source, code, message, path, method) VALUES (?, ?, ?, ?, ?)`,
      context.source ?? 'server',
      code || null,
      message.slice(0, 500),
      context.path?.slice(0, 300) ?? null,
      context.method ?? null,
    );
  } catch (loggingError) {
    console.error('[nerd] تعذّر تسجيل الخطأ:', (loggingError as Error).message);
  }
}
