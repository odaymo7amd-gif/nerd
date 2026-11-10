// استخراج مفتاح المستخدم من الطلب الحالي. المفتاح لا يُخزَّن ولا يُسجَّل ولا يُعاد في أي رد.

import type { Request } from 'express';
import { HttpError } from '../http.ts';
import { AI_KEY_HEADER, GROQ_KEYS_URL } from './config.ts';
import { hasServerAiProviders } from './router.ts';

export const AI_KEY_MISSING_MESSAGE = `أضف مفتاح Groq API الخاص بك لتفعيل ميزات الذكاء الاصطناعي. احصل عليه من ${GROQ_KEYS_URL}`;

export function aiKeyFromRequest(req: Request): string {
  const key = (req.get(AI_KEY_HEADER) ?? '').trim();

  if (!key) {
    // في وضع المزودين المركزيين لا يحتاج المستخدم إلى مفتاح في المتصفح.
    // أما الوضع القديم فيبقى كما هو تمامًا.
    if (hasServerAiProviders()) return '';
    throw new HttpError(401, AI_KEY_MISSING_MESSAGE, 'ai_key_missing');
  }
  if (key.length < 16 || key.length > 400 || /[\s\u0000-\u001f\u007f]/.test(key)) {
    throw new HttpError(
      401,
      'مفتاح API غير صالح. تأكد من نسخ المفتاح بشكل صحيح من Groq.',
      'ai_key_invalid',
    );
  }
  return key;
}
