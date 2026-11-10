import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.ts';
import { HttpError, rateLimit } from '../http.ts';
import { GROQ_KEYS_URL, pricesKnown, readAiConfig } from '../ai/config.ts';
import { aiKeyFromRequest } from '../ai/key.ts';
import { aiProviderStatus, hasServerAiProviders } from '../ai/router.ts';
import { verifyAiKey } from '../ai/provider.ts';
import { dailyLimitPerUser, usageToday } from '../ai/usage.ts';
import { retrieveChunks } from '../ai/retrieval.ts';
import {
  createSummary,
  deleteSummary,
  DETAIL_LEVELS,
  getSummary,
  listSummaries,
} from '../ai/summaries.ts';
import { ask, deleteConversation, getConversation, listConversations } from '../ai/chat.ts';
import { createStudyKit, saveReviewState } from '../ai/study-kit.ts';
import { createTeacherLesson } from '../ai/lessons.ts';
import { createEnglishTest, explainEnglishRule, gradeEnglishTest } from '../ai/english.ts';
import { createArabicTest, explainArabicRule, gradeArabicTest } from '../ai/arabic.ts';
import { runStudyTool, STUDY_TOOL_MODES } from '../ai/study-tools.ts';
import { contentBookForUser } from './contents.ts';
import type { SummaryFocus } from '../ai/summaries.ts';

export const aiRouter = Router();

aiRouter.get('/ai/status', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const config = readAiConfig();
  const providerState = aiProviderStatus();
  const serverMode = hasServerAiProviders();
  const activeProviders = providerState.providers.filter((provider) => provider.configured);
  const used = usageToday(user.id);
  const limit = dailyLimitPerUser();
  let baseUrlHost: string | null = null;
  try {
    baseUrlHost = new URL(config.baseUrl).host;
  } catch {
    baseUrlHost = null;
  }
  res.json({
    // الخادم جاهز دائمًا؛ إما بمفاتيح المزوّدين على الخادم أو بمفتاح المتصفح القديم
    configured: true,
    provider: serverMode ? activeProviders.map((provider) => provider.label).join(' + ') : config.provider,
    model: serverMode ? (activeProviders[0]?.model ?? '') : config.chatModel,
    allowedModels: config.allowedModels,
    baseUrlHost,
    keySource: serverMode ? 'server' : 'client',
    routingMode: serverMode ? 'server' : 'client',
    providers: providerState.providers,
    keysUrl: serverMode ? undefined : GROQ_KEYS_URL,
    dailyLimit: limit,
    usedToday: used.requests,
    remaining: Math.max(0, limit - used.requests),
    costKnown: pricesKnown(config),
    missing: [],
    limits: {
      batchChars: config.batchChars,
      maxBatches: config.maxBatches,
      maxPagesPerRequest: config.maxBatches * 12,
    },
  });
});

// التحقق الحقيقي من مفتاح المستخدم قبل حفظه محليًا أو اختبار الاتصال منه
aiRouter.post('/ai/verify-key', rateLimit({ key: 'ai-verify', limit: 20, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const apiKey = aiKeyFromRequest(req);
  const result = await verifyAiKey(apiKey);
  res.json({ ok: true, ...result });
});

// استرجاع المقاطع (RAG) بدون توليد: يُستخدم لفحص المصادر ومعايرة النطاق
aiRouter.get('/ai/context', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const bookId = Number(req.query.bookId);
  const query = String(req.query.q ?? '').trim();
  if (!Number.isInteger(bookId) || bookId <= 0) {
    throw new HttpError(400, 'معرّف الكتاب مطلوب.');
  }
  if (query.length < 2) {
    throw new HttpError(400, 'اكتب كلمة أو عبارة للاسترجاع.');
  }
  const limit = Number(req.query.limit);
  const results = retrieveChunks(user.id, {
    bookId,
    query,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 20) : 8,
  });
  res.json({
    query,
    results: results.map((chunk) => ({
      chunkId: chunk.id,
      pageFrom: chunk.pageFrom,
      pageTo: chunk.pageTo,
      score: chunk.score,
      preview: chunk.content.slice(0, 220),
    })),
  });
});

// ---------- أدوات الدراسة الذكية ----------
const studyToolSchema = z
  .object({
    mode: z.enum(STUDY_TOOL_MODES),
    topic: z.string().trim().min(2, 'اكتب الموضوع أو السؤال أولًا.').max(4000, 'النص طويل جدًا.'),
    contentId: z.number().int().positive().optional().nullable(),
    level: z.enum(['brief', 'standard', 'deep']).optional().default('standard'),
    answer: z.string().trim().max(12_000, 'الإجابة طويلة جدًا.').optional().nullable(),
    rubric: z.string().trim().max(3000, 'معايير التصحيح طويلة جدًا.').optional().nullable(),
    notes: z.string().trim().max(3000, 'الملاحظات طويلة جدًا.').optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'grader' && !value.answer?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['answer'],
        message: 'الصق إجابة الطالب حتى يستطيع التصحيح تقييمها.',
      });
    }
    if (value.mode === 'solver' && value.topic.trim().length < 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['topic'],
        message: 'اكتب المسألة كاملة حتى يستطيع الحل شرح الخطوات.',
      });
    }
  });

aiRouter.post(
  '/ai/tools',
  rateLimit({ key: 'ai-tool', limit: 40, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const payload = studyToolSchema.parse(req.body);
    const source = payload.contentId ? contentBookForUser(user.id, payload.contentId) : null;
    const result = await runStudyTool({
      userId: user.id,
      apiKey: aiKeyFromRequest(req),
      mode: payload.mode,
      topic: payload.topic,
      contentId: source?.id ?? null,
      contentVersion: source?.version ?? null,
      contentTitle: source?.title ?? null,
      bookId: source?.bookId ?? null,
      level: payload.level,
      answer: payload.answer?.trim() || null,
      rubric: payload.rubric?.trim() || null,
      notes: payload.notes?.trim() || null,
    });
    res.status(201).json({ result });
  },
);

// ---------- تعلّم الإنجليزية ----------
const englishBaseSchema = z.object({
  rule: z.string().trim().min(2, 'اكتب القاعدة الإنجليزية أولًا.').max(400, 'اسم القاعدة طويل جدًا.'),
  note: z.string().trim().max(1_000, 'الملاحظة طويلة جدًا.').optional().nullable(),
});

aiRouter.post(
  '/ai/english/explain',
  rateLimit({ key: 'english-explain', limit: 20, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const payload = englishBaseSchema.parse(req.body);
    const result = await explainEnglishRule({
      userId: user.id,
      apiKey: aiKeyFromRequest(req),
      rule: payload.rule,
      note: payload.note?.trim() || null,
    });
    res.json(result);
  },
);

const questionModeSchema = z.enum(['mcq', 'mixed']).default('mcq');
const languageDifficultySchema = z.enum(['easy', 'medium', 'hard', 'advanced']).default('medium');

const englishTestSchema = englishBaseSchema.extend({
  count: z.number().int().min(5, 'عدد الأسئلة يجب أن يكون 5 على الأقل.').max(25, 'عدد الأسئلة يجب ألا يتجاوز 25.'),
  questionMode: questionModeSchema,
  difficulty: languageDifficultySchema,
});

aiRouter.post(
  '/ai/english/test',
  rateLimit({ key: 'english-test', limit: 15, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const payload = englishTestSchema.parse(req.body);
    const result = await createEnglishTest({
      userId: user.id,
      apiKey: aiKeyFromRequest(req),
      rule: payload.rule,
      note: payload.note?.trim() || null,
      count: payload.count,
      questionMode: payload.questionMode,
      difficulty: payload.difficulty,
    });
    res.status(201).json(result);
  },
);

const englishGradeSchema = z.object({
  sessionId: z.string().trim().min(10, 'جلسة الامتحان غير صحيحة.').max(80, 'جلسة الامتحان غير صحيحة.'),
  answers: z
    .array(
      z.object({
        questionId: z.string().trim().min(1).max(40),
        selectedIndex: z.number().int().min(0).max(3).optional().nullable(),
        text: z.string().trim().max(1_200, 'الإجابة طويلة جدًا.').optional().nullable(),
      }),
    )
    .max(30, 'عدد الإجابات أكبر من عدد الأسئلة.'),
});

aiRouter.post(
  '/ai/english/grade',
  rateLimit({ key: 'english-grade', limit: 40, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const payload = englishGradeSchema.parse(req.body);
    res.json(
      gradeEnglishTest({
        userId: user.id,
        sessionId: payload.sessionId,
        answers: payload.answers,
      }),
    );
  },
);

// ---------- تعلّم اللغة العربية ----------
const arabicBaseSchema = z.object({
  rule: z.string().trim().min(2, 'اكتب القاعدة أو الموضوع العربي أولًا.').max(400, 'اسم القاعدة أو الموضوع طويل جدًا.'),
  note: z.string().trim().max(1_000, 'الملاحظة طويلة جدًا.').optional().nullable(),
});

aiRouter.post(
  '/ai/arabic/explain',
  rateLimit({ key: 'arabic-explain', limit: 20, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const payload = arabicBaseSchema.parse(req.body);
    const result = await explainArabicRule({
      userId: user.id,
      apiKey: aiKeyFromRequest(req),
      rule: payload.rule,
      note: payload.note?.trim() || null,
    });
    res.json(result);
  },
);

const arabicTestSchema = arabicBaseSchema.extend({
  count: z.number().int().min(5, 'عدد الأسئلة يجب أن يكون 5 على الأقل.').max(25, 'عدد الأسئلة يجب ألا يتجاوز 25.'),
  questionMode: questionModeSchema,
  difficulty: languageDifficultySchema,
});

aiRouter.post(
  '/ai/arabic/test',
  rateLimit({ key: 'arabic-test', limit: 15, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const payload = arabicTestSchema.parse(req.body);
    const result = await createArabicTest({
      userId: user.id,
      apiKey: aiKeyFromRequest(req),
      rule: payload.rule,
      note: payload.note?.trim() || null,
      count: payload.count,
      questionMode: payload.questionMode,
      difficulty: payload.difficulty,
    });
    res.status(201).json(result);
  },
);

aiRouter.post(
  '/ai/arabic/grade',
  rateLimit({ key: 'arabic-grade', limit: 40, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const payload = englishGradeSchema.parse(req.body);
    res.json(
      gradeArabicTest({
        userId: user.id,
        sessionId: payload.sessionId,
        answers: payload.answers,
      }),
    );
  },
);

const summarySchema = z
  .object({
    bookId: z.number().int().positive().optional(),
    contentId: z.number().int().positive().optional(),
    detailLevel: z.enum(['short', 'medium', 'detailed']),
    focus: z.string().trim().max(200).optional().nullable(),
    focusKind: z.enum(['key_ideas', 'definitions', 'laws', 'comparisons', 'causes']).optional().nullable(),
    pageFrom: z.number().int().positive().optional().nullable(),
    pageTo: z.number().int().positive().optional().nullable(),
  })
  .refine((value) => Boolean(value.bookId || value.contentId), {
    message: 'حدّد كتابًا أو محتوى دراسيًا أولًا.',
  });

aiRouter.post('/summaries', rateLimit({ key: 'ai-summary', limit: 20, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  let payload: z.infer<typeof summarySchema>;
  try {
    payload = summarySchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new HttpError(400, error.issues[0]?.message ?? 'طلبات التلخيص غير صحيحة.');
    }
    throw error;
  }
  if (!DETAIL_LEVELS.includes(payload.detailLevel)) {
    throw new HttpError(400, 'مستوى التفصيل غير معروف.');
  }

  const source = payload.contentId ? contentBookForUser(user.id, payload.contentId) : null;
  const result = await createSummary({
    userId: user.id,
    apiKey: aiKeyFromRequest(req),
    bookId: source?.bookId ?? payload.bookId!,
    contentId: source?.id ?? null,
    contentVersion: source?.version ?? null,
    detailLevel: payload.detailLevel,
    focus: payload.focus ?? null,
    focusKind: (payload.focusKind as SummaryFocus | null | undefined) ?? null,
    pageFrom: payload.pageFrom ?? null,
    pageTo: payload.pageTo ?? null,
  });
  res.status(201).json(result);
});

aiRouter.get('/summaries', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ summaries: listSummaries(user.id) });
});

aiRouter.get('/summaries/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف الملخص غير صحيح.');
  res.json({ summary: getSummary(user.id, id) });
});

aiRouter.post('/summaries/:id/study-kit', rateLimit({ key: 'summary-kit', limit: 10, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف الملخص غير صحيح.');
  const result = await createStudyKit({
    userId: user.id,
    summaryId: id,
    apiKey: aiKeyFromRequest(req),
  });
  res.status(201).json(result);
});

aiRouter.patch('/summaries/:id/review', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف الملخص غير صحيح.');
  const body = req.body as {
    cards?: Record<string, 'known' | 'learning'>;
    quiz?: Record<string, { correct: boolean; answer: string }>;
    resetQuiz?: boolean;
  };
  res.json({ reviewState: saveReviewState(user.id, id, body ?? {}) });
});

aiRouter.delete('/summaries/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف الملخص غير صحيح.');
  deleteSummary(user.id, id);
  res.json({ ok: true });
});

// ---------- المحادثة التعليمية ----------
const chatSchema = z.object({
  question: z.string().trim().min(2, 'اكتب سؤالك أولًا.').max(1200, 'السؤال طويل جدًا.'),
  conversationId: z.number().int().positive().optional().nullable(),
  bookId: z.number().int().positive().optional().nullable(),
  contentId: z.number().int().positive().optional().nullable(),
});

aiRouter.post('/ai/chat', rateLimit({ key: 'ai-chat', limit: 60, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  let payload: z.infer<typeof chatSchema>;
  try {
    payload = chatSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new HttpError(400, error.issues[0]?.message ?? 'الرسالة غير صحيحة.');
    }
    throw error;
  }
  const source = payload.contentId ? contentBookForUser(user.id, payload.contentId) : null;
  const result = await ask({
    userId: user.id,
    apiKey: aiKeyFromRequest(req),
    conversationId: payload.conversationId ?? null,
    bookId: source?.bookId ?? payload.bookId ?? null,
    contentId: source?.id ?? null,
    contentVersion: source?.version ?? null,
    question: payload.question,
  });
  res.status(201).json(result);
});

// ---------- اسأل المعلم: درس تفاعلي مستقل عن الدردشة ----------
const teacherLessonSchema = z.object({
  question: z.string().trim().min(2, 'اكتب سؤالك أولًا.').max(1200, 'السؤال طويل جدًا.'),
  contentId: z.number().int().positive().optional().nullable(),
});

aiRouter.post(
  '/ai/teacher-lesson',
  rateLimit({ key: 'ai-teacher-lesson', limit: 30, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    let payload: z.infer<typeof teacherLessonSchema>;
    try {
      payload = teacherLessonSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new HttpError(400, error.issues[0]?.message ?? 'طلب الدرس غير صحيح.');
      }
      throw error;
    }
    const source = payload.contentId ? contentBookForUser(user.id, payload.contentId) : null;
    const result = await createTeacherLesson({
      userId: user.id,
      apiKey: aiKeyFromRequest(req),
      question: payload.question,
      source: source
        ? {
            contentId: source.id,
            contentVersion: source.version,
            title: source.title,
            bookId: source.bookId,
          }
        : null,
    });
    res.status(201).json(result);
  },
);

aiRouter.get('/ai/conversations', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ conversations: listConversations(user.id) });
});

aiRouter.get('/ai/conversations/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف المحادثة غير صحيح.');
  res.json(getConversation(user.id, id));
});

aiRouter.delete('/ai/conversations/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف المحادثة غير صحيح.');
  deleteConversation(user.id, id);
  res.json({ ok: true });
});
