// طبقة الاتصال بمزوّد متوافق مع OpenAI `/chat/completions`.
// في الوضع القديم يأتي المفتاح من متصفح المستخدم في `X-AI-Key`، ويُستخدم في الذاكرة فقط.
// وعند تهيئة Provider A/B على الخادم يمر الطلب عبر `router.ts` ولا يُستعمل مفتاح المتصفح.

import { estimateTokens } from '../chunking.ts';
import { HttpError } from '../http.ts';
import { AI_KEY_HEADER, readAiConfig, type AiConfig } from './config.ts';

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

export interface ChatResult {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  provider: string;
}

export interface ChatCompletionOptions {
  apiKey: string;
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** جهد التفكير لنماذج gpt-oss؛ يُرسل فقط عند تحديده. */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** مهلة خاصة بالطلب (بدل مهلة الإعداد العامة). */
  timeoutMs?: number;
  /** المهمة التي أرسلت الطلب؛ يستخدمها AI Router لاختيار المزوّد والنموذج. */
  task?: string;
  /** يمنع إعادة التوجيه عند استدعاء المزوّد مباشرة من الراوتر أو من التحقق. */
  skipRouter?: boolean;
  /** إعدادات صريحة يستخدمها الراوتر لمزوّد الخادم. */
  baseUrl?: string;
  providerName?: string;
  allowedModels?: string[];
}

interface ProviderResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

export interface VerifyKeyResult {
  provider: string;
  model: string;
  modelAvailable: boolean;
  models: string[];
  phrase: string;
  verification: 'phrase';
}

/**
 * عبارة التحقق: لا يمرّ المفتاح إلا إذا كتبها النموذج نفسه في ردّه.
 * تكشف المفتاح غير الفعّال، والمفتاح الذي نفد رصيده أو حصته، ومشاكل النموذج.
 */
export const AI_VERIFICATION_PHRASE = 'انشر التطبيق لمساعدة الآخرين';

/** يوحّد النص العربي للمقارنة: يحذف التشكيل والتطويل وكل علامات الترقيم والمسافات. */
function normalizeForPhrase(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function assertModelAllowed(config: AiConfig, model: string): void {
  if (!config.allowedModels.includes(model)) {
    throw new HttpError(
      400,
      `النموذج «${model}» غير مسموح في هذا التطبيق. النماذج المتاحة: ${config.allowedModels.join(', ')}.`,
      'ai_model_unavailable',
    );
  }
}

function invalidKey(): HttpError {
  return new HttpError(401, 'مفتاح API غير صالح. تأكد من نسخ المفتاح بشكل صحيح من Groq.', 'ai_key_invalid');
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(config: AiConfig, attempt: number, response?: Response): number {
  const raw = response?.headers.get('retry-after');
  const seconds = raw ? Number(raw) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    // نحترم توجيه المزوّد لكن لا نُجمّد الطلب دقائق طويلة.
    return Math.min(30_000, Math.max(500, seconds * 1000));
  }
  const base = Math.min(15_000, config.retryBaseMs * 2 ** attempt);
  return base + Math.floor(Math.random() * Math.max(100, Math.round(base * 0.25)));
}

function rateLimited(retryAfter: string | null): HttpError {
  const wait = retryAfter ? ` أعد المحاولة بعد نحو ${retryAfter} ثانية.` : ' أعد المحاولة بعد قليل.';
  return new HttpError(
    429,
    `لقد وصلت إلى حد الاستخدام المتاح لمفتاح Groq الخاص بك. يمكنك التحقق من حدود الاستخدام في حسابك على Groq.${wait}`,
    'ai_rate_limited',
  );
}

/** حدّ تزامن بسيط على مستوى العملية حتى لا تتسبب عدة مستخدمين في موجة 429. */
let activeRequests = 0;
const requestWaiters: Array<() => void> = [];

async function acquireSlot(config: AiConfig): Promise<void> {
  if (activeRequests < config.maxConcurrency) {
    activeRequests += 1;
    return;
  }
  await new Promise<void>((resolve) => requestWaiters.push(resolve));
  activeRequests += 1;
}

function releaseSlot(): void {
  activeRequests = Math.max(0, activeRequests - 1);
  const next = requestWaiters.shift();
  if (next) next();
}

function promptChars(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => {
    if (typeof message.content === 'string') return total + message.content.length;
    return (
      total +
      message.content.reduce(
        (sum, part) => sum + (part.type === 'text' ? part.text.length : 1_200),
        0,
      )
    );
  }, 0);
}

function assertRequestFits(config: AiConfig, messages: ChatMessage[], maxTokens: number): void {
  const chars = promptChars(messages);
  if (chars > config.maxRequestChars) {
    throw new HttpError(
      413,
      `المحتوى المرسل إلى النموذج كبير جدًا (${chars.toLocaleString('ar-JO')} حرف). قسّمه إلى أجزاء أصغر ثم أعد المحاولة.`,
      'ai_request_too_large',
    );
  }
  // تقدير متحفظ للعربية؛ عدّاد المزوّد هو المرجع النهائي بعد الطلب.
  const estimatedInput = Math.ceil(chars / 2.2);
  if (estimatedInput + maxTokens > config.contextTokens) {
    throw new HttpError(
      422,
      'النص المرسل أطول من سياق النموذج المحدد. قلّل النطاق أو حجم الدفعة ثم أعد المحاولة.',
      'ai_context_too_long',
    );
  }
}

function isContextError(status: number, message: string): boolean {
  return (
    status === 413 ||
    (status === 400 && /context|token|too large|maximum|length|حجم|طويل|سياق/i.test(message))
  );
}

/**
 * التحقق الحقيقي من المفتاح: نطلب من النموذج كتابة عبارة التحقق نفسها.
 * إن كتبها فالمفتاح يعمل والنموذج متاح؛ وإن رفض المزوّد (401/429/402) أو لم يكتبها
 * فالرسالة توضّح السبب ولا يُحفظ المفتاح.
 */
export async function verifyAiKey(apiKey: string): Promise<VerifyKeyResult> {
  const config = readAiConfig();
  const result = await chatCompletion({
    apiKey,
    skipRouter: true,
    messages: [
      {
        role: 'system',
        content: 'أنت أداة تحقق آلية. أعد العبارة المطلوبة وحدها دون شرح أو إضافات.',
      },
      {
        role: 'user',
        content: `اكتب العبارة التالية حرفيًا كما هي، دون أي كلمة إضافية:\n${AI_VERIFICATION_PHRASE}`,
      },
    ],
    temperature: 0,
    maxTokens: 256,
    // نماذج التفكير قد تستهلك حدّ الرموز في التفكير وتعجز عن كتابة العبارة
    reasoningEffort: 'low',
    timeoutMs: 25_000,
  });

  if (!normalizeForPhrase(result.content).includes(normalizeForPhrase(AI_VERIFICATION_PHRASE))) {
    throw new HttpError(
      422,
      `المفتاح لم يجتز التحقق: لم يكتب النموذج عبارة «${AI_VERIFICATION_PHRASE}». قد يكون المفتاح غير فعّال أو استُهلك رصيده بالكامل. غيّر المفتاح من حسابك على Groq ثم أعد المحاولة.`,
      'ai_verification_failed',
    );
  }

  return {
    provider: config.provider,
    model: config.chatModel,
    modelAvailable: true,
    models: [],
    phrase: AI_VERIFICATION_PHRASE,
    verification: 'phrase',
  };
}

export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatResult> {
  // كل الطلبات تمر عبر AI Router افتراضيًا. الراوتر نفسه يستدعي هذه الدالة
  // مع skipRouter حتى لا تحدث إعادة توجيه لا نهائية.
  if (!options.skipRouter) {
    const { routeChatCompletion } = await import('./router.ts');
    return routeChatCompletion(options);
  }

  const config: AiConfig = {
    ...readAiConfig(),
    ...(options.baseUrl ? { baseUrl: options.baseUrl.replace(/\/+$/, '') } : {}),
    ...(options.providerName ? { provider: options.providerName } : {}),
    ...(options.allowedModels ? { allowedModels: options.allowedModels } : {}),
  };
  if (!options.apiKey || !options.apiKey.trim()) {
    throw new HttpError(
      401,
      'أضف مفتاح Groq API الخاص بك لتفعيل ميزات الذكاء الاصطناعي في نيرد.',
      'ai_key_missing',
    );
  }

  const model = (options.model ?? config.chatModel).trim();
  assertModelAllowed(config, model);
  const maxTokens = options.maxTokens ?? config.maxOutputTokens;
  assertRequestFits(config, options.messages, maxTokens);

  let response: Response | null = null;
  let lastNetworkError: Error | null = null;

  await acquireSlot(config);
  try {
    for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
      try {
        response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: options.messages,
            temperature: options.temperature ?? 0.3,
            max_tokens: maxTokens,
            ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
            stream: false,
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? config.timeoutMs),
        });
      } catch (error) {
        lastNetworkError = error instanceof Error ? error : new Error(String(error));
        const name = lastNetworkError.name;
        const isTimeout = name === 'TimeoutError' || name === 'AbortError';
        // لا نكرر المهلة أربع مرات (قد تصل الانتظارات إلى دقائق)؛ محاولة ثانية واحدة للمهلة.
        const timeoutLimit = Math.min(2, config.maxAttempts);
        const retryable = name === 'TypeError' || (isTimeout && attempt < timeoutLimit - 1);
        if (retryable && attempt < config.maxAttempts - 1) {
          await sleep(backoffMs(config, attempt));
          continue;
        }
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new HttpError(
            504,
            'لم يستجب مزوّد الذكاء الاصطناعي في الوقت المحدد. سنحاول مرة أخرى عند الطلب التالي.',
            'ai_timeout',
          );
        }
        console.error('[nerd/ai] تعذّر الوصول إلى مزوّد الذكاء الاصطناعي:', lastNetworkError.message);
        throw new HttpError(
          502,
          'تعذّر الاتصال بخدمة الذكاء الاصطناعي. تحقق من الإنترنت ثم أعد المحاولة.',
          'ai_network',
        );
      }

      if (response.ok) break;

      const status = response.status;
      const retryable = RETRYABLE_STATUS.has(status);
      if (retryable && attempt < config.maxAttempts - 1) {
        // نقرأ الجسم لتحرير الاتصال، ونسجّل الحالة فقط بلا المفتاح.
        const body = await response.text().catch(() => '');
        console.warn(
          `[nerd/ai] محاولة ${attempt + 1}/${config.maxAttempts} ردّت ${status}: ${body.slice(0, 160)}`,
        );
        await sleep(backoffMs(config, attempt, response));
        continue;
      }
      break;
    }
  } finally {
    releaseSlot();
  }

  if (!response) {
    throw new HttpError(502, 'تعذّر الاتصال بخدمة الذكاء الاصطناعي. حاول مرة أخرى.', 'ai_network');
  }

  const raw = await response.text();
  let payload: ProviderResponse = {};
  try {
    payload = raw ? (JSON.parse(raw) as ProviderResponse) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const providerMessage = String(payload.error?.message ?? raw ?? '');
    // نُسجّل الحالة ورسالة المزوّد فقط — بلا أي جزء من المفتاح
    console.error(`[nerd/ai] رد المزوّد ${response.status}: ${providerMessage.slice(0, 240)}`);

    if (response.status === 401 || response.status === 403) throw invalidKey();
    if (response.status === 402) {
      throw new HttpError(
        402,
        'انتهت حصة مفتاح Groq أو رصيده. أضف رصيدًا أو غيّر المفتاح من حسابك على Groq ثم أعد المحاولة.',
        'ai_quota_exhausted',
      );
    }
    if (response.status === 429) throw rateLimited(response.headers.get('retry-after'));
    if (response.status === 404) {
      throw new HttpError(
        502,
        `النموذج «${model}» غير متاح لمفتاحك على Groq. جرّب لاحقًا أو أبلغ المشرف لاختيار نموذج آخر.`,
        'ai_model_unavailable',
      );
    }
    if (response.status === 413 || isContextError(response.status, providerMessage)) {
      throw new HttpError(
        413,
        'حجم المحتوى المرسل أكبر من حد النموذج. قسّمه إلى أجزاء أصغر ثم أعد المحاولة؛ لن يُفقد النص المستخرج.',
        'ai_request_too_large',
      );
    }
    throw new HttpError(
      502,
      'حدثت مشكلة مؤقتة في خدمة الذكاء الاصطناعي بعد عدة محاولات. حاول مرة أخرى لاحقًا.',
      'ai_unavailable',
    );
  }

  const choice = payload.choices?.[0];
  const content = choice?.message?.content?.trim() ?? '';
  if (!content) {
    // نماذج «التفكير» تستهلك حدّ الرموز في التفكير وقد تعود بلا نص أصلًا
    if (choice?.finish_reason === 'length') {
      throw new HttpError(
        502,
        'انتهى حدّ الرموز قبل أن يكتب النموذج ردًا. اطلب نطاقًا أصغر أو حاول مرة أخرى.',
        'ai_output_truncated',
      );
    }
    throw new HttpError(
      502,
      'أعاد مزوّد الذكاء الاصطناعي ردًا فارغًا. حاول مرة أخرى.',
      'ai_empty_response',
    );
  }

  const chars = promptChars(options.messages);
  return {
    content,
    model: payload.model ?? model,
    tokensIn: payload.usage?.prompt_tokens ?? estimateTokens('x'.repeat(chars)),
    tokensOut: payload.usage?.completion_tokens ?? estimateTokens(content),
    provider: config.provider,
  };
}

export { AI_KEY_HEADER };
