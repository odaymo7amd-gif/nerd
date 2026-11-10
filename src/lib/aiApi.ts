// الواجهة الوحيدة بين صفحات التطبيق وميزات الذكاء الاصطناعي على الخادم.
// تُرفق مفتاح الجهاز مع كل طلب، وترفض الإرسال إن لم يكن هناك مفتاح.

import { api, ApiError } from './api.ts';
import { getAiKey } from './aiKey.ts';

export interface VerifyKeyResponse {
  ok: boolean;
  provider: string;
  model: string;
  modelAvailable: boolean;
  models: string[];
  phrase: string;
  verification: 'phrase';
}

/** العبارة التي يجب أن يكتبها النموذج بنفسه لنجاح التحقق من المفتاح. */
export const AI_VERIFICATION_PHRASE = 'انشر التطبيق لمساعدة الآخرين';

function keyHeaders(): Record<string, string> {
  const key = getAiKey();
  return key ? { 'X-AI-Key': key } : {};
}

export function aiHeaders(): Record<string, string> {
  return keyHeaders();
}

export const aiApi = {
  get: <T>(path: string, signal?: AbortSignal) => api.get<T>(path, signal, keyHeaders()),
  post: <T>(path: string, body?: unknown) => api.post<T>(path, body, keyHeaders()),
  del: <T>(path: string, body?: unknown) => api.del<T>(path, body, keyHeaders()),
};

/** التحقق الحقيقي من مفتاح معيّن قبل حفظه (أو قبل استبدال مفتاح محفوظ). */
export async function verifyAiKey(key: string): Promise<VerifyKeyResponse> {
  const trimmed = key.trim();
  if (!trimmed) throw new ApiError(400, 'الصق مفتاح Groq أولًا.');
  return api.post<VerifyKeyResponse>('/ai/verify-key', {}, { 'X-AI-Key': trimmed });
}

export const AI_KEY_MISSING_CODE = 'ai_key_missing';
export const AI_KEY_INVALID_CODE = 'ai_key_invalid';

/** هل الخطأ يعني أن المفتاح ناقص أو غير صالح (أي يجب فتح نافذة التفعيل)؟ */
export function isKeyProblem(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (      error.code === AI_KEY_MISSING_CODE ||
      error.code === AI_KEY_INVALID_CODE ||
      error.code === 'ai_quota_exhausted' ||
      error.status === 401)
  );
}
