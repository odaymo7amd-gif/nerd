// «تعلّم الإنجليزية»: شرح قاعدة إنجليزية، ثم امتحان مولّد عليها، ثم تصحيح ومراجعة.
// يستخدم نفس مزوّد الذكاء الاصطناعي ومفتاح المستخدم والحد اليومي الموجود في نيرد.
// أسئلة الامتحان تبقى في جلسة مؤقتة على الخادم، فلا تصل الإجابات الصحيحة إلى المتصفح
// قبل تسليم الامتحان.

import { randomUUID } from 'node:crypto';
import { get } from '../db.ts';
import { HttpError } from '../http.ts';
import { readAiConfig } from './config.ts';
import { chatCompletion, type ChatMessage } from './provider.ts';
import { assertQuota, dailyLimitPerUser, recordUsage, usageToday } from './usage.ts';
import {
  difficultyPromptLines,
  LANGUAGE_DIFFICULTY_INSTRUCTIONS,
  LANGUAGE_DIFFICULTY_LABELS,
  languageDifficultyFrom,
  type LanguageDifficulty,
} from './languageDifficulty.ts';

export const ENGLISH_QUESTION_TYPES = ['mcq', 'fill_blank', 'error_correction'] as const;
export type EnglishQuestionType = (typeof ENGLISH_QUESTION_TYPES)[number];
export const ENGLISH_QUESTION_MODES = ['mcq', 'mixed'] as const;
export type EnglishQuestionMode = (typeof ENGLISH_QUESTION_MODES)[number];

/** الأنواع التي يطلبها كل وضع في أداة تعلّم الإنجليزية. */
export function englishQuestionTypesForMode(mode: EnglishQuestionMode): EnglishQuestionType[] {
  return mode === 'mixed' ? ['mcq', 'fill_blank'] : ['mcq'];
}

/** توزيع متوازن قدر الإمكان: الاختيار من متعدد أولًا عند وجود عدد فردي. */
export function englishTypeQuota(count: number, mode: EnglishQuestionMode): Record<'mcq' | 'fill_blank', number> {
  if (mode === 'mcq') return { mcq: count, fill_blank: 0 };
  const fill = Math.floor(count / 2);
  return { mcq: count - fill, fill_blank: fill };
}

export const ENGLISH_TYPE_LABELS: Record<EnglishQuestionType, string> = {
  mcq: 'اختيار من متعدد',
  fill_blank: 'أكمل الفراغ',
  error_correction: 'صحّح الخطأ',
};

interface DraftQuestion {
  type: EnglishQuestionType;
  prompt: string;
  options: string[];
  correctIndex: number | null;
  correctAnswer: string;
  accept: string[];
  explanation: string;
}

export interface PublicEnglishQuestion {
  id: string;
  type: EnglishQuestionType;
  typeLabel: string;
  prompt: string;
  options: string[];
}

interface StoredQuestion extends DraftQuestion {
  id: string;
}

interface EnglishSession {
  id: string;
  userId: number;
  rule: string;
  note: string | null;
  count: number;
  questionMode: EnglishQuestionMode;
  difficulty: LanguageDifficulty;
  questions: StoredQuestion[];
  provider: string;
  model: string;
  createdAt: number;
}

export interface EnglishReviewQuestion extends PublicEnglishQuestion {
  answered: boolean;
  selectedIndex: number | null;
  answerText: string | null;
  correctIndex: number | null;
  correctAnswer: string;
  explanation: string;
  isCorrect: boolean;
}

const sessions = new Map<string, EnglishSession>();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 600;

function sweepSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
  // لا نُبقي جلسات قديمة كثيرة في الذاكرة إن استخدم الأداة عدد كبير من الطلاب.
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (!oldest) break;
    sessions.delete(oldest);
  }
}

function userGradeName(userId: number): string | null {
  const row = get<{ grade_name: string | null }>(
    `SELECT g.name_ar AS grade_name
       FROM users u
       LEFT JOIN grade_levels g ON g.id = u.grade_level_id
      WHERE u.id = ?`,
    userId,
  );
  return row?.grade_name ?? null;
}

function cleanText(value: unknown, max = 900): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function publicQuestion(question: StoredQuestion): PublicEnglishQuestion {
  return {
    id: question.id,
    type: question.type,
    typeLabel: ENGLISH_TYPE_LABELS[question.type],
    prompt: question.prompt,
    options: question.options,
  };
}

function extractJson(raw: string): unknown {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    const objectStart = cleaned.indexOf('{');
    const objectEnd = cleaned.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        return JSON.parse(cleaned.slice(objectStart, objectEnd + 1)) as unknown;
      } catch {
        // نتابع إلى محاولة المصفوفة
      }
    }
    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      try {
        return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1)) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function rawQuestions(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.questions)) return record.questions;
    if (Array.isArray(record.items)) return record.items;
  }
  return [];
}

function normalizeType(value: unknown): EnglishQuestionType | null {
  const type = cleanText(value, 40).toLowerCase().replace(/[\s-]+/g, '_');
  if (type === 'mcq' || type === 'multiple_choice' || type === 'multiple_choice_question') return 'mcq';
  if (type === 'fill_blank' || type === 'fill_in_blank' || type === 'fill_in_the_blank' || type === 'correct_form') {
    return 'fill_blank';
  }
  if (type === 'error_correction' || type === 'correct_the_error' || type === 'correction') {
    return 'error_correction';
  }
  return null;
}

function normalizeTextForCompare(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function englishAnswerMatches(given: string, correct: string, accept: string[] = []): boolean {
  const normalizedGiven = normalizeTextForCompare(given);
  if (!normalizedGiven) return false;
  return [correct, ...accept].some((candidate) => {
    const normalizedCandidate = normalizeTextForCompare(candidate);
    return normalizedCandidate.length > 0 && normalizedCandidate === normalizedGiven;
  });
}

/**
 * يحوّل رد النموذج إلى أسئلة مربوطة بالقاعدة، ويرفض الأسئلة الناقصة أو المكررة
 * بدل تمرير بيانات غير صالحة إلى الواجهة.
 */
export function normalizeEnglishQuestions(value: unknown, limit: number): DraftQuestion[] {
  const items = rawQuestions(value);
  const normalized: DraftQuestion[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const type = normalizeType(record.type);
    if (!type) continue;

    const prompt = cleanText(record.prompt ?? record.question ?? record.text, 1_200);
    if (prompt.length < 8) continue;
    const promptKey = normalizeTextForCompare(prompt);
    if (!promptKey || seen.has(promptKey)) continue;

    const explanation = cleanText(record.explanation ?? record.reason, 1_200);
    if (explanation.length < 5) continue;

    if (type === 'mcq') {
      const rawOptions = Array.isArray(record.options) ? record.options : [];
      const options: string[] = [];
      for (const option of rawOptions) {
        const text = cleanText(option, 300);
        if (text && !options.some((current) => normalizeTextForCompare(current) === normalizeTextForCompare(text))) {
          options.push(text);
        }
      }
      if (options.length !== 4) continue;

      const rawIndex = Number(record.correctIndex ?? record.correct_index);
      if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= options.length) continue;

      normalized.push({
        type,
        prompt,
        options,
        correctIndex: rawIndex,
        correctAnswer: options[rawIndex],
        accept: [],
        explanation,
      });
      seen.add(promptKey);
      continue;
    }

    if (type === 'fill_blank' && !/_{2,}/.test(prompt)) continue;

    const answer = cleanText(
      record.answer ?? record.correctAnswer ?? record.correct_answer ?? record.correction,
      600,
    );
    if (answer.length < 1) continue;
    const rawAccept = Array.isArray(record.accept)
      ? record.accept
      : typeof record.accept === 'string'
        ? [record.accept]
        : [];
    const accept = rawAccept
      .map((item) => cleanText(item, 600))
      .filter((item) => item.length > 0 && normalizeTextForCompare(item) !== normalizeTextForCompare(answer))
      .slice(0, 5);

    normalized.push({
      type,
      prompt,
      options: [],
      correctIndex: null,
      correctAnswer: answer,
      accept,
      explanation,
    });
    seen.add(promptKey);
  }

  return normalized.slice(0, limit);
}

function stripDuplicateTitle(content: string, rule: string): string {
  const match = content.match(/^#\s+(.+?)\s*(?:\r?\n)+/);
  if (!match) return content;
  const title = normalizeTextForCompare(match[1]);
  const target = normalizeTextForCompare(rule);
  if (!title || !target) return content;
  if (title === target || title.includes(target) || target.includes(title)) {
    return content.slice(match[0].length).trimStart();
  }
  return content;
}

function explanationPrompt(rule: string, note: string | null, grade: string | null): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `أنت معلم لغة إنجليزية محترف يشرح لطلاب المدارس العرب، وأسلوبك بسيط ودقيق ومشجّع.

المطلوب: شرح قاعدة إنجليزية واحدة شرحًا تعليميًا متكاملًا باللغة العربية، مع أمثلة إنجليزية واضحة.
- ابدأ بعنوان القاعدة باللغة الإنجليزية، ثم جملة قصيرة تشرح معناها.
- اشرح متى تُستخدم القاعدة، وتركيب الجملة (Structure)، ثم الإثبات والنفي والسؤال عندما تكون هذه الأجزاء مناسبة للقاعدة.
- أعطِ أمثلة إنجليزية صحيحة ومتنوعة من حياة الطالب، وبعد كل مثال ترجمته العربية وسبب استخدام القاعدة فيه.
- اذكر الكلمات الدالة (Signal Words) إن وُجدت.
- اشرح الأخطاء الشائعة التي يقع فيها الطلاب، والاستثناءات المهمة إن وُجدت.
- قارنها بقاعدة مشابهة عندما يساعد ذلك على الفهم، مثل الفرق بين Present Perfect وPast Simple.
- اختم بخلاصة قصيرة تساعد الطالب على التذكر.
- استخدم عناوين فرعية واضحة وقوائم قصيرة، وجدولًا عند الحاجة للمقارنة. لا تكتب فقرة طويلة متصلة.
- لا تفرض جميع الأقسام على كل قاعدة؛ اختر المناسب لطبيعة القاعدة.
- لا تخترع قواعد أو استثناءات غير صحيحة. إذا كانت هناك معلومة غير مؤكدة، اذكر أنها نقطة تحتاج مراجعة بدل اختلاقها.
- اكتب الشرح بالعربية، والأمثلة الإنجليزية باتجاه LTR داخل النص.
- لا تكرر المعلومات، ولا تبدأ بمقدمة عن نفسك، ولا تقل إنك نموذج ذكاء اصطناعي.
- اجعل الشرح مفيدًا لطالب مدرسة، وليس مقالًا أكاديميًا طويلًا.`,
    },
    {
      role: 'user',
      content: [
        `القاعدة المطلوبة: ${rule}`,
        grade ? `الصف الدراسي للطالب: ${grade}` : null,
        note ? `ملاحظة الطالب الإضافية (راعها كتفضيل تعليمي، وليست قاعدة): ${note}` : null,
        '',
        'اكتب الشرح الكامل الآن بصيغة Markdown منظمة.',
      ]
        .filter((line) => line !== null)
        .join('\n'),
    },
  ];
}

export async function explainEnglishRule(input: {
  userId: number;
  apiKey: string;
  rule: string;
  note: string | null;
}) {
  const rule = input.rule.trim();
  const note = input.note?.trim() || null;
  if (rule.length < 2) throw new HttpError(400, 'اكتب القاعدة الإنجليزية أولًا.');
  if (rule.length > 400) throw new HttpError(400, 'اسم القاعدة طويل جدًا. اختصره قليلًا.');

  assertQuota(input.userId, 1);
  const config = readAiConfig();

  let result;
  try {
    result = await chatCompletion({
      apiKey: input.apiKey,
      messages: explanationPrompt(rule, note, userGradeName(input.userId)),
      maxTokens: Math.min(4_200, Math.max(2_800, config.lessonMaxOutputTokens)),
      temperature: 0.3,
      reasoningEffort: 'low',
      task: 'english',
    });
    recordUsage({
      userId: input.userId,
      task: 'english-explain',
      model: result.model,
      provider: result.provider,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      status: 'success',
    });
  } catch (error) {
    recordUsage({
      userId: input.userId,
      task: 'english-explain',
      model: config.chatModel,
      provider: config.provider,
      tokensIn: 0,
      tokensOut: 0,
      status: 'failed',
    });
    throw error;
  }

  const rawContent = result.content.replace(/^\s*```(?:markdown|md)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const content = stripDuplicateTitle(rawContent, rule);
  if (content.length < 250) {
    throw new HttpError(
      502,
      'وصل شرح ناقص من النموذج. لم يُعرض شرح غير مكتمل؛ أعد المحاولة.',
      'english_explanation_incomplete',
    );
  }

  return {
    explanation: {
      rule,
      note,
      content,
      provider: result.provider,
      model: result.model,
      remainingToday: Math.max(0, dailyLimitPerUser() - usageToday(input.userId).requests),
    },
  };
}

function testPrompt(options: {
  rule: string;
  note: string | null;
  grade: string | null;
  existing: string[];
  quota: Record<'mcq' | 'fill_blank', number>;
  difficulty: LanguageDifficulty;
}): ChatMessage[] {
  const { rule, note, grade, existing, quota, difficulty } = options;
  const total = quota.mcq + quota.fill_blank;
  const quotaLines = [
    quota.mcq > 0 ? `- ${quota.mcq} سؤالًا من نوع mcq (اختيار من متعدد).` : null,
    quota.fill_blank > 0 ? `- ${quota.fill_blank} سؤالًا من نوع fill_blank (أكمل الفراغ).` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');
  const mcqShape = `{
      "type": "mcq",
      "prompt": "Choose the correct sentence.",
      "options": ["...", "...", "...", "..."],
      "correctIndex": 0,
      "explanation": "شرح عربي قصير يوضح سبب صحة الإجابة."
    }`;
  const fillShape = `{
      "type": "fill_blank",
      "prompt": "Complete the sentence: She ___ (live) here since 2020.",
      "answer": "has lived",
      "accept": ["has been living"],
      "explanation": "شرح عربي قصير."
    }`;

  return [
    {
      role: 'system',
      content: `أنت معلم إنجليزي خبير يكتب أسئلة تدريبية دقيقة لطلاب المدارس العرب.
المطلوب: إنشاء أسئلة إنجليزية مرتبطة ارتباطًا مباشرًا بالقاعدة المحددة، وليست أسئلة عامة عن اللغة.

التوزيع المطلوب إلزامي، ولا تزد أو تنقص عنه:
${quotaLines}

شروط الجودة:
- كل سؤال يجب أن يختبر القاعدة المحددة، وتكون له إجابة صحيحة واحدة واضحة.
- مستوى الصعوبة المطلوب: ${LANGUAGE_DIFFICULTY_LABELS[difficulty]}.
- ${LANGUAGE_DIFFICULTY_INSTRUCTIONS[difficulty]}
- ${difficulty === 'advanced' ? 'اجعل السؤال على النمط الوزاري الأردني وليس سؤالًا وزاريًا حقيقيًا، واطلب تحليلًا أو استنتاجًا لا مجرد تذكر.' : 'لا تخرج عن المستوى المختار.'}
- استخدم الإنجليزية في نص السؤال والخيارات، والعربية في شرح الإجابة.
- في أسئلة mcq: أربعة خيارات مختلفة بالضبط، وإجابة صحيحة واحدة، وcorrectIndex من 0 إلى 3.
- في أسئلة fill_blank: ضع فراغًا واضحًا مكتوبًا هكذا ___ داخل الجملة، والإجابة كلمة أو عبارة قصيرة محددة بالسياق.
- في fill_blank اذكر في accept كل الصيغ الصحيحة الأخرى التي لا تغيّر المعنى (مثل الصيغة الكاملة والاختصار إن صحّا)، دون إضافة إجابات خاطئة.
- لا تكرر السؤال أو الفكرة نفسها بصياغة مختلفة.
- لا تخرج عن القاعدة، ولا تختبر قاعدة أخرى.
- لا تجعل الإجابة الصحيحة واضحة بسبب طولها أو صياغتها.
- راعِ مستوى الطالب المدرسي، وملاحظته الإضافية إن وجدت.
- لا تخترع قاعدة أو مثالًا غير صحيح. تحقق من كل جملة إنجليزية قبل إخراجها.
- لا تعرض JSON خامًا في أي حقل.

أعد كائن JSON واحدًا فقط، بلا أي نص قبله أو بعده، وبهذا الشكل:
{
  "questions": [
    ${quota.mcq > 0 ? mcqShape : ''}${quota.mcq > 0 && quota.fill_blank > 0 ? ',' : ''}
    ${quota.fill_blank > 0 ? fillShape : ''}
  ]
}

قواعد الحقول:
- type: mcq أو fill_blank فقط.
- mcq: options أربع سلاسل نصية مختلفة، وcorrectIndex رقم من 0 إلى 3.
- fill_blank: answer إجابة نموذجية، وaccept مصفوفة صيغ بديلة مقبولة أو فارغة.
- explanation بالعربية، من سطر إلى سطرين.
- لا تضع حقولًا إضافية.`,
    },
    {
      role: 'user',
      content: [
        `القاعدة: ${rule}`,
        grade ? `الصف: ${grade}` : null,
        note ? `ملاحظة الطالب الإضافية (راعها في اختيار الأسئلة): ${note}` : null,
        `المطلوب الآن: ${quota.mcq} سؤال mcq و${quota.fill_blank} سؤال fill_blank، المجموع ${total}.`,
        ...difficultyPromptLines(difficulty),
        existing.length > 0
          ? `هذه أسئلة سبق إنشاؤها؛ لا تكررها ولا تعِد صياغتها:\n${existing.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
          : null,
        '',
        `أنشئ ${total} أسئلة جديدة الآن، وأعد JSON فقط.`,
      ]
        .filter((line) => line !== null)
        .join('\n'),
    },
  ];
}

async function generateBatch(options: {
  userId: number;
  apiKey: string;
  rule: string;
  note: string | null;
  grade: string | null;
  existing: string[];
  quota: Record<'mcq' | 'fill_blank', number>;
  difficulty: LanguageDifficulty;
}) {
  const config = readAiConfig();
  const messages = testPrompt(options);
  const total = options.quota.mcq + options.quota.fill_blank;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let requests = 0;
  let partial: DraftQuestion[] = [];
  let model = '';
  let provider = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assertQuota(options.userId, 1);
    let result;
    try {
      result = await chatCompletion({
        apiKey: options.apiKey,
        messages,
        maxTokens: Math.min(5_200, 1_000 + total * 360),
        temperature: 0.35,
        reasoningEffort: 'low',
        task: 'english',
      });
      recordUsage({
        userId: options.userId,
        task: 'english-test',
        model: result.model,
        provider: result.provider,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        status: 'success',
      });
    } catch (error) {
      recordUsage({
        userId: options.userId,
        task: 'english-test',
        model: config.chatModel,
        provider: config.provider,
        tokensIn: 0,
        tokensOut: 0,
        status: 'failed',
      });
      throw error;
    }

    requests += 1;
    totalTokensIn += result.tokensIn;
    totalTokensOut += result.tokensOut;
    model = result.model;
    provider = result.provider;

    const parsed = extractJson(result.content);
    const existingKeys = new Set(options.existing.map((prompt) => normalizeTextForCompare(prompt)));
    const candidates = normalizeEnglishQuestions(parsed, Math.max(total * 3, 30)).filter(
      (question) =>
        (question.type === 'mcq' || question.type === 'fill_blank') &&
        !existingKeys.has(normalizeTextForCompare(question.prompt)),
    );
    const picked: DraftQuestion[] = [];
    const used = { mcq: 0, fill_blank: 0 };
    for (const question of candidates) {
      if (question.type !== 'mcq' && question.type !== 'fill_blank') continue;
      if (used[question.type] >= options.quota[question.type]) continue;
      used[question.type] += 1;
      picked.push(question);
      if (picked.length === total) break;
    }

    if (picked.length === total) {
      return { questions: picked, tokensIn: totalTokensIn, tokensOut: totalTokensOut, requests, model: result.model, provider: result.provider };
    }
    if (picked.length > partial.length) partial = picked;

    if (attempt === 0) {
      messages.push({ role: 'assistant', content: result.content.slice(0, 14_000) });
      messages.push({
        role: 'user',
        content: `ردك السابق لم يطابق التوزيع المطلوب. أعد إنشاء ${options.quota.mcq} سؤال mcq و${options.quota.fill_blank} سؤال fill_blank فقط، بصيغة JSON صحيحة وبلا أي نص خارج JSON.`,
      });
    }
  }

  // نُعيد ما نجح من الأسئلة فقط؛ من ينشئ الامتحان يطلب الناقص في محاولة مستقلة
  // بدل إعادة توليد الامتحان كله أو عرض عدد أقل من المطلوب.
  return {
    questions: partial,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    requests,
    model,
    provider,
  };
}

export async function createEnglishTest(input: {
  userId: number;
  apiKey: string;
  rule: string;
  note: string | null;
  count: number;
  questionMode: EnglishQuestionMode;
  difficulty: LanguageDifficulty;
}) {
  const rule = input.rule.trim();
  const note = input.note?.trim() || null;
  const questionMode = input.questionMode === 'mixed' ? 'mixed' : 'mcq';
  const difficulty = languageDifficultyFrom(input.difficulty);
  if (rule.length < 2) throw new HttpError(400, 'اكتب القاعدة الإنجليزية أولًا.');
  if (rule.length > 400) throw new HttpError(400, 'اسم القاعدة طويل جدًا. اختصره قليلًا.');
  if (!Number.isInteger(input.count) || input.count < 5 || input.count > 25) {
    throw new HttpError(400, 'عدد الأسئلة يجب أن يكون بين 5 و25.');
  }

  const batchSize = 10;
  const plannedBatches = Math.ceil(input.count / batchSize);
  assertQuota(input.userId, plannedBatches);

  try {
    sweepSessions();
    const all: DraftQuestion[] = [];
    const seen = new Set<string>();
    const addUnique = (questions: DraftQuestion[]) => {
      for (const question of questions) {
        const key = normalizeTextForCompare(question.prompt);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        all.push(question);
      }
    };
    let requests = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let model = '';
    let provider = '';

    for (let offset = 0; offset < input.count; offset += batchSize) {
      const count = Math.min(batchSize, input.count - offset);
      const batch = await generateBatch({
        userId: input.userId,
        apiKey: input.apiKey,
        rule,
        note,
        grade: userGradeName(input.userId),
        existing: all.map((question) => question.prompt),
        quota: englishTypeQuota(count, questionMode),
        difficulty,
      });
      requests += batch.requests;
      tokensIn += batch.tokensIn;
      tokensOut += batch.tokensOut;
      model = batch.model;
      provider = batch.provider;
      addUnique(batch.questions);
    }

    // إن كرّر النموذج سؤالًا بين الدفعات، أو أعاد عددًا أقل، نطلب فقط
    // ما تبقّى من كل نوع في محاولات محدودة، مع الاحتفاظ بكل سؤال صالح.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (all.length >= input.count) break;
      const target = englishTypeQuota(input.count, questionMode);
      const current = {
        mcq: all.filter((question) => question.type === 'mcq').length,
        fill_blank: all.filter((question) => question.type === 'fill_blank').length,
      };
      const missing = {
        mcq: Math.max(0, target.mcq - current.mcq),
        fill_blank: Math.max(0, target.fill_blank - current.fill_blank),
      };
      if (missing.mcq + missing.fill_blank === 0) break;
      const fill = await generateBatch({
        userId: input.userId,
        apiKey: input.apiKey,
        rule,
        note,
        grade: userGradeName(input.userId),
        existing: all.map((question) => question.prompt),
        quota: missing,
        difficulty,
      });
      requests += fill.requests;
      tokensIn += fill.tokensIn;
      tokensOut += fill.tokensOut;
      model = fill.model;
      provider = fill.provider;
      addUnique(fill.questions);
    }

    if (all.length < input.count) {
      throw new HttpError(
        502,
        `لم يكتمل الامتحان: وصل ${all.length} سؤالًا صالحًا من أصل ${input.count}. لم يُعرض امتحان ناقص. أعد المحاولة؛ سيعيد النظام طلب الأسئلة الناقصة فقط.`,
        'english_test_incomplete',
      );
    }

    const questions: StoredQuestion[] = all
      .slice(0, input.count)
      .sort((a, b) => {
        const order = { mcq: 0, fill_blank: 1, error_correction: 2 };
        return order[a.type] - order[b.type];
      })
      .map((question, index) => ({
        ...question,
        id: `q-${index + 1}`,
      }));

    const session: EnglishSession = {
      id: randomUUID(),
      userId: input.userId,
      rule,
      note,
      count: questions.length,
      questionMode,
      difficulty,
      questions,
      provider: provider || readAiConfig().provider,
      model: model || readAiConfig().chatModel,
      createdAt: Date.now(),
    };
    sessions.set(session.id, session);
    sweepSessions();

    return {
      test: {
        sessionId: session.id,
        rule: session.rule,
        note: session.note,
        count: session.count,
        questionMode: session.questionMode,
        difficulty: session.difficulty,
        questions: session.questions.map(publicQuestion),
        provider: session.provider,
        model: session.model,
        requests,
        tokensIn,
        tokensOut,
        remainingToday: Math.max(0, dailyLimitPerUser() - usageToday(input.userId).requests),
      },
    };
  } catch (error) {
    throw error;
  }
}

export function gradeEnglishTest(input: {
  userId: number;
  sessionId: string;
  answers: Array<{ questionId: string; selectedIndex?: number | null; text?: string | null }>;
}) {
  sweepSessions();
  const session = sessions.get(input.sessionId);
  if (!session || session.userId !== input.userId) {
    throw new HttpError(
      404,
      'انتهت جلسة الامتحان أو لم تعد متاحة. أعد إنشاء الامتحان.',
      'english_session_missing',
    );
  }

  const answers = new Map<string, { selectedIndex?: number | null; text?: string | null }>();
  for (const answer of input.answers) answers.set(answer.questionId, answer);

  let correctCount = 0;
  const review: EnglishReviewQuestion[] = session.questions.map((question) => {
    const answer = answers.get(question.id);
    let selectedIndex: number | null = null;
    let answerText: string | null = null;
    let isCorrect = false;

    if (question.type === 'mcq') {
      const raw = answer?.selectedIndex;
      if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < question.options.length) {
        selectedIndex = raw;
        isCorrect = raw === question.correctIndex;
      }
    } else {
      answerText = typeof answer?.text === 'string' ? answer.text.trim().slice(0, 1_200) || null : null;
      isCorrect = answerText ? englishAnswerMatches(answerText, question.correctAnswer, question.accept) : false;
    }

    if (isCorrect) correctCount += 1;
    const answered = question.type === 'mcq' ? selectedIndex != null : Boolean(answerText);
    return {
      ...publicQuestion(question),
      answered,
      selectedIndex,
      answerText,
      correctIndex: question.correctIndex,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      isCorrect,
    };
  });

  const total = review.length;
  const unansweredCount = review.filter((question) => !question.answered).length;
  const wrongCount = review.filter((question) => question.answered && !question.isCorrect).length;
  return {
    result: {
      sessionId: session.id,
      rule: session.rule,
      note: session.note,
      questionMode: session.questionMode,
      difficulty: session.difficulty,
      score: total > 0 ? Math.round((correctCount / total) * 100) : 0,
      correctCount,
      wrongCount,
      unansweredCount,
      total,
      questions: review,
    },
  };
}
