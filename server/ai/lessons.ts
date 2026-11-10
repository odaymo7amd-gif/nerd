// «اسأل المعلم»: خدمة مستقلة عن الدردشة الحرة.
// تأخذ سؤالًا (عامًا أو مرتبطًا بمحتوى) وتعيد درسًا تفاعليًا منظمًا كـJSON متحقق منه،
// مع محاولة إصلاح واحدة فقط إذا كان الرد غير صالح. المحتوى المرفوع اختياري دائمًا.

import { z } from 'zod';
import { HttpError } from '../http.ts';
import { readAiConfig } from './config.ts';
import { chatCompletion, type ChatMessage } from './provider.ts';
import { citationsOf, retrieveChunks, type ScoredChunk } from './retrieval.ts';
import { assertQuota, dailyLimitPerUser, recordUsage, usageToday } from './usage.ts';

const MAX_SOURCE_CHARS = 1400;
const MAX_SOURCE_CHUNKS = 8;
const MAX_REPAIR_RAW_CHARS = 12_000;

const SYSTEM_PROMPT = `أنت «معلم نيرد»، مصمّم دروس تفاعلية عربية. مهمتك أن تحوّل أي سؤال إلى درس قصير ومنظم يتنقل فيه الطالب بين أقسام واضحة.

المحتوى:
- ابدأ مباشرة بالإجابة عن السؤال، بلا مقدمة إنشائية أو حديث عن نفسك.
- اجعل عدد الأقسام مناسبًا لتعقيد السؤال: 3 أقسام للسؤال البسيط، 5 للمتوسط، و6–8 للموضوع المركّب. لا تفرض 5 أقسام دائمًا، ولا تنقص عن 3 إلا إذا كان السؤال شديد البساطة.
- لكل قسم عنوان قصير من 2–7 كلمات، ومحتوى مركّز من 40–120 كلمة.
- المحتوى المختصر أفضل من الحشو: لا تكرر الفكرة نفسها بصياغات مختلفة، ولا تكتب جملة عامة لا تضيف معلومة.
- اجعل التسلسل منطقيًا: تعريف/سياق، ثم الفكرة الأساسية، ثم تفاصيل أو أمثلة، ثم خلاصة أو تطبيق.
- للموضوع العلمي: عرّف المفهوم، اشرح الآلية، ثم أعطِ مثالًا. للموضوع التاريخي: رتّب الأحداث زمنيًا واذكر الأسباب والنتائج. للمقارنة: وضّح أوجه الشبه والاختلاف في نقاط.
- استخدم Markdown خفيفًا داخل content: فقرات قصيرة، أو 3–6 نقاط عند التعداد، و**عريض** للمصطلح المهم فقط. لا تضع عناوين داخل content ولا تكرر عنوان القسم في أول سطر.
- اكتب بعربية فصحى مبسطة افتراضيًا. إذا كتب المستخدم بلغة أخرى فأجب باللغة نفسها.

المصادر:
- إذا وُجدت مصادر من محتوى المستخدم فهي الأساس في الإجابة عن السؤال المرتبط بها. اذكر الصفحة بعد المعلومة المأخوذة منها بهذا الشكل: [ص 12].
- لا تخترع رقم صفحة، ولا تنسب إلى المصدر معلومة غير موجودة فيه.
- إذا احتاج الشرح معلومة عامة غير واردة في المصدر، ضعها في جملة مستقلة تبدأ بـ«إضافة توضيحية:» حتى يعرف الطالب أنها خارج المصدر.
- إذا كان السؤال عامًا بلا مصدر، أجب من معرفتك العامة بدقة، وإذا لم تكن متأكدًا فقل ذلك.

الإخراج:
أعد كائن JSON واحدًا فقط، بلا أي نص قبله أو بعده، وبلا علامات \`\`\`. استخدم هذا المخطط حرفيًا:
{
  "lessonTitle": "عنوان الدرس",
  "sections": [
    { "title": "عنوان القسم", "content": "محتوى القسم بصيغة Markdown خفيفة" }
  ]
}
استخدم علامات اقتباس مزدوجة صحيحة، ولا تضع فاصلة بعد آخر عنصر. لا تخرج أي حقل إضافي.`;

const sectionSchema = z.object({
  title: z.string().trim().min(2, 'عنوان القسم قصير جدًا.').max(160, 'عنوان القسم طويل جدًا.'),
  content: z.string().trim().min(20, 'محتوى القسم قصير جدًا.').max(6000, 'محتوى القسم طويل جدًا.'),
});

const lessonSchema = z.object({
  lessonTitle: z.string().trim().min(3, 'عنوان الدرس قصير جدًا.').max(180, 'عنوان الدرس طويل جدًا.'),
  sections: z.array(sectionSchema).min(3, 'الدرس يحتاج ثلاثة أقسام على الأقل.').max(8, 'الدرس فيه أقسام أكثر من اللازم.'),
});

export interface TeacherLessonSource {
  contentId: number;
  contentVersion: number | null;
  title: string;
  bookId: number;
}

export interface TeacherLessonInput {
  userId: number;
  apiKey: string;
  question: string;
  source?: TeacherLessonSource | null;
}

export interface TeacherLessonSection {
  id: string;
  title: string;
  content: string;
}

function sourceBlock(chunks: ScoredChunk[]): string {
  return chunks
    .map((chunk, index) => {
      const pages =
        chunk.pageFrom === chunk.pageTo
          ? `ص ${chunk.pageFrom}`
          : `ص ${chunk.pageFrom}-${chunk.pageTo}`;
      return `[مصدر ${index + 1} | ${pages}]\n${chunk.content.slice(0, MAX_SOURCE_CHARS)}`;
    })
    .join('\n---\n');
}

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

function normalizeLesson(raw: string, question: string, sourceTitle: string | null) {
  const object = extractObject(raw);
  if (!object || typeof object !== 'object') throw new Error('الرد ليس كائن JSON.');
  const record = object as Record<string, unknown>;
  const lessonTitle =
    typeof record.lessonTitle === 'string'
      ? record.lessonTitle
      : typeof record.title === 'string'
        ? record.title
        : '';
  const sections = Array.isArray(record.sections)
    ? record.sections.map((section) => {
        if (!section || typeof section !== 'object') return section;
        const item = section as Record<string, unknown>;
        return {
          title: typeof item.title === 'string' ? item.title : '',
          content: typeof item.content === 'string' ? item.content : '',
        };
      })
    : record.sections;

  const parsed = lessonSchema.parse({ lessonTitle: lessonTitle || question.slice(0, 120), sections });
  return {
    lessonTitle: parsed.lessonTitle,
    sections: parsed.sections.map<TeacherLessonSection>((section, index) => ({
      id: `section-${index + 1}`,
      title: section.title,
      content: section.content,
    })),
    sourceTitle,
    sourceContentId: null as number | null,
  };
}

function validationMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'الدرس'}: ${issue.message}`)
      .join('؛ ');
  }
  return error instanceof Error ? error.message : 'بنية الرد غير صالحة.';
}

export async function createTeacherLesson(input: TeacherLessonInput) {
  const config = readAiConfig();
  const question = input.question.trim();
  if (question.length < 2) throw new HttpError(400, 'اكتب سؤالك أولًا.');
  if (question.length > 1200) throw new HttpError(400, 'السؤال طويل جدًا. اختصره قليلًا.');

  let chunks: ScoredChunk[] = [];
  if (input.source) {
    chunks = retrieveChunks(input.userId, {
      bookId: input.source.bookId,
      query: question,
      limit: MAX_SOURCE_CHUNKS,
    });
    if (chunks.length === 0) {
      throw new HttpError(
        422,
        'لم أجد في هذا المحتوى مقاطع مرتبطة بسؤالك. جرّب صياغة أقرب لما في الدرس، أو اسأل سؤالًا عامًا دون اختيار مصدر.',
        'teacher_source_empty',
      );
    }
  }

  assertQuota(input.userId, 1);

  const sources = citationsOf(chunks);
  const sourceText = chunks.length > 0
    ? `مصادر من محتوى المستخدم، وهي الأساس في الإجابة:\n${sourceBlock(chunks)}`
    : 'لا يوجد مصدر مرتبط بهذا السؤال. أجب من معرفتك العامة بدقة ووضوح.';

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${sourceText}\n\nسؤال المستخدم: ${question}\n\nحوّل هذا السؤال الآن إلى درس تفاعلي، وأعد JSON فقط.`,
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
        maxTokens: config.lessonMaxOutputTokens,
        temperature: 0.35,
        reasoningEffort: 'low',
        task: 'teacher',
      });
    } catch (error) {
      recordUsage({
        userId: input.userId,
        task: 'teacher_lesson',
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
      task: 'teacher_lesson',
      model: result.model,
      provider: result.provider,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      status: 'success',
    });

    try {
      const lesson = normalizeLesson(result.content, question, input.source?.title ?? null);
      lesson.sourceContentId = input.source?.contentId ?? null;
      return {
        lesson,
        sources,
        usage: {
          requests,
          tokensIn,
          tokensOut,
          remainingToday: Math.max(0, dailyLimitPerUser() - usageToday(input.userId).requests),
        },
      };
    } catch (error) {
      lastError = validationMessage(error);
      console.warn(`[nerd/teacher] رد غير صالح في المحاولة ${attempt + 1}: ${lastError}`);
      if (attempt === 0) {
        messages.push({
          role: 'assistant',
          content: result.content.slice(0, MAX_REPAIR_RAW_CHARS),
        });
        messages.push({
          role: 'user',
          content: `ردك السابق لم يطابق مخطط الدرس المطلوب (${lastError}). أعد كتابة الدرس كاملًا من جديد بصيغة JSON صحيحة فقط، مع lessonTitle وsections، وبلا أي نص خارج الكائن.`,
        });
      }
    }
  }

  throw new HttpError(
    502,
    'تعذّر بناء الدرس بصيغة منظمة. أعد المحاولة؛ سؤالك لم يُفقد.',
    'teacher_lesson_invalid',
  );
}
