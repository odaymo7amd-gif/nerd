// الاختبارات: توليد أسئلة من نص الكتاب (RAG) بمزوّد النموذج، ثم جلسة اختبار بمؤقت،
// تصحيح آلي على الخادم، ومراجعة الإجابات مع رقم الصفحة والشرح.
// التصحيح لا يعتمد على الواجهة إطلاقًا: الإجابات الصحيحة لا تُرسل إلا بعد التسليم.

import { all, get, run } from '../db.ts';
import { createNotification, logActivity } from '../auth.ts';
import { HttpError } from '../http.ts';
import { normalizeArabic } from '../chunking.ts';
import { pricesKnown, readAiConfig, type AiConfig } from './config.ts';
import { chatCompletion, type ChatMessage } from './provider.ts';
import { assertQuota, recordUsage, usageToday, dailyLimitPerUser } from './usage.ts';
import {
  chunksForBook,
  groupByBatch,
  pagesOf,
  retrieveChunks,
  type ChunkRef,
  type PageRange,
} from './retrieval.ts';

export type QuestionType =
  | 'mcq'
  | 'true_false'
  | 'short'
  | 'fill_blank'
  | 'explain'
  | 'compare'
  | 'essay'
  | 'math';
export type TestDifficulty = 'easy' | 'medium' | 'hard' | 'advanced' | 'mixed';

export const QUESTION_TYPES: QuestionType[] = [
  'mcq',
  'true_false',
  'short',
  'fill_blank',
  'explain',
  'compare',
  'essay',
  'math',
];
export const TEXT_QUESTION_TYPES: QuestionType[] = [
  'short',
  'fill_blank',
  'explain',
  'compare',
  'essay',
  'math',
];
export const DIFFICULTIES: TestDifficulty[] = ['easy', 'medium', 'hard', 'advanced'];

export const TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'اختيار من متعدد',
  true_false: 'صح أو خطأ',
  short: 'إجابة قصيرة',
  fill_blank: 'أكمل الفراغ',
  explain: 'علّل',
  compare: 'قارن',
  essay: 'سؤال مقالي',
  math: 'مسألة حسابية',
};

export const DIFFICULTY_LABELS: Record<TestDifficulty, string> = {
  easy: 'سهل',
  medium: 'متوسط',
  hard: 'صعب',
  advanced: 'قدرات عليا',
  mixed: 'متنوّع',
};

const DIFFICULTY_INSTRUCTIONS: Record<TestDifficulty, string> = {
  easy: 'أسئلة مباشرة على التعريفات والمعلومات الواضحة في النص.',
  medium: 'أسئلة فهم وتطبيق: تفسير المعنى، المقارنة، واستنتاج الفكرة.',
  hard: 'أسئلة تحليل واستنتاج تحتاج ربط معلومات من أكثر من موضع في النص.',
  advanced: 'أسئلة قدرات عليا على النمط الوزاري الأردني وليست أسئلة وزارية حقيقية: تحليل، ربط بين أكثر من مفهوم، استنتاج من السياق، خيارات متقاربة جدًا، واكتشاف أخطاء دقيقة. تحتاج كل مسألة إلى أكثر من خطوة ذهنية، مع البقاء داخل النص المرفق.',
  mixed: 'نوّع الصعوبة: أسئلة مباشرة، وأسئلة فهم، وسؤال أو سؤالان تحليليان.',
};

export interface DraftQuestion {
  type: QuestionType;
  text: string;
  options: string[];
  correctIndex: number | null;
  answer: string | null;
  accept: string[];
  explanation: string;
  page: number | null;
}

interface TestRow {
  id: number;
  user_id: number;
  book_id: number | null;
  content_id: number | null;
  content_version: number | null;
  subject_id: number | null;
  title: string;
  questions_count: number;
  duration_minutes: number | null;
  per_question_seconds: number | null;
  timed: number;
  show_answers: string;
  status: string;
  created_at: string;
  book_title?: string | null;
}

interface AttemptRow {
  id: number;
  test_id: number;
  user_id: number;
  started_at: string;
  finished_at: string | null;
  score: number | null;
  total: number;
  time_spent_seconds: number;
  status: 'in_progress' | 'finished' | 'abandoned';
}

interface QuestionRow {
  tq_id: number;
  sort_order: number;
  q_id: number;
  type: string;
  difficulty: string;
  text: string;
  correct_answer: string | null;
  explanation: string | null;
  source_page: number | null;
}

interface OptionRow {
  id: number;
  question_id: number;
  text: string;
  is_correct: number;
  sort_order: number;
}

function ownedBook(userId: number, bookId: number) {
  const book = get<{
    id: number;
    title: string;
    status: string;
    pages_count: number;
    subject_name: string | null;
    grade_name: string | null;
    unit_name: string | null;
  }>(
    `SELECT b.id, b.title, b.status, b.pages_count, b.unit_name,
            s.name_ar AS subject_name, g.name_ar AS grade_name
       FROM books b
       LEFT JOIN subjects s ON s.id = b.subject_id
       LEFT JOIN grade_levels g ON g.id = b.grade_level_id
      WHERE b.id = ? AND b.user_id = ?`,
    bookId,
    userId,
  );
  if (!book) throw new HttpError(404, 'الكتاب غير موجود.');
  if (book.status !== 'ready') {
    throw new HttpError(409, 'الكتاب ما زال قيد المعالجة. انتظر اكتمال استخراج النص ثم أنشئ الاختبار.');
  }
  return book;
}

function ownedTest(userId: number, testId: number): TestRow {
  const test = get<TestRow>('SELECT * FROM tests WHERE id = ? AND user_id = ?', testId, userId);
  if (!test) throw new HttpError(404, 'الاختبار غير موجود.');
  return test;
}

function resolveRange(
  book: { pages_count: number },
  from: number | null | undefined,
  to: number | null | undefined,
): PageRange | null {
  if (from == null && to == null) return null;
  const start = from ?? 1;
  const end = to ?? book.pages_count;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
    throw new HttpError(400, 'نطاق الصفحات غير صحيح.');
  }
  if (start > end) throw new HttpError(400, 'بداية النطاق يجب أن تكون قبل نهايته.');
  if (end > book.pages_count) {
    throw new HttpError(400, `عدد صفحات الكتاب ${book.pages_count}، والنطاق المطلوب يتجاوزها.`);
  }
  return { from: start, to: end };
}

function pickBatches(batches: ChunkRef[][], wanted: number): ChunkRef[][] {
  if (batches.length <= wanted) return batches;
  if (wanted <= 1) return [batches[Math.floor((batches.length - 1) / 2)]];
  const step = (batches.length - 1) / (wanted - 1);
  const picked: ChunkRef[][] = [];
  for (let index = 0; index < wanted; index += 1) {
    picked.push(batches[Math.round(index * step)]);
  }
  return picked;
}

function distributeCount(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

// يحتفظ بالدالة للاستخدام في أدوات أخرى، لكن توليد الاختبار لم يعد يعتمد على
// عينة واحدة تستبعد بقية المحتوى.
export function spreadChunks(chunks: ChunkRef[], budgetChars: number): ChunkRef[] {
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  if (totalChars <= budgetChars || chunks.length <= 4) return chunks;
  const average = totalChars / chunks.length;
  const maxPieces = Math.max(4, Math.floor(budgetChars / Math.max(average, 1)));
  if (maxPieces >= chunks.length) return chunks;
  const step = (chunks.length - 1) / (maxPieces - 1);
  const picked: ChunkRef[] = [];
  for (let index = 0; index < maxPieces; index += 1) {
    picked.push(chunks[Math.round(index * step)]);
  }
  return picked;
}

function buildPrompt(options: {
  book: { title: string; subject_name: string | null; grade_name: string | null; unit_name: string | null; pages_count: number };
  range: PageRange | null;
  count: number;
  difficulty: TestDifficulty;
  types: QuestionType[];
  focus: string | null;
  chunks: ChunkRef[];
  existing?: string[];
}): ChatMessage[] {
  const { book, range, count, difficulty, types, focus, chunks, existing = [] } = options;
  const excerpts = chunks
    .map((chunk) => `[صفحة ${chunk.pageFrom === chunk.pageTo ? chunk.pageFrom : `${chunk.pageFrom}-${chunk.pageTo}`}]\n${chunk.content}`)
    .join('\n---\n');
  const rangeLabel = range ? `الصفحات ${range.from}–${range.to}` : `الكتاب كاملًا (${book.pages_count} صفحة)`;

  return [
    {
      role: 'system',
      content: `أنت معلم عربي يكتب أسئلة اختبارية دقيقة من نص كتاب مدرسي داخل تطبيق NERD.
قواعدك الصارمة:
1) اكتب الأسئلة من المقاطع المرفقة فقط، ولا تُضف معلومة من خارجها.
2) كل سؤال يجب أن تكون إجابته الصحيحة مثبتة في النص المرفق؛ إن لم تكن مثبتة فلا تكتب السؤال.
3) اذكر رقم صفحة السؤال في الحقل page، ويكون رقمًا صحيحًا من الصفحات المذكورة في المقاطع.
4) اكتب شرحًا قصيرًا (سطر إلى سطرين) يوضح سبب صحة الإجابة، ويمكنك اقتباس عبارة قصيرة من النص.
5) لا تكرر السؤال نفسه أو الفكرة نفسها بصياغتين؛ غطِّ أكبر عدد ممكن من الصفحات.
6) اجعل الخيارات الخاطئة خطأً واضحًا حسب النص، ولا تضع فيها معلومة غير واردة في المقاطع.
7) لا تكتب أي نص خارج مصفوفة JSON. لا شرح ولا مقدمة ولا أسوار كود.
8) اكتب بعربية فصحى واضحة، وراجع كل سؤال قبل إخراجه: هل يمكن الإجابة عنه من النص وحده؟`,
    },
    {
      role: 'user',
      content: [
        `الكتاب: ${book.title}`,
        book.subject_name ? `المادة: ${book.subject_name}` : null,
        book.grade_name ? `الصف: ${book.grade_name}` : null,
        book.unit_name ? `الوحدة: ${book.unit_name}` : null,
        `النطاق: ${rangeLabel}`,
        focus ? `ركّز على: ${focus}` : null,
        `عدد الأسئلة المطلوب: ${count}`,
        `مستوى الصعوبة: ${DIFFICULTY_LABELS[difficulty]} — ${DIFFICULTY_INSTRUCTIONS[difficulty]}`,
        `أنواع الأسئلة المطلوبة: ${types.map((type) => TYPE_LABELS[type]).join('، ')} (${types.join(', ')})`,
        difficulty === 'advanced'
          ? 'اكتب أسئلة على النمط الوزاري الأردني، وليست أسئلة وزارية حقيقية، واجعلها تحليلية متعددة الخطوات.'
          : null,
        existing.length > 0
          ? `لا تكرر هذه الأسئلة أو أفكارها:\n${existing.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
          : null,
        '',
        'المقاطع:',
        excerpts,
        '',
        'أعد مصفوفة JSON فقط بهذا الشكل:',
        '[{"type":"mcq","question":"نص السؤال","options":["خيار 1","خيار 2","خيار 3","خيار 4"],"correctIndex":0,"explanation":"سبب الصحة","page":12},',
        ' {"type":"true_false","question":"نص العبارة","correctIndex":1,"explanation":"سبب الصحة","page":14},',
        ' {"type":"short","question":"نص السؤال","answer":"الإجابة النموذجية","accept":["صيغة أخرى مقبولة"],"explanation":"سبب الصحة","page":16},',
        ' {"type":"fill_blank","question":"أكمل: ...... هو ...","answer":"الكلمة الناقصة","accept":["صيغة بديلة"],"explanation":"سبب الصحة","page":18},',
        ' {"type":"explain","question":"علّل: ...","answer":"التعليل النموذجي","explanation":"سبب الصحة","page":20},',
        ' {"type":"compare","question":"قارن بين ... و...","answer":"أوجه الشبه والاختلاف","explanation":"سبب الصحة","page":22},',
        ' {"type":"essay","question":"اكتب في ...","answer":"عناصر الإجابة النموذجية","explanation":"معايير التقييم","page":24},',
        ' {"type":"math","question":"مسألة حسابية من النص","answer":"الحل والخطوات والنتيجة","explanation":"خطوات الحل","page":26}]',
        `عدد العناصر في المصفوفة يجب أن يكون ${count}، وبنفس الأنواع المطلوبة فقط.`,
        'إن كان المحتوى المرفق لا يكفي لتوليد هذا العدد دون اختراع معلومات، فولّد أقل من العدد المطلوب فقط، ولا تخترع سؤالًا لا يمكن الإجابة عنه من النص.',
        'وزّع الأسئلة على الصفحات المذكورة، ولا تكرر الفكرة نفسها في أكثر من سؤال.',
        'كل خيار خاطئ يجب أن يكون خطأً حسب النص، لا حسب معرفة عامة من خارج الكتاب.',
        'في صح/خطأ: correctIndex = 0 تعني «صح» و1 تعني «خطأ»، ولا تكتب خيارات.',
        'في الأنواع النصية (short, fill_blank, explain, compare, essay, math): answer هي الإجابة النموذجية، وaccept صيغ بديلة مقبولة (اختياري).',
        'في المسائل الحسابية: اكتب خطوات الحل كاملة والنتيجة في answer، ولا تخترع أرقامًا غير موجودة في النص.',
      ]
        .filter((line) => line !== null)
        .join('\n'),
    },
  ];
}

function extractJsonArray(text: string): unknown[] | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function encodeTextAnswer(draft: DraftQuestion): string | null {
  if (!TEXT_QUESTION_TYPES.includes(draft.type)) return null;
  return JSON.stringify({ answer: draft.answer ?? '', accept: draft.accept });
}

function parseTextAnswer(raw: string | null): { answer: string; accept: string[] } {
  if (!raw) return { answer: '', accept: [] };
  if (raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { answer?: unknown; accept?: unknown };
      return {
        answer: typeof parsed.answer === 'string' ? parsed.answer : '',
        accept: Array.isArray(parsed.accept)
          ? parsed.accept.filter((item): item is string => typeof item === 'string')
          : [],
      };
    } catch {
      return { answer: raw, accept: [] };
    }
  }
  return { answer: raw, accept: [] };
}

function normalizeDrafts(
  raw: unknown[],
  options: { count: number; types: QuestionType[]; pagesCount: number; allowedPages?: Set<number> },
): DraftQuestion[] {
  const normalized: DraftQuestion[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const type = asText(record.type) as QuestionType;
    if (!QUESTION_TYPES.includes(type)) continue;
    if (!options.types.includes(type)) continue;

    const text = asText(record.question ?? record.text);
    if (text.length < 8) continue;
    const key = normalizeArabic(text);
    if (seen.has(key)) continue;

    const explanation = asText(record.explanation);
    const pageValue = Number(record.page);
    const pageInRange =
      Number.isInteger(pageValue) && pageValue >= 1 && pageValue <= options.pagesCount;
    // لا نقبل صفحة لم تكن ضمن المقاطع التي قرأها النموذج فعلًا؛ قد تكون مختلقة.
    const page = pageInRange && (!options.allowedPages || options.allowedPages.has(pageValue)) ? pageValue : null;

    if (TEXT_QUESTION_TYPES.includes(type)) {
      const answer = asText(record.answer);
      if (answer.length < 1) continue;
      const acceptRaw = Array.isArray(record.accept) ? record.accept : [];
      const accept = acceptRaw.map(asText).filter((value) => value.length > 0).slice(0, 6);
      normalized.push({
        type,
        text,
        options: [],
        correctIndex: null,
        answer,
        accept,
        explanation,
        page,
      });
      seen.add(key);
      continue;
    }

    let choices: string[];
    let correctIndex: number;

    if (type === 'true_false') {
      choices = ['صح', 'خطأ'];
      const rawIndex = Number(record.correctIndex ?? record.correct_index);
      const rawAnswer = asText(record.answer ?? record.correctAnswer);
      if (Number.isInteger(rawIndex) && (rawIndex === 0 || rawIndex === 1)) {
        correctIndex = rawIndex;
      } else if (rawAnswer === 'صح' || rawAnswer === 'خطأ') {
        correctIndex = rawAnswer === 'صح' ? 0 : 1;
      } else {
        continue;
      }
    } else {
      const rawOptions = Array.isArray(record.options) ? record.options : [];
      choices = rawOptions.map(asText).filter((value) => value.length > 0).slice(0, 5);
      if (choices.length < 3) continue;
      const rawIndex = Number(record.correctIndex ?? record.correct_index);
      if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= choices.length) continue;
      correctIndex = rawIndex;
    }

    normalized.push({
      type,
      text,
      options: choices,
      correctIndex,
      answer: null,
      accept: [],
      explanation,
      page,
    });
    seen.add(key);
  }

  return normalized.slice(0, options.count);
}

const inFlight = new Set<number>();

export interface CreateTestInput {
  userId: number;
  apiKey: string;
  bookId: number;
  contentId?: number | null;
  contentVersion?: number | null;
  count: number;
  difficulty: TestDifficulty;
  types: QuestionType[];
  focus?: string | null;
  pageFrom?: number | null;
  pageTo?: number | null;
  durationMinutes?: number | null;
  timed?: boolean;
  showAnswers?: 'after_finish' | 'after_each';
}

async function callModel(
  config: AiConfig,
  userId: number,
  apiKey: string,
  messages: ChatMessage[],
  task: string,
  maxTokens: number,
): Promise<{ content: string; tokensIn: number; tokensOut: number; model: string; provider: string }> {
  try {
    const result = await chatCompletion({
      apiKey,
      messages,
      model: config.chatModel,
      maxTokens,
      temperature: 0.4,
      task,
    });
    recordUsage({
      userId,
      task,
      model: result.model,
      provider: result.provider,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      status: 'success',
    });
    return result;
  } catch (error) {
    recordUsage({
      userId,
      task,
      model: config.chatModel,
      provider: config.provider,
      tokensIn: 0,
      tokensOut: 0,
      status: 'failed',
    });
    throw error;
  }
}

export async function createTest(input: CreateTestInput) {
  const config = readAiConfig();
  if (inFlight.has(input.userId)) {
    throw new HttpError(409, 'لديك اختبار قيد الإنشاء الآن. انتظر انتهاءه قبل طلب اختبار آخر.');
  }

  const book = ownedBook(input.userId, input.bookId);
  const range = resolveRange(book, input.pageFrom, input.pageTo);
  const focus = input.focus?.trim() || null;

  let chunks: ChunkRef[];
  if (focus) {
    chunks = retrieveChunks(input.userId, { bookId: book.id, query: focus, range, limit: 12 });
    if (chunks.length === 0) {
      throw new HttpError(
        422,
        `لم أجد في هذا النطاق مقاطع تتعلق بـ«${focus}». جرّب كلمات من الكتاب نفسه أو وسّع نطاق الصفحات.`,
      );
    }
  } else {
    chunks = chunksForBook(input.userId, book.id, range);
  }
  if (chunks.length === 0) {
    throw new HttpError(422, 'لا يوجد نص مستخرج في هذا النطاق. الصفحات قد تكون صورًا غير مقروءة.');
  }

  // لا نأخذ عينة من أول النص أو نوزّعها ونهمل الباقي: نقسّم كل المحتوى إلى
  // دفعات آمنة، نولّد أسئلة من كل دفعة، ثم ندمج ونجري إزالة تكرار على النتيجة.
  const batches = groupByBatch(chunks, config.batchChars);
  const activeBatches = pickBatches(batches, Math.max(1, input.count));
  const shares = distributeCount(input.count, activeBatches.length);

  assertQuota(input.userId, activeBatches.length);
  inFlight.add(input.userId);

  try {
    let tokensIn = 0;
    let tokensOut = 0;
    let requests = 0;
    let failedBatches = 0;
    let firstError: unknown = null;
    const drafts: DraftQuestion[] = [];

    for (let index = 0; index < activeBatches.length; index += 1) {
      const batch = activeBatches[index];
      const count = shares[index] ?? 0;
      if (count <= 0) continue;
      const prompt = buildPrompt({
        book,
        range,
        count,
        difficulty: input.difficulty,
        types: input.types,
        focus,
        chunks: batch,
      });
      const maxTokens = Math.min(4000, 600 + count * 220);
      try {
        const call = await callModel(
          config,
          input.userId,
          input.apiKey,
          prompt,
          'test-generate',
          maxTokens,
        );
        requests += 1;
        tokensIn += call.tokensIn;
        tokensOut += call.tokensOut;
        const rawQuestions = extractJsonArray(call.content);
        if (!rawQuestions) {
          failedBatches += 1;
          continue;
        }
        drafts.push(
          ...normalizeDrafts(rawQuestions, {
            count,
            types: input.types,
            pagesCount: book.pages_count,
            allowedPages: new Set(pagesOf(batch)),
          }),
        );
      } catch (error) {
        failedBatches += 1;
        if (firstError == null) firstError = error;
        console.warn(`[nerd/tests] تعذّرت الدفعة ${index + 1}/${activeBatches.length}:`, error);
      }
    }

    const unique: DraftQuestion[] = [];
    const seen = new Set<string>();
    for (const draft of drafts) {
      const key = normalizeArabic(draft.text);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(draft);
      if (unique.length >= input.count) break;
    }

    // إذا لم تكتمل الدفعات الأولى، نطلب الناقص فقط من المصدر نفسه في محاولات
    // محدودة، ونحتفظ بكل سؤال صالح بدل إنشاء اختبار بعدد أقل أو إعادة كل شيء.
    for (let attempt = 0; attempt < 3 && unique.length < input.count; attempt += 1) {
      const missing = input.count - unique.length;
      const retryBatches = pickBatches(batches, Math.max(1, Math.min(missing, 3)));
      const shares = distributeCount(missing, retryBatches.length);
      assertQuota(input.userId, retryBatches.length);

      for (let batchIndex = 0; batchIndex < retryBatches.length; batchIndex += 1) {
        if (unique.length >= input.count) break;
        const batch = retryBatches[batchIndex];
        const count = shares[batchIndex] ?? 0;
        if (count <= 0) continue;
        const prompt = buildPrompt({
          book,
          range,
          count,
          difficulty: input.difficulty,
          types: input.types,
          focus,
          chunks: batch,
          existing: unique.map((question) => question.text),
        });
        try {
          const call = await callModel(
            config,
            input.userId,
            input.apiKey,
            prompt,
            'test-generate',
            Math.min(4000, 600 + count * 220),
          );
          requests += 1;
          tokensIn += call.tokensIn;
          tokensOut += call.tokensOut;
          const rawQuestions = extractJsonArray(call.content);
          if (!rawQuestions) continue;
          const extra = normalizeDrafts(rawQuestions, {
            count,
            types: input.types,
            pagesCount: book.pages_count,
            allowedPages: new Set(pagesOf(batch)),
          });
          for (const draft of extra) {
            const key = normalizeArabic(draft.text);
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(draft);
            if (unique.length >= input.count) break;
          }
        } catch (error) {
          if (firstError == null) firstError = error;
          console.warn(`[nerd/tests] تعذّرت محاولة إكمال الأسئلة ${attempt + 1}:`, error);
        }
      }
    }

    if (unique.length === 0 && firstError instanceof HttpError) throw firstError;
    if (unique.length < input.count) {
      throw new HttpError(
        502,
        `لم يكتمل الاختبار: وصل ${unique.length} سؤالًا صالحًا من أصل ${input.count}. لم يُحفظ اختبار ناقص. أعد المحاولة؛ سيطلب النظام الأسئلة الناقصة فقط.`,
        'test_incomplete',
      );
    }

    const draftsFinal = unique;

    const timed = input.timed !== false;
    const durationMinutes = timed
      ? (input.durationMinutes ?? Math.max(3, Math.ceil((draftsFinal.length * 75) / 60)))
      : null;
    const perQuestion = durationMinutes ? Math.round((durationMinutes * 60) / draftsFinal.length) : null;
    const title = `${book.title}${focus ? ` — ${focus}` : ''}`.slice(0, 150);

    const createdTest = run(
      `INSERT INTO tests (user_id, book_id, content_id, content_version, title, questions_count, duration_minutes, per_question_seconds, timed, show_answers, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
      input.userId,
      book.id,
      input.contentId ?? null,
      input.contentVersion ?? null,
      title,
      draftsFinal.length,
      durationMinutes,
      perQuestion,
      timed ? 1 : 0,
      input.showAnswers ?? 'after_finish',
    );

    const testId = createdTest.lastInsertRowid;
    draftsFinal.forEach((draft, index) => {
      const question = run(
        `INSERT INTO questions (user_id, book_id, type, difficulty, text, correct_answer, explanation, source_page)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        input.userId,
        book.id,
        draft.type,
        input.difficulty,
        draft.text,
        encodeTextAnswer(draft),
        draft.explanation || null,
        draft.page,
      );
      if ((draft.type === 'mcq' || draft.type === 'true_false') && draft.correctIndex != null) {
        draft.options.forEach((option, optionIndex) => {
          run(
            'INSERT INTO question_options (question_id, text, is_correct, sort_order) VALUES (?, ?, ?, ?)',
            question.lastInsertRowid,
            option,
            optionIndex === draft.correctIndex ? 1 : 0,
            optionIndex,
          );
        });
      }
      run(
        'INSERT INTO test_questions (test_id, question_id, sort_order) VALUES (?, ?, ?)',
        testId,
        question.lastInsertRowid,
        index,
      );
    });

    logActivity(
      input.userId,
      'test',
      `اختبار «${book.title}»`,
      `${draftsFinal.length} سؤالًا · ${DIFFICULTY_LABELS[input.difficulty]} · ${range ? `الصفحات ${range.from}–${range.to}` : 'الكتاب كاملًا'}`,
    );

    const warning =
      failedBatches > 0
        ? `تعذّرت معالجة ${failedBatches} من ${activeBatches.length} دفعات، لكن اكتمل العدد المطلوب من المصدر نفسه.`
        : null;

    return {
      test: getTest(input.userId, testId),
      warning,
      usage: {
        requests: Math.max(1, requests),
        tokensIn,
        tokensOut,
        costKnown: pricesKnown(config),
        costUsd:
          (tokensIn / 1_000_000) * config.inputPricePerMTok +
          (tokensOut / 1_000_000) * config.outputPricePerMTok,
        remainingToday: Math.max(0, dailyLimitPerUser() - usageToday(input.userId).requests),
      },
    };
  } finally {
    inFlight.delete(input.userId);
  }
}

export interface ManualQuestionInput {
  type: QuestionType;
  text: string;
  options?: string[] | null;
  correctIndex?: number | null;
  answer?: string | null;
  accept?: string[] | null;
  explanation?: string | null;
  page?: number | null;
}

export interface ManualTestInput {
  userId: number;
  title: string;
  difficulty: TestDifficulty;
  durationMinutes?: number | null;
  questions: ManualQuestionInput[];
}

/**
 * اختبار يكتبه الطالب/المعلم بنفسه — لا يحتاج مزوّد ذكاء اصطناعي ولا يستهلك حدّه اليومي.
 * يمرّ على نفس قواعد التحقق التي تمرّ عليها أسئلة المزوّد، فلا يدخل سؤال ناقص إلى قاعدة البيانات.
 */
export function createManualTest(input: ManualTestInput) {
  if (input.questions.length === 0) throw new HttpError(422, 'أضف سؤالًا واحدًا على الأقل.');
  if (input.questions.length > 50) throw new HttpError(422, 'الحد الأقصى للاختبار اليدوي 50 سؤالًا.');

  const drafts = normalizeDrafts(
    input.questions.map((question) => ({
      type: question.type,
      question: question.text,
      options: question.options ?? [],
      correctIndex: question.correctIndex ?? null,
      answer: question.answer ?? '',
      accept: question.accept ?? [],
      explanation: question.explanation ?? '',
      page: question.page ?? null,
    })),
    { count: input.questions.length, types: QUESTION_TYPES, pagesCount: 100_000 },
  );

  if (drafts.length !== input.questions.length) {
    throw new HttpError(
      422,
      'بعض الأسئلة غير مكتملة أو مكرّرة. المطلوب لكل سؤال: نص من 8 أحرف على الأقل، وخياران على الأقل مع تحديد الإجابة الصحيحة (سؤال الاختيار يحتاج 3 خيارات)، أو إجابة نموذجية للسؤال القصير — بلا تكرار للسؤال نفسه.',
    );
  }

  const durationMinutes =
    input.durationMinutes ?? Math.max(3, Math.ceil((drafts.length * 75) / 60));
  const perQuestion = Math.round((durationMinutes * 60) / drafts.length);
  const title = (input.title.trim() || 'اختبار يدوي').slice(0, 150);

  const createdTest = run(
    `INSERT INTO tests (user_id, book_id, title, questions_count, duration_minutes, per_question_seconds, status)
     VALUES (?, NULL, ?, ?, ?, ?, 'ready')`,
    input.userId,
    title,
    drafts.length,
    durationMinutes,
    perQuestion,
  );

  const testId = createdTest.lastInsertRowid;
  drafts.forEach((draft, index) => {
    const question = run(
      `INSERT INTO questions (user_id, book_id, type, difficulty, text, correct_answer, explanation, source_page)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
      input.userId,
      draft.type,
      input.difficulty,
      draft.text,
      encodeTextAnswer(draft),
      draft.explanation || null,
      draft.page,
    );
    if ((draft.type === 'mcq' || draft.type === 'true_false') && draft.correctIndex != null) {
      draft.options.forEach((option, optionIndex) => {
        run(
          'INSERT INTO question_options (question_id, text, is_correct, sort_order) VALUES (?, ?, ?, ?)',
          question.lastInsertRowid,
          option,
          optionIndex === draft.correctIndex ? 1 : 0,
          optionIndex,
        );
      });
    }
    run(
      'INSERT INTO test_questions (test_id, question_id, sort_order) VALUES (?, ?, ?)',
      testId,
      question.lastInsertRowid,
      index,
    );
  });

  logActivity(
    input.userId,
    'test',
    `اختبار «${title}»`,
    `${drafts.length} سؤالًا مكتوبة يدويًا · ${DIFFICULTY_LABELS[input.difficulty]}`,
  );

  return { test: getTest(input.userId, testId) };
}

export function serializeTestRow(row: TestRow) {
  return {
    id: row.id,
    title: row.title,
    bookId: row.book_id,
    contentId: row.content_id,
    contentVersion: row.content_version,
    bookTitle: row.book_title ?? null,
    questionsCount: row.questions_count,
    durationMinutes: row.duration_minutes,
    perQuestionSeconds: row.per_question_seconds,
    timed: Boolean(row.timed),
    showAnswers: row.show_answers,
    status: row.status,
    createdAt: row.created_at,
  };
}

function questionRows(testId: number): QuestionRow[] {
  return all<QuestionRow>(
    `SELECT tq.id AS tq_id, tq.sort_order, q.id AS q_id, q.type, q.difficulty, q.text,
            q.correct_answer, q.explanation, q.source_page
       FROM test_questions tq
       JOIN questions q ON q.id = tq.question_id
      WHERE tq.test_id = ?
      ORDER BY tq.sort_order, tq.id`,
    testId,
  );
}

function optionsFor(questionIds: number[]): Map<number, OptionRow[]> {
  const map = new Map<number, OptionRow[]>();
  if (questionIds.length === 0) return map;
  const placeholders = questionIds.map(() => '?').join(', ');
  const rows = all<OptionRow>(
    `SELECT id, question_id, text, is_correct, sort_order
       FROM question_options
      WHERE question_id IN (${placeholders})
      ORDER BY sort_order, id`,
    ...questionIds,
  );
  for (const row of rows) {
    const list = map.get(row.question_id) ?? [];
    list.push(row);
    map.set(row.question_id, list);
  }
  return map;
}

function attemptsOf(testId: number, userId: number): AttemptRow[] {
  return all<AttemptRow>(
    `SELECT * FROM test_attempts WHERE test_id = ? AND user_id = ? ORDER BY started_at DESC, id DESC`,
    testId,
    userId,
  );
}

function serializeAttempt(row: AttemptRow) {
  return {
    id: row.id,
    testId: row.test_id,
    status: row.status,
    score: row.score,
    total: row.total,
    timeSpentSeconds: row.time_spent_seconds,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function listTests(userId: number) {
  const rows = all<TestRow & { attempts_count: number; best_score: number | null; last_attempt_at: string | null }>(
    `SELECT t.*, b.title AS book_title,
            (SELECT COUNT(*) FROM test_attempts a WHERE a.test_id = t.id AND a.user_id = t.user_id AND a.status = 'finished') AS attempts_count,
            (SELECT MAX(a.score) FROM test_attempts a WHERE a.test_id = t.id AND a.user_id = t.user_id AND a.status = 'finished') AS best_score,
            (SELECT MAX(a.finished_at) FROM test_attempts a WHERE a.test_id = t.id AND a.user_id = t.user_id AND a.status = 'finished') AS last_attempt_at
       FROM tests t
       LEFT JOIN books b ON b.id = t.book_id
      WHERE t.user_id = ?
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 100`,
    userId,
  );

  const summary = get<{ tests_completed: number; questions_answered: number; average: number | null }>(
    `SELECT COUNT(*) AS tests_completed,
            COALESCE(SUM(a.total), 0) AS questions_answered,
            AVG(a.score) AS average
       FROM test_attempts a
      WHERE a.user_id = ? AND a.status = 'finished'`,
    userId,
  );

  return {
    tests: rows.map((row) => ({
      ...serializeTestRow(row),
      attemptsCount: row.attempts_count,
      bestScore: row.best_score,
      lastAttemptAt: row.last_attempt_at,
    })),
    stats: {
      testsCreated: rows.length,
      testsCompleted: summary?.tests_completed ?? 0,
      questionsAnswered: summary?.questions_answered ?? 0,
      averageScore: summary?.average != null ? Math.round(summary.average) : null,
    },
  };
}

export function getTest(userId: number, testId: number) {
  const test = ownedTest(userId, testId);
  const book = test.book_id
    ? get<{ title: string }>('SELECT title FROM books WHERE id = ?', test.book_id)
    : undefined;
  const rows = questionRows(testId);
  const options = optionsFor(rows.map((row) => row.q_id));

  const active = get<AttemptRow>(
    `SELECT * FROM test_attempts
      WHERE test_id = ? AND user_id = ? AND status = 'in_progress'
      ORDER BY started_at DESC, id DESC LIMIT 1`,
    testId,
    userId,
  );

  return {
    ...serializeTestRow({ ...test, book_title: book?.title ?? null }),
    difficulty: rows[0]?.difficulty ?? null,
    questions: rows.map((row) => ({
      id: row.tq_id,
      type: row.type,
      typeLabel: TYPE_LABELS[row.type as QuestionType] ?? row.type,
      difficulty: row.difficulty,
      text: row.text,
      page: row.source_page,
      options: (options.get(row.q_id) ?? []).map((option) => ({ id: option.id, text: option.text })),
    })),
    attempts: attemptsOf(testId, userId)
      .filter((attempt) => attempt.status !== 'in_progress')
      .map((attempt) => serializeAttempt(attempt)),
    activeAttempt: active ? serializeAttempt(active) : null,
  };
}

export function deleteTest(userId: number, testId: number): void {
  const test = ownedTest(userId, testId);
  const questionIds = all<{ question_id: number }>(
    'SELECT question_id FROM test_questions WHERE test_id = ?',
    testId,
  ).map((row) => row.question_id);
  run('DELETE FROM tests WHERE id = ?', testId);
  if (test.book_id) {
    for (const questionId of questionIds) {
      run('DELETE FROM questions WHERE id = ?', questionId);
    }
  }
}

export function startAttempt(userId: number, testId: number) {
  const test = ownedTest(userId, testId);
  if (test.status === 'draft') throw new HttpError(409, 'هذا الاختبار غير جاهز بعد.');

  const existing = get<AttemptRow>(
    `SELECT * FROM test_attempts
      WHERE test_id = ? AND user_id = ? AND status = 'in_progress'
      ORDER BY started_at DESC, id DESC LIMIT 1`,
    testId,
    userId,
  );
  if (existing) {
    return { attempt: serializeAttempt(existing), test: getTest(userId, testId), resumed: true };
  }

  const total = questionRows(testId).length;
  if (total === 0) throw new HttpError(409, 'هذا الاختبار لا يحتوي أسئلة.');

  const created = run(
    'INSERT INTO test_attempts (test_id, user_id, total, status) VALUES (?, ?, ?, \'in_progress\')',
    testId,
    userId,
    total,
  );
  run('UPDATE tests SET status = \'in_progress\' WHERE id = ?', testId);
  const attempt = get<AttemptRow>('SELECT * FROM test_attempts WHERE id = ?', created.lastInsertRowid);
  return {
    attempt: attempt ? serializeAttempt(attempt) : null,
    test: getTest(userId, testId),
    resumed: false,
  };
}

function sameText(left: string, right: string): boolean {
  return normalizeArabic(left).replace(/[^\p{L}\p{N}]+/gu, ' ').trim() ===
    normalizeArabic(right).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function shortAnswerCorrect(given: string, row: QuestionRow): boolean {
  const normalizedGiven = normalizeArabic(given).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!normalizedGiven) return false;
  const parsed = parseTextAnswer(row.correct_answer);
  const accepted = [parsed.answer, ...parsed.accept].filter(Boolean);
  if (accepted.some((answer) => sameText(given, answer))) return true;

  // للأسئلة المفتوحة: نقبل الإجابة إذا غطّت معظم كلمات الإجابة النموذجية
  // (بعد تجاهل كلمات التوقف القصيرة)، بدل اشتراط التطابق الحرفي.
  const modelTokens = new Set(
    accepted
      .flatMap((answer) => normalizeArabic(answer).split(/[^\p{L}\p{N}]+/u))
      .filter((token) => token.length >= 3),
  );
  if (modelTokens.size < 2) return false;
  const givenTokens = new Set(
    normalizeArabic(given)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 3),
  );
  let matched = 0;
  for (const token of modelTokens) if (givenTokens.has(token)) matched += 1;
  return matched / modelTokens.size >= 0.67;
}

function unlockAchievement(userId: number, key: string): boolean {
  const achievement = get<{ id: number; title_ar: string; description_ar: string; points: number }>(
    'SELECT id, title_ar, description_ar, points FROM achievements WHERE key = ?',
    key,
  );
  if (!achievement) return false;
  const existing = get<{ achievement_id: number }>(
    'SELECT achievement_id FROM user_achievements WHERE user_id = ? AND achievement_id = ?',
    userId,
    achievement.id,
  );
  if (existing) return false;
  run('INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?)', userId, achievement.id);
  run(
    `INSERT OR IGNORE INTO user_statistics (user_id) VALUES (?)`,
    userId,
  );
  run('UPDATE user_statistics SET points = points + ?, updated_at = datetime(\'now\') WHERE user_id = ?', achievement.points, userId);
  createNotification(
    userId,
    'achievement',
    `إنجاز جديد: ${achievement.title_ar}`,
    `${achievement.description_ar} (+${achievement.points} نقطة)`,
  );
  return true;
}

export interface AnswerInput {
  questionId: number;
  optionId?: number | null;
  text?: string | null;
}

export function submitAttempt(options: {
  userId: number;
  testId: number;
  attemptId: number;
  answers: AnswerInput[];
}) {
  const test = ownedTest(options.userId, options.testId);
  const attempt = get<AttemptRow>(
    'SELECT * FROM test_attempts WHERE id = ? AND test_id = ? AND user_id = ?',
    options.attemptId,
    options.testId,
    options.userId,
  );
  if (!attempt) throw new HttpError(404, 'محاولة الاختبار غير موجودة.');
  if (attempt.status !== 'in_progress') {
    throw new HttpError(409, 'تم تسليم هذه المحاولة مسبقًا. ابدأ محاولة جديدة من صفحة الاختبار.');
  }

  const rows = questionRows(test.id);
  if (rows.length === 0) throw new HttpError(409, 'هذا الاختبار لا يحتوي أسئلة.');
  const optionsMap = optionsFor(rows.map((row) => row.q_id));
  const byId = new Map(rows.map((row) => [row.tq_id, row]));

  const answerMap = new Map<number, AnswerInput>();
  for (const answer of options.answers) {
    if (!byId.has(answer.questionId)) continue;
    answerMap.set(answer.questionId, answer);
  }

  let correctCount = 0;
  for (const row of rows) {
    const given = answerMap.get(row.tq_id);
    let isCorrect = 0;
    let selectedOptionId: number | null = null;
    let answerText: string | null = null;

    if (given) {
      const opts = optionsMap.get(row.q_id) ?? [];
      if (TEXT_QUESTION_TYPES.includes(row.type as QuestionType)) {
        answerText = (given.text ?? '').trim().slice(0, 2000) || null;
        isCorrect = answerText ? (shortAnswerCorrect(answerText, row) ? 1 : 0) : 0;
      } else {
        const option = opts.find((item) => item.id === given.optionId);
        if (option) {
          selectedOptionId = option.id;
          isCorrect = option.is_correct ? 1 : 0;
        }
      }
    }

    if (isCorrect) correctCount += 1;
    run(
      `INSERT OR REPLACE INTO test_answers (attempt_id, test_question_id, selected_option_id, answer_text, is_correct)
       VALUES (?, ?, ?, ?, ?)`,
      attempt.id,
      row.tq_id,
      selectedOptionId,
      answerText,
      isCorrect,
    );
  }

  const total = rows.length;
  const score = Math.round((correctCount / total) * 100);
  const started = new Date(`${attempt.started_at.replace(' ', 'T')}Z`).getTime();
  const elapsed = Number.isFinite(started) ? Math.max(0, Math.round((Date.now() - started) / 1000)) : 0;
  const limitSeconds = (test.duration_minutes ?? 0) * 60;
  const timedOut = limitSeconds > 0 && elapsed > limitSeconds + 120;

  run(
    `UPDATE test_attempts
        SET status = 'finished', finished_at = datetime('now'), score = ?, total = ?, time_spent_seconds = ?
      WHERE id = ?`,
    score,
    total,
    Math.min(elapsed, 4 * 60 * 60),
    attempt.id,
  );
  run("UPDATE tests SET status = 'finished' WHERE id = ?", test.id);

  run('INSERT OR IGNORE INTO user_statistics (user_id) VALUES (?)', options.userId);
  run(
    `UPDATE user_statistics
        SET tests_completed = tests_completed + 1,
            questions_answered = questions_answered + ?,
            points = points + ?,
            updated_at = datetime('now')
      WHERE user_id = ?`,
    correctCount,
    correctCount * 2,
    options.userId,
  );

  unlockAchievement(options.userId, 'first_test');
  const stats = get<{ tests_completed: number; questions_answered: number }>(
    'SELECT tests_completed, questions_answered FROM user_statistics WHERE user_id = ?',
    options.userId,
  );
  if ((stats?.tests_completed ?? 0) >= 10) unlockAchievement(options.userId, 'ten_tests');
  if ((stats?.questions_answered ?? 0) >= 100) unlockAchievement(options.userId, 'hundred_correct');

  logActivity(
    options.userId,
    'test',
    `نتيجة اختبار: ${score}%`,
    `${test.title} — ${correctCount} من ${total} إجابة صحيحة`,
  );
  createNotification(
    options.userId,
    'test',
    `نتيجة اختبارك: ${score}%`,
    `${test.title} — أجبت بشكل صحيح عن ${correctCount} من ${total} سؤالًا.`,
  );

  return getAttemptResult(options.userId, test.id, attempt.id, timedOut);
}

export function checkAttemptAnswer(options: {
  userId: number;
  testId: number;
  attemptId: number;
  questionId: number;
  optionId?: number | null;
  text?: string | null;
}) {
  const test = ownedTest(options.userId, options.testId);
  if (test.show_answers !== 'after_each') {
    throw new HttpError(403, 'هذا الاختبار يعرض الإجابات بعد التسليم فقط.');
  }
  const attempt = get<AttemptRow>(
    'SELECT * FROM test_attempts WHERE id = ? AND test_id = ? AND user_id = ?',
    options.attemptId,
    options.testId,
    options.userId,
  );
  if (!attempt) throw new HttpError(404, 'محاولة الاختبار غير موجودة.');
  if (attempt.status !== 'in_progress') throw new HttpError(409, 'انتهت هذه المحاولة.');

  const rows = questionRows(test.id);
  const row = rows.find((item) => item.tq_id === options.questionId);
  if (!row) throw new HttpError(404, 'السؤال غير موجود في هذه المحاولة.');
  const opts = optionsFor([row.q_id]).get(row.q_id) ?? [];
  const correctOption = opts.find((option) => option.is_correct === 1);
  const parsed = parseTextAnswer(row.correct_answer);
  const isText = TEXT_QUESTION_TYPES.includes(row.type as QuestionType);
  const isCorrect = isText
    ? Boolean(options.text?.trim()) && shortAnswerCorrect(options.text ?? '', row)
    : Boolean(options.optionId) && opts.find((option) => option.id === options.optionId)?.is_correct === 1;

  return {
    isCorrect,
    correctAnswer: isText ? parsed.answer : (correctOption?.text ?? null),
    answerVariants: parsed.accept,
    explanation: row.explanation,
  };
}

export function getAttemptResult(userId: number, testId: number, attemptId: number, timedOut = false) {
  const test = ownedTest(userId, testId);
  const attempt = get<AttemptRow>(
    'SELECT * FROM test_attempts WHERE id = ? AND test_id = ? AND user_id = ?',
    attemptId,
    testId,
    userId,
  );
  if (!attempt) throw new HttpError(404, 'محاولة الاختبار غير موجودة.');
  if (attempt.status === 'in_progress') {
    throw new HttpError(409, 'هذه المحاولة لم تُسلَّم بعد، ولا تُعرض إجاباتها قبل التسليم.');
  }

  const rows = questionRows(testId);
  const optionsMap = optionsFor(rows.map((row) => row.q_id));
  const answers = all<{
    test_question_id: number;
    selected_option_id: number | null;
    answer_text: string | null;
    is_correct: number | null;
  }>('SELECT test_question_id, selected_option_id, answer_text, is_correct FROM test_answers WHERE attempt_id = ?', attemptId);
  const answerMap = new Map(answers.map((answer) => [answer.test_question_id, answer]));

  const correctCount = rows.filter((row) => answerMap.get(row.tq_id)?.is_correct === 1).length;
  const total = rows.length;
  const unansweredCount = rows.filter((row) => {
    const answer = answerMap.get(row.tq_id);
    return !answer || (!answer.selected_option_id && !answer.answer_text?.trim());
  }).length;
  const limitSeconds = (test.duration_minutes ?? 0) * 60;

  return {
    test: { ...serializeTestRow(test), difficulty: rows[0]?.difficulty ?? null },
    attempt: serializeAttempt(attempt),
    summary: {
      correctCount,
      wrongCount: total - correctCount - unansweredCount,
      unansweredCount,
      total,
      score: attempt.score ?? Math.round((correctCount / Math.max(total, 1)) * 100),
      timedOut: timedOut || (limitSeconds > 0 && attempt.time_spent_seconds > limitSeconds + 120),
    },
    questions: rows.map((row) => {
      const answer = answerMap.get(row.tq_id);
      const opts = optionsMap.get(row.q_id) ?? [];
      const correctOption = opts.find((option) => option.is_correct === 1);
      return {
        id: row.tq_id,
        type: row.type,
        typeLabel: TYPE_LABELS[row.type as QuestionType] ?? row.type,
        text: row.text,
        page: row.source_page,
        explanation: row.explanation,
        options: opts.map((option) => ({
          id: option.id,
          text: option.text,
          isCorrect: option.is_correct === 1,
        })),
        correctAnswer: TEXT_QUESTION_TYPES.includes(row.type as QuestionType)
          ? parseTextAnswer(row.correct_answer).answer
          : (correctOption?.text ?? null),
        answerVariants: TEXT_QUESTION_TYPES.includes(row.type as QuestionType)
          ? parseTextAnswer(row.correct_answer).accept
          : [],
        selectedOptionId: answer?.selected_option_id ?? null,
        answerText: answer?.answer_text ?? null,
        isCorrect: answer?.is_correct === 1,
        answered: Boolean(answer?.selected_option_id || answer?.answer_text?.trim()),
      };
    }),
  };
}
