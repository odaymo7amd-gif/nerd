// إعدادات مزوّد الذكاء الاصطناعي (Groq افتراضيًا) — تُقرأ من البيئة عند كل طلب.
// لا يوجد أي مفتاح هنا: كل مستخدم يرسل مفتاحه مع طلبه فقط، ويُستخدم في الذاكرة ثم يُنسى.
// لا يوجد مفتاح احتياطي لصاحب التطبيق ولا أي انتقال تلقائي إلى مفتاح آخر.

export interface AiConfig {
  /** اسم المزوّد المعروض في الواجهة (Groq). */
  provider: string;
  baseUrl: string;
  chatModel: string;
  /** نموذج رؤية متوافق مع OpenAI لقراءة الصور والمعادلات؛ فارغ = OCR فقط. */
  visionModel: string;
  /** نموذج تفريغ الصوت في Groq. */
  transcribeModel: string;
  /** لغة التفريغ؛ فارغة = كشف تلقائي (يدعم العربية والإنجليزية). */
  transcribeLanguage: string;
  allowedModels: string[];
  timeoutMs: number;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  batchChars: number;
  /** 0 = بلا حد ثابت؛ تُعالَج كل دفعات المحتوى الطويل. */
  maxBatches: number;
  maxOutputTokens: number;
  /** حدّ رموز أكبر للدروس التفاعلية لأنها تُعاد كـJSON كامل مرة واحدة. */
  lessonMaxOutputTokens: number;
  /** ميزانية السياق المعلنة للنموذج؛ تُستخدم لحساب حجم الطلب الآمن. */
  contextTokens: number;
  /** حد أعلى لعدد أحرف الطلب الواحد قبل الإرسال. */
  maxRequestChars: number;
  /** عدد محاولات إعادة الطلب عند الأخطاء المؤقتة. */
  maxAttempts: number;
  /** أساس الانتظار التصاعدي بالمللي ثانية. */
  retryBaseMs: number;
  /** أقصى عدد طلبات ذكاء اصطناعي متزامنة على مستوى الخادم. */
  maxConcurrency: number;
  /** حجم مجموعة دمج الملخصات الجزئية. */
  mergeGroupSize: number;
}

export const AI_KEY_HEADER = 'x-ai-key';
export const GROQ_KEYS_URL = 'https://console.groq.com/keys';

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function readAiConfig(): AiConfig {
  const baseUrl = (process.env.AI_BASE_URL ?? 'https://api.groq.com/openai/v1').trim().replace(/\/+$/, '');
  const chatModel = (process.env.AI_CHAT_MODEL ?? 'openai/gpt-oss-120b').trim();
  const visionModel = (process.env.AI_VISION_MODEL ?? '').trim();
  const transcribeModel = (process.env.AI_TRANSCRIBE_MODEL ?? 'whisper-large-v3-turbo').trim();
  const transcribeLanguage = (process.env.AI_TRANSCRIBE_LANGUAGE ?? '').trim();
  const allowedModels = (process.env.AI_ALLOWED_MODELS ?? chatModel)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (visionModel && !allowedModels.includes(visionModel)) allowedModels.push(visionModel);

  const maxOutputTokens = numberFromEnv('AI_MAX_OUTPUT_TOKENS', 1600);
  const lessonMaxOutputTokens = Math.max(1800, numberFromEnv('AI_LESSON_MAX_OUTPUT_TOKENS', 4500));
  // لا نفترض حدود نموذج معيّن: يمكن ضبط السياق من البيئة عند تغيير النموذج.
  // القيمة الافتراضية متحفظة وتترك هامشًا للتعليمات والفواصل.
  const contextTokens = numberFromEnv('AI_CONTEXT_TOKENS', 16_384);
  const computedRequestChars = Math.max(
    4_000,
    Math.floor(Math.max(2_000, contextTokens - maxOutputTokens - 512) * 2.4),
  );

  return {
    baseUrl,
    provider: (process.env.AI_PROVIDER ?? 'Groq').trim(),
    chatModel,
    visionModel,
    transcribeModel,
    transcribeLanguage,
    allowedModels: allowedModels.length > 0 ? allowedModels : [chatModel],
    timeoutMs: numberFromEnv('AI_TIMEOUT_MS', 90_000),
    inputPricePerMTok: numberFromEnv('AI_PRICE_INPUT_PER_MTOK', 0),
    outputPricePerMTok: numberFromEnv('AI_PRICE_OUTPUT_PER_MTOK', 0),
    batchChars: Math.max(2_000, numberFromEnv('AI_SUMMARY_BATCH_CHARS', 8_000)),
    maxBatches: numberFromEnv('AI_SUMMARY_MAX_BATCHES', 0),
    maxOutputTokens,
    lessonMaxOutputTokens,
    contextTokens,
    maxRequestChars: Math.max(4_000, numberFromEnv('AI_MAX_REQUEST_CHARS', computedRequestChars)),
    maxAttempts: Math.max(1, Math.floor(numberFromEnv('AI_MAX_ATTEMPTS', 4))),
    retryBaseMs: Math.max(100, numberFromEnv('AI_RETRY_BASE_MS', 900)),
    maxConcurrency: Math.max(1, Math.floor(numberFromEnv('AI_MAX_CONCURRENT', 2))),
    mergeGroupSize: Math.max(2, Math.floor(numberFromEnv('AI_SUMMARY_MERGE_GROUP', 4))),
  };
}

export function visionEnabled(): boolean {
  return Boolean(readAiConfig().visionModel);
}

export function pricesKnown(config: AiConfig): boolean {
  return config.inputPricePerMTok > 0 || config.outputPricePerMTok > 0;
}
