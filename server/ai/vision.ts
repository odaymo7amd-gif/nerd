// قراءة الصور بنموذج رؤية (اختياري) وتفريغ صوت الفيديو عبر Groq Whisper.
//
// لا يُستخدم أي مفتاح خادم: المفتاح يأتي من المتصفح مع طلب الرفع ويبقى في الذاكرة
// أثناء المعالجة فقط. إذا لم يوجد نموذج رؤية مضبوط أو لم يصلح الرد، يعود النظام
// إلى Tesseract المحلي بدل إفشال المحتوى كله.

import { readFile } from 'node:fs/promises';
import { HttpError } from '../http.ts';
import { readAiConfig } from './config.ts';
import { chatCompletion } from './provider.ts';
import type { PreparedImage } from '../ocr.ts';

const VISION_PROMPT = `أنت أداة استخراج نص من صور صفحات دراسية.
قواعدك:
1) استخرج كل النص المرئي كما هو، بالعربية والإنجليزية، دون تلخيص أو شرح أو إضافة.
2) حافظ على ترتيب الأسطر والعناوين والقوائم والجداول قدر الإمكان.
3) اكتب المعادلات الرياضية بصيغة LaTeX بين $...$، ولا تحاول حلّها.
4) إذا كانت الصورة غير مقروءة أو لا تحتوي نصًا، أعد السلسلة: [صورة غير مقروءة]
5) لا تكتب أي مقدمة أو تعليق عن نفسك.`;

export interface VisionResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export function visionAvailable(): boolean {
  return Boolean(readAiConfig().visionModel);
}

export async function visionExtractText(options: {
  apiKey: string;
  prepared: PreparedImage;
}): Promise<VisionResult> {
  const config = readAiConfig();
  if (!config.visionModel) {
    throw new HttpError(503, 'نموذج الرؤية غير مفعّل على الخادم.', 'vision_disabled');
  }

  const dataUrl = `data:image/jpeg;base64,${options.prepared.color.toString('base64')}`;
  const result = await chatCompletion({
    apiKey: options.apiKey,
    model: config.visionModel,
    temperature: 0,
    maxTokens: 3500,
    timeoutMs: 120_000,
    task: 'vision',
    messages: [
      { role: 'system', content: VISION_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'استخرج النص الكامل من صفحة الكتاب هذه.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  return {
    text: result.content.trim(),
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** تفريغ مقطع صوتي قصير عبر Groq. يعيد نصًا فارغًا إذا لم يكن هناك كلام واضح. */
export async function transcribeAudio(options: {
  apiKey: string;
  path: string;
  language?: string | null;
  label?: string;
}): Promise<{ text: string; model: string }> {
  const config = readAiConfig();
  const buffer = await readFile(options.path);
  if (buffer.byteLength === 0) throw new HttpError(422, 'ملف الصوت المستخرج فارغ.');
  if (buffer.byteLength > 24 * 1024 * 1024) {
    throw new HttpError(
      413,
      `مقطع الصوت${options.label ? ` (${options.label})` : ''} أكبر من حد التفريغ (24 ميغابايت). سيُقسَّم الصوت إلى مقاطع أصغر.`,
      'audio_too_large',
    );
  }

  const language = options.language?.trim() ?? config.transcribeLanguage;
  const attempts = config.maxAttempts;
  let response: Response | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', config.transcribeModel);
    if (language) form.append('language', language);
    form.append('response_format', 'json');
    form.append('temperature', '0');

    try {
      response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      const name = (error as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError' || name === 'TypeError') {
        if (attempt < attempts - 1) {
          await sleep(Math.min(15_000, config.retryBaseMs * 2 ** attempt));
          continue;
        }
        throw new HttpError(
          name === 'TimeoutError' ? 504 : 502,
          name === 'TimeoutError'
            ? 'لم ينتهِ تفريغ صوت الفيديو في الوقت المحدد.'
            : 'تعذّر الاتصال بخدمة تفريغ الصوت.',
          'transcription_network',
        );
      }
      throw error;
    }

    if (response.ok) break;
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < attempts - 1) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(30_000, retryAfter * 1000)
        : Math.min(15_000, config.retryBaseMs * 2 ** attempt);
      await sleep(wait);
      continue;
    }
    break;
  }

  if (!response) throw new HttpError(502, 'تعذّر تفريغ صوت الفيديو حاليًا.', 'transcription_failed');
  const raw = await response.text();
  if (!response.ok) {
    const short = raw.slice(0, 200);
    console.error(`[nerd/vision] فشل تفريغ الصوت ${response.status}: ${short}`);
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(401, 'مفتاح API غير صالح لتفريغ الصوت.', 'ai_key_invalid');
    }
    if (response.status === 429) {
      throw new HttpError(429, 'حد استخدام تفريغ الصوت وصل إلى حده. حاول لاحقًا.', 'ai_rate_limited');
    }
    if (response.status === 413) {
      throw new HttpError(
        413,
        'مقطع الصوت أكبر من حد التفريغ. سيُقسَّم الصوت إلى مقاطع أصغر.',
        'audio_too_large',
      );
    }
    throw new HttpError(502, 'تعذّر تفريغ صوت الفيديو حاليًا.', 'transcription_failed');
  }

  let text = '';
  try {
    const payload = JSON.parse(raw) as { text?: string };
    text = (payload.text ?? '').trim();
  } catch {
    text = raw.trim();
  }

  return { text, model: config.transcribeModel };
}
