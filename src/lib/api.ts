export class ApiError extends Error {
  status: number;
  /** رمز الخطأ القادم من الخادم (مثل ai_key_invalid) للتمييز بين الحالات. */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(0, 'لا يوجد اتصال بالإنترنت. تحقّق من الشبكة وحاول مرة أخرى.');
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'تعذّر الوصول إلى الخادم. تحقّق من الاتصال بالإنترنت.');
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data
      ? ((data as { error?: { message?: string; code?: string } }).error ?? null)
      : null;
    throw new ApiError(response.status, error?.message ?? 'حدث خطأ غير متوقع.', error?.code);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal, headers?: Record<string, string>) =>
    request<T>(path, { signal, headers }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body, headers }),
  patch: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'PATCH', body, headers }),
  del: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'DELETE', body, headers }),
};

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-JO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-JO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatMinutes(minutes: number): string {
  if (!minutes) return '0 دقيقة';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} س ${rest} د`;
  if (hours) return `${hours} ساعة`;
  return `${rest} دقيقة`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 بايت';
  const units = ['بايت', 'كيلوبايت', 'ميغابايت', 'غيغابايت'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
