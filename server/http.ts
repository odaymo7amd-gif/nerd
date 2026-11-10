import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logSystemError } from './systemErrors.ts';

export class HttpError extends Error {
  status: number;
  /** رمز ثابت تستهلكه الواجهة للتمييز بين حالات الخطأ (مفتاح ناقص، مفتاح غير صالح، حد استخدام…). */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code ? { message: err.message, code: err.code } : { message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { message: err.issues[0]?.message ?? 'بيانات غير صحيحة.' } });
    return;
  }
  console.error('[nerd] خطأ غير متوقع:', err);
  logSystemError(err, { path: req.path, method: req.method });
  res.status(500).json({ error: { message: 'حدث خطأ غير متوقع في الخادم.' } });
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { message: 'المسار المطلوب غير موجود.' } });
}

// ---------- تحديد معدل الطلبات (في الذاكرة، لكل عنوان IP) ----------
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(options: {
  key: string;
  limit: number;
  windowMs: number;
}): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const id = `${options.key}:${ip}`;
    const now = Date.now();
    const bucket = buckets.get(id);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(id, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > options.limit) {
      res.status(429).json({
        error: { message: 'عدد المحاولات كبير. الرجاء الانتظار قليلًا ثم المحاولة مرة أخرى.' },
      });
      return;
    }
    next();
  };
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
