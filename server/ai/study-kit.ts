// حزمة مراجعة مرتبطة بملخص محفوظ: بطاقات، نقاط، مصطلحات، مقارنات،
// قوانين، تسلسل، مخطط بصري، واختبار قصير. تُولَّد مرة واحدة وتُحفظ مع الملخص.
import { z } from 'zod';
import { get, run } from '../db.ts';
import { HttpError } from '../http.ts';
import { readAiConfig } from './config.ts';
import { chatCompletion, type ChatMessage } from './provider.ts';
import { assertQuota, dailyLimitPerUser, recordUsage, usageToday } from './usage.ts';
import { getSummary } from './summaries.ts';

const stringField = z.string().trim().max(12_000);
const shortField = z.string().trim().max(1_200);

const kitSchema = z.object({
  overview: stringField.default(''),
  keyPoints: z
    .array(z.object({ title: shortField, body: stringField }))
    .max(12)
    .default([]),
  definitions: z
    .array(z.object({ term: shortField, definition: stringField }))
    .max(16)
    .default([]),
  comparisons: z
    .array(
      z.object({
        title: shortField,
        leftTitle: shortField,
        rightTitle: shortField,
        rows: z
          .array(z.object({ aspect: shortField, left: stringField, right: stringField }))
          .max(12)
          .default([]),
      }),
    )
    .max(4)
    .default([]),
  equations: z
    .array(
      z.object({
        expression: shortField,
        meaning: stringField,
        symbols: z
          .array(z.object({ symbol: shortField, meaning: shortField, unit: shortField.optional().default('') }))
          .max(16)
          .default([]),
        example: stringField.optional().default(''),
      }),
    )
    .max(8)
    .default([]),
  timeline: z
    .array(z.object({ label: shortField, detail: stringField }))
    .max(16)
    .default([]),
  visual: z
    .object({
      kind: z.enum(['causes', 'sequence', 'hierarchy', 'compare', 'concept']).default('concept'),
      title: shortField,
      center: shortField,
      branches: z
        .array(
          z.object({
            title: shortField,
            detail: stringField,
            children: z.array(z.object({ title: shortField, detail: stringField })).max(8).default([]),
          }),
        )
        .max(10)
        .default([]),
    })
    .nullable()
    .default(null),
  flashcards: z
    .array(z.object({ front: shortField, back: stringField }))
    .min(4)
    .max(24),
  quiz: z
    .array(
      z.object({
        type: z.enum(['mcq', 'true_false', 'short']),
        prompt: shortField,
        options: z.array(shortField).max(6).default([]),
        answer: z.union([z.string(), z.number(), z.boolean()]),
        explanation: stringField.default(''),
      }),
    )
    .min(4)
    .max(10),
});

export interface StudyKit {
  version: 1;
  generatedAt: string;
  overview: string;
  keyPoints: Array<{ title: string; body: string }>;
  definitions: Array<{ term: string; definition: string }>;
  comparisons: Array<{
    title: string;
    leftTitle: string;
    rightTitle: string;
    rows: Array<{ aspect: string; left: string; right: string }>;
  }>;
  equations: Array<{
    expression: string;
    meaning: string;
    symbols: Array<{ symbol: string; meaning: string; unit: string }>;
    example: string;
  }>;
  timeline: Array<{ label: string; detail: string }>;
  visual: {
    kind: 'causes' | 'sequence' | 'hierarchy' | 'compare' | 'concept';
    title: string;
    center: string;
    branches: Array<{
      title: string;
      detail: string;
      children: Array<{ title: string; detail: string }>;
    }>;
  } | null;
  flashcards: Array<{ id: string; front: string; back: string }>;
  quiz: Array<{
    id: string;
    type: 'mcq' | 'true_false' | 'short';
    prompt: string;
    options: string[];
    answer: string | number | boolean;
    explanation: string;
  }>;
}

export type CardStatus = 'known' | 'learning';

export interface SummaryReviewState {
  cards: Record<string, CardStatus>;
  quiz: Record<string, { correct: boolean; answer: string }>;
  updatedAt: string;
}

const SYSTEM_PROMPT = `أنت مصمّم حزم مراجعة دراسية عربية داخل تطبيق NERD.
ستتلقى ملخصًا موثّقًا مستخرجًا من مصدر الطالب. مهمتك تحويله إلى حزمة مراجعة منظمة، وليس تلخيصه من جديد.

قواعد صارمة:
1) استخدم فقط المعلومات الموجودة في الملخص المرفق. لا تضف تعريفًا أو رقمًا أو قانونًا أو مثالًا من خارجها.
2) لا تكرر المعلومة نفسها في أكثر من قسم إلا إذا كان التكرار ضروريًا لصياغة سؤال اختبار.
3) لا تخترع مقارنة أو قانونًا أو خطًا زمنيًا إن لم يكن المحتوى يدعمه؛ أعد مصفوفة فارغة.
4) حافظ على الأرقام والوحدات كما وردت. لا تختصر معادلة بما يغيّر معناها.
5) البطاقات: 8–16 بطاقة، كل بطاقة فكرة واحدة. الوجه الأمامي سؤال قصير أو مصطلح، والخلفي إجابة مباشرة من المصدر.
6) الاختبار: 5–8 أسئلة قصيرة، من أنواع mcq وtrue_false وshort فقط.
7) لسؤال mcq: options من 3–4 خيارات، وanswer هو رقم الخيار الصحيح من الصفر (مثال: 1).
8) لسؤال true_false: answer قيمة منطقية true أو false، وoptions مصفوفة فارغة.
9) لسؤال short: answer نص قصير مطابق للمعلومة، وoptions فارغة.
10) المخطط البصري: اختر kind المناسب فقط:
   - causes للأسباب والنتائج.
   - sequence للمراحل أو الأحداث المتتابعة.
   - hierarchy للتصنيفات.
   - compare للمقارنة بين مفهومين.
   - concept لفكرة مركزية وتفريعاتها.
11) اكتب بعربية فصحى واضحة، ولا تخرج أي نص قبل JSON أو بعده.

أعد كائن JSON واحدًا فقط بهذا الشكل:
{
  "overview": "جملة أو جملتان",
  "keyPoints": [{"title":"عنوان","body":"شرح"}],
  "definitions": [{"term":"مصطلح","definition":"تعريف من المصدر"}],
  "comparisons": [{"title":"عنوان","leftTitle":"أ","rightTitle":"ب","rows":[{"aspect":"وجه","left":"...","right":"..."}]}],
  "equations": [{"expression":"...","meaning":"...","symbols":[{"symbol":"v","meaning":"...","unit":"m/s"}],"example":"..."}],
  "timeline": [{"label":"مرحلة","detail":"..."}],
  "visual": {"kind":"causes","title":"...","center":"...","branches":[{"title":"...","detail":"...","children":[{"title":"...","detail":"..."}]}]},
  "flashcards": [{"front":"...","back":"..."}],
  "quiz": [{"type":"mcq","prompt":"...","options":["..."],"answer":0,"explanation":"..."}]
}`;

function extractObject(raw: string): unknown {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('لم يصل كائن JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalize(raw: unknown) {
  if (!raw || typeof raw !== 'object') throw new Error('الرد ليس كائن JSON.');
  const record = raw as Record<string, unknown>;
  const array = (key: string) => (Array.isArray(record[key]) ? record[key] : []);
  const obj = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

  const kit = kitSchema.parse({
    overview: asString(record.overview),
    keyPoints: array('keyPoints').map((item) => {
      const value = obj(item);
      return { title: asString(value.title), body: asString(value.body) };
    }),
    definitions: array('definitions').map((item) => {
      const value = obj(item);
      return { term: asString(value.term), definition: asString(value.definition) };
    }),
    comparisons: array('comparisons').map((item) => {
      const value = obj(item);
      return {
        title: asString(value.title),
        leftTitle: asString(value.leftTitle),
        rightTitle: asString(value.rightTitle),
        rows: Array.isArray(value.rows)
          ? value.rows.map((row) => {
              const itemRow = obj(row);
              return {
                aspect: asString(itemRow.aspect),
                left: asString(itemRow.left),
                right: asString(itemRow.right),
              };
            })
          : [],
      };
    }),
    equations: array('equations').map((item) => {
      const value = obj(item);
      return {
        expression: asString(value.expression),
        meaning: asString(value.meaning),
        symbols: Array.isArray(value.symbols)
          ? value.symbols.map((symbol) => {
              const itemSymbol = obj(symbol);
              return {
                symbol: asString(itemSymbol.symbol),
                meaning: asString(itemSymbol.meaning),
                unit: asString(itemSymbol.unit),
              };
            })
          : [],
        example: asString(value.example),
      };
    }),
    timeline: array('timeline').map((item) => {
      const value = obj(item);
      return { label: asString(value.label), detail: asString(value.detail) };
    }),
    visual: record.visual && typeof record.visual === 'object'
      ? (() => {
          const visual = obj(record.visual);
          return {
            kind: ['causes', 'sequence', 'hierarchy', 'compare', 'concept'].includes(asString(visual.kind))
              ? asString(visual.kind)
              : 'concept',
            title: asString(visual.title),
            center: asString(visual.center),
            branches: Array.isArray(visual.branches)
              ? visual.branches.map((branch) => {
                  const itemBranch = obj(branch);
                  return {
                    title: asString(itemBranch.title),
                    detail: asString(itemBranch.detail),
                    children: Array.isArray(itemBranch.children)
                      ? itemBranch.children.map((child) => {
                          const itemChild = obj(child);
                          return { title: asString(itemChild.title), detail: asString(itemChild.detail) };
                        })
                      : [],
                  };
                })
              : [],
          };
        })()
      : null,
    flashcards: array('flashcards').map((item) => {
      const value = obj(item);
      return { front: asString(value.front), back: asString(value.back) };
    }),
    quiz: array('quiz').map((item) => {
      const value = obj(item);
      return {
        type: ['mcq', 'true_false', 'short'].includes(asString(value.type)) ? asString(value.type) : 'mcq',
        prompt: asString(value.prompt),
        options: Array.isArray(value.options) ? value.options.map(asString) : [],
        answer: typeof value.answer === 'number' || typeof value.answer === 'boolean' ? value.answer : asString(value.answer),
        explanation: asString(value.explanation),
      };
    }),
  });

  return kit;
}

export interface CreateStudyKitInput {
  userId: number;
  summaryId: number;
  apiKey: string;
}

export async function createStudyKit(input: CreateStudyKitInput) {
  const config = readAiConfig();
  const summary = getSummary(input.userId, input.summaryId);
  if (!summary.content || summary.content.trim().length < 30) {
    throw new HttpError(422, 'لا يوجد نص كافٍ في الملخص لبناء حزمة المراجعة.', 'study_kit_empty_source');
  }

  assertQuota(input.userId, 2);
  const source = summary.content.slice(0, Math.min(26_000, config.maxRequestChars - 3_000));
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `عنوان الملخص: ${summary.title}`,
        summary.bookTitle ? `المصدر: ${summary.bookTitle}` : null,
        summary.rangeLabel ? `النطاق: ${summary.rangeLabel}` : null,
        summary.pages.length ? `الصفحات: ${summary.pages.join(', ')}` : null,
        '',
        'نص الملخص:',
        source,
        source.length < summary.content.length ? '\n[تم اقتصار جزء من النص بسبب حد الطلب؛ لا تضف معلومات غير ظاهرة.]' : '',
        '',
        'أنشئ حزمة المراجعة الآن وأعد JSON فقط.',
      ]
        .filter((line) => line !== null)
        .join('\n'),
    },
  ];

  let requests = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let lastError = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assertQuota(input.userId, 1);
    let result;
    try {
      result = await chatCompletion({
        apiKey: input.apiKey,
        messages,
        model: config.chatModel,
        maxTokens: Math.min(8_000, Math.max(5_000, config.lessonMaxOutputTokens)),
        temperature: 0.25,
        reasoningEffort: 'low',
        task: 'summary',
      });
    } catch (error) {
      recordUsage({
        userId: input.userId,
        task: 'summary_kit',
        model: config.chatModel,
        provider: config.provider,
        tokensIn: 0,
        tokensOut: 0,
        status: 'failed',
      });
      throw error;
    }

    requests += 1;
    tokensIn += result.tokensIn;
    tokensOut += result.tokensOut;
    recordUsage({
      userId: input.userId,
      task: 'summary_kit',
      model: result.model,
      provider: result.provider,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      status: 'success',
    });

    try {
      const kit = normalize(extractObject(result.content));
      const stored: StudyKit = {
        ...kit,
        version: 1,
        generatedAt: new Date().toISOString(),
        flashcards: kit.flashcards.map((card, index) => ({ ...card, id: `card-${index + 1}` })),
        quiz: kit.quiz.map((question, index) => ({ ...question, id: `q-${index + 1}` })),
      } satisfies StudyKit;
      run(
        'UPDATE summaries SET study_kit = ? WHERE id = ? AND user_id = ?',
        JSON.stringify(stored),
        input.summaryId,
        input.userId,
      );
      return {
        summary: getSummary(input.userId, input.summaryId),
        kit: stored,
        usage: {
          requests,
          tokensIn,
          tokensOut,
          remainingToday: Math.max(0, dailyLimitPerUser() - usageToday(input.userId).requests),
        },
      };
    } catch (error) {
      lastError = error instanceof z.ZodError
        ? error.issues.slice(0, 3).map((issue) => `${issue.path.join('.') || 'الرد'}: ${issue.message}`).join('؛ ')
        : error instanceof Error
          ? error.message
          : 'بنية الرد غير صالحة.';
      console.warn(`[nerd/study-kit] رد غير صالح في المحاولة ${attempt + 1}: ${lastError}`);
      if (attempt === 0) {
        messages.push({
          role: 'assistant',
          content: result.content.slice(0, 12_000),
        });
        messages.push({
          role: 'user',
          content: `الرد السابق غير صالح: ${lastError}. أعد إخراج JSON كاملًا ومطابقًا للمخطط، دون أي شرح.`,
        });
      }
    }
  }

  throw new HttpError(422, `تعذّر بناء حزمة مراجعة صالحة من هذا الملخص. ${lastError}`, 'study_kit_invalid');
}

function parseState(raw: string | null | undefined): SummaryReviewState {
  if (!raw) return { cards: {}, quiz: {}, updatedAt: '' };
  try {
    const parsed = JSON.parse(raw) as Partial<SummaryReviewState>;
    const cards: Record<string, CardStatus> = {};
    for (const [key, value] of Object.entries(parsed.cards ?? {})) {
      if ((value === 'known' || value === 'learning') && key.length <= 64) cards[key] = value;
    }
    const quiz: SummaryReviewState['quiz'] = {};
    for (const [key, value] of Object.entries(parsed.quiz ?? {})) {
      if (key.length <= 64 && value && typeof value.answer === 'string') {
        quiz[key] = { correct: Boolean(value.correct), answer: value.answer.slice(0, 1_000) };
      }
    }
    return { cards, quiz, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '' };
  } catch {
    return { cards: {}, quiz: {}, updatedAt: '' };
  }
}

export function saveReviewState(
  userId: number,
  summaryId: number,
  patch: {
    cards?: Record<string, CardStatus>;
    quiz?: Record<string, { correct: boolean; answer: string }>;
    resetQuiz?: boolean;
  },
) {
  const row = get<{ study_kit: string | null; review_state: string | null }>(
    'SELECT study_kit, review_state FROM summaries WHERE id = ? AND user_id = ?',
    summaryId,
    userId,
  );
  if (!row) throw new HttpError(404, 'الملخص غير موجود.');
  if (!row.study_kit) throw new HttpError(409, 'أنشئ حزمة المراجعة أولًا.');

  let kit: StudyKit;
  try {
    kit = JSON.parse(row.study_kit) as StudyKit;
  } catch {
    throw new HttpError(409, 'حزمة المراجعة غير صالحة. أعد إنشاءها.');
  }
  const cardIds = new Set((kit.flashcards ?? []).map((card) => card.id));
  const quizIds = new Set((kit.quiz ?? []).map((question) => question.id));
  const current = parseState(row.review_state);
  if (patch.resetQuiz) current.quiz = {};

  for (const [key, value] of Object.entries(patch.cards ?? {})) {
    if (cardIds.has(key) && (value === 'known' || value === 'learning')) current.cards[key] = value;
  }
  for (const [key, value] of Object.entries(patch.quiz ?? {})) {
    if (quizIds.has(key) && value && typeof value.answer === 'string') {
      current.quiz[key] = { correct: Boolean(value.correct), answer: value.answer.slice(0, 1_000) };
    }
  }
  current.updatedAt = new Date().toISOString();
  run(
    'UPDATE summaries SET review_state = ? WHERE id = ? AND user_id = ?',
    JSON.stringify(current),
    summaryId,
    userId,
  );
  return current;
}
