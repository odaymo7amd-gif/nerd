// توليد الملخصات: استرجاع المقاطع من الكتاب (RAG) ثم تلخيصها بمزوّد النموذج،
// مع الحفاظ على مراجع الصفحات وتسجيل كل استهلاك وتكلفة.

import { all, get, run } from '../db.ts';
import { createNotification, logActivity } from '../auth.ts';
import { HttpError } from '../http.ts';
import { readAiConfig, pricesKnown } from './config.ts';
import { chatCompletion, type ChatMessage } from './provider.ts';
import { assertQuota, dailyLimitPerUser, recordUsage, usageToday } from './usage.ts';
import {
  chunksForBook,
  groupByBatch,
  pagesOf,
  retrieveChunks,
  type ChunkRef,
  type PageRange,
} from './retrieval.ts';

export type DetailLevel = 'short' | 'medium' | 'detailed';
export type SummaryFocus = 'key_ideas' | 'definitions' | 'laws' | 'comparisons' | 'causes';

export const DETAIL_LEVELS: DetailLevel[] = ['short', 'medium', 'detailed'];
export const SUMMARY_FOCUSES: SummaryFocus[] = ['key_ideas', 'definitions', 'laws', 'comparisons', 'causes'];

export const FOCUS_LABELS: Record<SummaryFocus, string> = {
  key_ideas: 'أهم الأفكار',
  definitions: 'التعريفات',
  laws: 'القوانين',
  comparisons: 'المقارنات',
  causes: 'الأسباب والنتائج',
};

export const FOCUS_INSTRUCTIONS: Record<SummaryFocus, string> = {
  key_ideas: 'اجعل المحور الأساسي أهم الأفكار والنقاط التي يجب أن يتذكرها الطالب.',
  definitions: 'اجمع التعريفات والمصطلحات كما وردت في المصدر، كل تعريف في سطر واضح.',
  laws: 'اجمع القوانين والصيغ والمعادلات كما وردت، مع شرح رمز كل متغير إن ذُكر.',
  comparisons: 'رتّب المقارنات في نقاط أو جدول: أوجه الشبه وأوجه الاختلاف، من المصدر فقط.',
  causes: 'وضّح الأسباب والنتائج والعلاقات السببية كما وردت في المصدر، بلا استنتاج خارجي.',
};

const LEVEL_INSTRUCTIONS: Record<DetailLevel, string> = {
  short:
    'اكتب ملخصًا مركزًا في 5 إلى 7 نقاط قصيرة، كل نقطة جملة أو جملتان، مع مرجع الصفحة بعد كل نقطة. غطِّ أهم تعريف أو قانون ورد في المصدر إن وجد.',
  medium:
    'اكتب ملخصًا متوسطًا يتضمن: الفكرة العامة، ثم الأفكار الرئيسية في نقاط، ثم أهم المصطلحات أو التعريفات، ثم القوانين أو الصيغ إن وجدت. استخدم عناوين قصيرة.',
  detailed:
    'اكتب ملخصًا موسّعًا: نظرة عامة، ثم شرح الأفكار الرئيسية بالتفصيل، ثم المصطلحات والتعريفات، ثم القوانين والصيغ مع رموزها، ثم الأمثلة المحلولة والمقارنات إن وجدت، ثم خلاصة في نقاط. استخدم عناوين وقوائم.',
};

export const LEVEL_LABELS: Record<DetailLevel, string> = {
  short: 'قصير',
  medium: 'متوسط',
  detailed: 'مفصّل',
};

const SYSTEM_PROMPT = `أنت مساعد دراسي عربي دقيق يعمل داخل تطبيق NERD للطلاب.
قواعدك:
1) لخّص فقط المعلومات الموجودة في المقاطع المرفقة، ولا تُضف أي معلومة من خارجها.
2) لا تحذف معلومة مهمة وردت في المصدر؛ التلخيص تقصير للصياغة لا إسقاط للمعنى.
3) استخرج التعريفات والمصطلحات كما وردت، واستخرج القوانين والصيغ كما كُتبت مع شرح رموزها إن ذُكرت.
4) استخرج الأمثلة المحلولة والمقارنات المهمة إن وجدت، ولا تخترع أمثلة أو قوانين غير موجودة.
5) بعد كل معلومة مهمة اذكر مصدرها برقم الصفحة بهذا الشكل: [ص 12].
6) إذا كانت المقاطع لا تكفي لاستنتاج شيء فقل ذلك صراحة بدل التخمين، ولا تكتب قسمًا فارغًا لمجرد إكمال الشكل.
7) اكتب بعربية فصحى واضحة، بعناوين قصيرة ونقاط منظّمة، بلا تكرار.
8) قبل الإخراج راجع كل جملة: هل معناها موجود في المقاطع؟ إن لم يكن، احذفها.
9) لا تكتب أي تعليمات أو مقدمة عن نفسك.
10) استخدم Markdown حقيقيًا: عناوين فرعية قصيرة، قوائم واضحة، و**عريضًا** للتعريفات والمصطلحات والقوانين المهمة فقط. اكتب المعادلات بين $...$ عند الحاجة، ولا تغمّق فقرة كاملة.`;

interface BookRow {
  id: number;
  title: string;
  unit_name: string | null;
  pages_count: number;
  status: string;
  subject_name: string | null;
  grade_name: string | null;
}

export interface SummaryRow {
  id: number;
  user_id: number;
  book_id: number | null;
  content_id: number | null;
  content_version: number | null;
  title: string;
  kind: string;
  detail_level: string;
  range_label: string | null;
  content: string;
  source_pages: string | null;
  study_kit: string | null;
  review_state: string | null;
  created_at: string;
  book_title?: string | null;
}

// يزيل أي مرجع صفحة لم يكن ضمن الصفحات التي قرأها النموذج فعلًا.
function sanitizeCitations(content: string, allowedPages: number[]): string {
  const allowed = new Set(allowedPages);
  return content
    .replace(/\[ص\s*(\d+)(?:\s*[-–]\s*(\d+))?\]/g, (match, fromRaw: string, toRaw?: string) => {
      const from = Number(fromRaw);
      const to = toRaw ? Number(toRaw) : from;
      return allowed.has(from) && allowed.has(to) ? match : '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

function parsePages(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  } catch {
    return [];
  }
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function serializeSummary(row: SummaryRow) {
  const pages = parsePages(row.source_pages);
  return {
    id: row.id,
    title: row.title,
    bookId: row.book_id,
    contentId: row.content_id,
    contentVersion: row.content_version,
    bookTitle: row.book_title ?? null,
    kind: row.kind,
    detailLevel: row.detail_level,
    detailLevelLabel: LEVEL_LABELS[row.detail_level as DetailLevel] ?? row.detail_level,
    rangeLabel: row.range_label,
    content: row.content,
    pages,
    pagesCount: pages.length,
    preview: row.content.slice(0, 240),
    studyKit: parseJson<unknown>(row.study_kit, null),
    hasStudyKit: Boolean(row.study_kit),
    reviewState: parseJson<Record<string, unknown>>(row.review_state, {}),
    createdAt: row.created_at,
  };
}

function ownedBook(userId: number, bookId: number): BookRow {
  const book = get<BookRow>(
    `SELECT b.id, b.title, b.unit_name, b.pages_count, b.status,
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
    throw new HttpError(409, 'الكتاب ما زال قيد المعالجة. انتظر اكتمال استخراج النص ثم أعد المحاولة.');
  }
  return book;
}

function resolveRange(
  book: BookRow,
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

function batchPrompt(options: {
  book: BookRow;
  rangeLabel: string;
  level: DetailLevel;
  focus: string | null;
  focusKind: SummaryFocus | null;
  chunks: ChunkRef[];
  partIndex: number;
  partCount: number;
}): ChatMessage[] {
  const { book, rangeLabel, level, focus, focusKind, chunks, partIndex, partCount } = options;
  const excerpts = chunks
    .map((chunk) => `[صفحة ${chunk.pageFrom === chunk.pageTo ? chunk.pageFrom : `${chunk.pageFrom}-${chunk.pageTo}`}]\n${chunk.content}`)
    .join('\n---\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `الكتاب: ${book.title}`,
        book.subject_name ? `المادة: ${book.subject_name}` : null,
        book.grade_name ? `الصف: ${book.grade_name}` : null,
        book.unit_name ? `الوحدة: ${book.unit_name}` : null,
        `النطاق: ${rangeLabel}`,
        partCount > 1 ? `هذا الجزء ${partIndex} من ${partCount} من نصوص النطاق.` : null,
        focus ? `المحور الذي يطلبه الطالب: ${focus}` : null,
        focusKind ? `نوع الملخص المطلوب: ${FOCUS_LABELS[focusKind]} — ${FOCUS_INSTRUCTIONS[focusKind]}` : null,
        '',
        'المقاطع:',
        excerpts,
        '',
        `المطلوب: ${LEVEL_INSTRUCTIONS[level]}`,
        'التزم بترتيب المصدر، ولا تدمج معلومتين متشابهتين، ولا تضف معلومة لم ترد في المقاطع.',
      ]
        .filter((line) => line !== null)
        .join('\n'),
    },
  ];
}

function mergePrompt(book: BookRow, rangeLabel: string, level: DetailLevel, partials: string[]): ChatMessage[] {
  // لا نقتطع الملخصات الجزئية هنا؛ حجم المجموعة يُضبط قبل البناء حتى لا تضيع معلومات.
  const body = partials
    .map((partial, index) => `### الجزء ${index + 1}\n${partial}`)
    .join('\n\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `الكتاب: ${book.title}`,
        `النطاق: ${rangeLabel}`,
        'هذه ملخصات جزئية لنفس النطاق بترتيب الصفحات، بعضها يتداخل قليلًا.',
        'المطلوب: ادمجها في ملخص واحد متماسك بلا تكرار، وحافظ على مراجع الصفحات [ص N] كما هي.',
        'لا تضف أي معلومة جديدة أثناء الدمج، ولا تحذف تعريفًا أو قانونًا ورد في الأجزاء.',
        `مستوى التفصيل: ${LEVEL_LABELS[level]}.`,
        '',
        body,
      ].join('\n'),
    },
  ];
}

function groupPartials(partials: string[], maxChars: number): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const partial of partials) {
    const partialSize = partial.length + 80;
    if (current.length > 0 && size + partialSize > maxChars) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(partial);
    size += partialSize;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** عدد طلبات الدمج في أسوأ الحالات، لحجز الحد اليومي قبل بدء العمل. */
export function mergeCallCount(count: number, groupSize: number): number {
  let level = count;
  let calls = 0;
  while (level > 1) {
    level = Math.ceil(level / Math.max(2, groupSize));
    calls += level;
  }
  return calls;
}

const inFlight = new Set<number>();

export interface CreateSummaryInput {
  userId: number;
  apiKey: string;
  bookId: number;
  contentId?: number | null;
  contentVersion?: number | null;
  detailLevel: DetailLevel;
  focus?: string | null;
  focusKind?: SummaryFocus | null;
  pageFrom?: number | null;
  pageTo?: number | null;
}

export function createSummary(input: CreateSummaryInput) {
  return runSummary(input);
}

async function runSummary(input: CreateSummaryInput) {
  const config = readAiConfig();
  if (inFlight.has(input.userId)) {
    throw new HttpError(409, 'لديك ملخص قيد الإنشاء الآن. انتظر انتهاءه قبل طلب ملخص آخر.');
  }

  const book = ownedBook(input.userId, input.bookId);
  const range = resolveRange(book, input.pageFrom, input.pageTo);
  const focus = input.focus?.trim() || null;
  const rangeLabel = range ? `الصفحات ${range.from}–${range.to}` : `الكتاب كاملًا (${book.pages_count} صفحة)`;

  let chunks: ChunkRef[];
  if (focus) {
    chunks = retrieveChunks(input.userId, {
      bookId: book.id,
      query: focus,
      range,
      limit: 10,
    });
    if (chunks.length === 0) {
      throw new HttpError(
        422,
        `لم أجد في هذا النطاق مقاطع تتعلق بـ«${focus}». جرّب كلمات من الكتاب نفسه أو حدّد نطاقًا أوسع.`,
      );
    }
  } else {
    chunks = chunksForBook(input.userId, book.id, range);
    if (chunks.length === 0) {
      throw new HttpError(422, 'لا يوجد نص مستخرج في هذا النطاق. الصفحات قد تكون صورًا غير مقروءة.');
    }
  }

  // لا نرفض المحتوى الطويل بسبب عدد الدفعات؛ نعالج كل الأجزاء ثم ندمجها هرميًا.
  const batches = groupByBatch(chunks, config.batchChars);
  const planned = batches.length + mergeCallCount(batches.length, config.mergeGroupSize);
  assertQuota(input.userId, planned);

  inFlight.add(input.userId);
  try {
    let tokensIn = 0;
    let tokensOut = 0;
    let requests = 0;
    const partials: string[] = [];
    const usedModel = config.chatModel;

    const callModel = async (messages: ChatMessage[], task: string, maxTokens: number) => {
      try {
        const result = await chatCompletion({
          apiKey: input.apiKey,
          messages,
          model: usedModel,
          maxTokens,
          task,
        });
        requests += 1;
        tokensIn += result.tokensIn;
        tokensOut += result.tokensOut;
        recordUsage({
          userId: input.userId,
          task,
          model: result.model,
          provider: result.provider,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          status: 'success',
        });
        return result.content;
      } catch (error) {
        recordUsage({
          userId: input.userId,
          task,
          model: usedModel,
          provider: config.provider,
          tokensIn: 0,
          tokensOut: 0,
          status: 'failed',
        });
        throw error;
      }
    };

    for (let index = 0; index < batches.length; index += 1) {
      const content = await callModel(
        batchPrompt({
          book,
          rangeLabel,
          level: input.detailLevel,
          focus,
          focusKind: input.focusKind ?? null,
          chunks: batches[index],
          partIndex: index + 1,
          partCount: batches.length,
        }),
        'summary',
        config.maxOutputTokens,
      );
      partials.push(content);
    }

    // دمج هرمي: كل مجموعة صغيرة تُدمج وحدها، ثم تُدمج نتائج المجموعات.
    // يمنع إرسال عشرات الملخصات الجزئية في طلب واحد ويتيح تلخيص فيديو طويل كاملًا.
    let content = partials.length === 1 ? partials[0] : '';
    if (partials.length > 1) {
      let level = partials;
      const mergeChars = Math.max(
        config.batchChars,
        Math.min(config.maxRequestChars - 2_000, Math.floor(config.maxRequestChars * 0.8)),
      );
      while (level.length > 1) {
        let groups = groupPartials(level, mergeChars);
        if (groups.length === level.length) {
          // لا تقدّم بالحجم: ندمج كل زوجين على الأقل بدل حلقة لا تنتهي.
          groups = [];
          for (let index = 0; index < level.length; index += 2) {
            groups.push(level.slice(index, index + 2));
          }
        }
        const next: string[] = [];
        for (const group of groups) {
          if (group.length === 1) {
            next.push(group[0]);
            continue;
          }
          next.push(
            await callModel(
              mergePrompt(book, rangeLabel, input.detailLevel, group),
              'summary-merge',
              config.maxOutputTokens,
            ),
          );
        }
        level = next;
      }
      content = level[0] ?? '';
    }

    const pages = pagesOf(chunks);
    content = sanitizeCitations(content, pages);
    const title = `${book.title}${focus ? ` — ${focus}` : ''}`.slice(0, 160);

    const created = run(
      `INSERT INTO summaries (user_id, book_id, content_id, content_version, title, kind, detail_level, range_label, content, source_pages)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.userId,
      book.id,
      input.contentId ?? null,
      input.contentVersion ?? null,
      title,
      input.focusKind ?? (focus ? 'topic' : 'book'),
      input.detailLevel,
      rangeLabel,
      content,
      JSON.stringify(pages),
    );

    logActivity(
      input.userId,
      'summary',
      `ملخص «${book.title}»`,
      `${LEVEL_LABELS[input.detailLevel]} — ${rangeLabel} — ${pages.length} صفحة مصدر`,
    );
    createNotification(
      input.userId,
      'summary',
      'اكتمل ملخص جديد',
      `ملخص ${LEVEL_LABELS[input.detailLevel]} لكتاب «${book.title}» جاهز.`,
    );

    const row = get<SummaryRow>(
      `SELECT s.*, b.title AS book_title FROM summaries s LEFT JOIN books b ON b.id = s.book_id WHERE s.id = ?`,
      created.lastInsertRowid,
    );

    return {
      summary: row ? serializeSummary(row) : null,
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

export function listSummaries(userId: number) {
  const rows = all<SummaryRow>(
    `SELECT s.*, b.title AS book_title
       FROM summaries s LEFT JOIN books b ON b.id = s.book_id
      WHERE s.user_id = ?
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 100`,
    userId,
  );
  return rows.map((row) => {
    const serialized = serializeSummary(row);
    return {
      ...serialized,
      content: serialized.preview,
    };
  });
}

export function getSummary(userId: number, id: number) {
  const row = get<SummaryRow>(
    `SELECT s.*, b.title AS book_title
       FROM summaries s LEFT JOIN books b ON b.id = s.book_id
      WHERE s.id = ? AND s.user_id = ?`,
    id,
    userId,
  );
  if (!row) throw new HttpError(404, 'الملخص غير موجود.');
  return serializeSummary(row);
}

export function deleteSummary(userId: number, id: number): void {
  const row = get<{ id: number }>('SELECT id FROM summaries WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw new HttpError(404, 'الملخص غير موجود.');
  run('DELETE FROM summaries WHERE id = ?', id);
}
