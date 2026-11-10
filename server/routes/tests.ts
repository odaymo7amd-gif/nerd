import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.ts';
import { HttpError, rateLimit } from '../http.ts';
import { aiKeyFromRequest } from '../ai/key.ts';
import { contentBookForUser } from './contents.ts';
import {
  checkAttemptAnswer,
  createManualTest,
  createTest,
  deleteTest,
  getAttemptResult,
  getTest,
  listTests,
  startAttempt,
  submitAttempt,
} from '../ai/tests.ts';

export const testsRouter = Router();

function idFrom(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, `معرّف ${label} غير صحيح.`);
  return value;
}

const createSchema = z
  .object({
    bookId: z.number().int().positive().optional(),
    contentId: z.number().int().positive().optional(),
    count: z.number().int().min(5, 'عدد الأسئلة يجب أن يكون 5 على الأقل.').max(25, 'عدد الأسئلة يجب ألا يتجاوز 25.').optional(),
    difficulty: z.enum(['easy', 'medium', 'hard', 'advanced', 'mixed']).optional(),
    types: z
      .array(
        z.enum([
          'mcq',
          'true_false',
          'short',
          'fill_blank',
          'explain',
          'compare',
          'essay',
          'math',
        ]),
      )
      .min(1)
      .max(8)
      .optional(),
    focus: z.string().trim().max(200).optional().nullable(),
    pageFrom: z.number().int().positive().optional().nullable(),
    pageTo: z.number().int().positive().optional().nullable(),
    durationMinutes: z.number().int().min(3).max(180).optional().nullable(),
    timed: z.boolean().optional(),
    showAnswers: z.enum(['after_finish', 'after_each']).optional(),
  })
  .refine((value) => Boolean(value.bookId || value.contentId), {
    message: 'حدّد كتابًا أو محتوى دراسيًا أولًا.',
  });

testsRouter.post('/tests', rateLimit({ key: 'tests-create', limit: 12, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  let payload: z.infer<typeof createSchema>;
  try {
    payload = createSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new HttpError(400, error.issues[0]?.message ?? 'بيانات الاختبار غير صحيحة.');
    }
    throw error;
  }

  const source = payload.contentId ? contentBookForUser(user.id, payload.contentId) : null;
  const result = await createTest({
    userId: user.id,
    apiKey: aiKeyFromRequest(req),
    bookId: source?.bookId ?? payload.bookId!,
    contentId: source?.id ?? null,
    contentVersion: source?.version ?? null,
    count: payload.count ?? 10,
    difficulty: payload.difficulty ?? 'medium',
    types: payload.types ?? ['mcq'],
    focus: payload.focus ?? null,
    pageFrom: payload.pageFrom ?? null,
    pageTo: payload.pageTo ?? null,
    durationMinutes: payload.durationMinutes ?? null,
    timed: payload.timed ?? true,
    showAnswers: payload.showAnswers ?? 'after_finish',
  });
  res.status(201).json(result);
});

const manualSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'advanced', 'mixed']).optional(),
  durationMinutes: z.number().int().min(3).max(180).optional().nullable(),
  questions: z
    .array(
      z.object({
        type: z.enum(['mcq', 'true_false', 'short', 'fill_blank', 'explain', 'compare', 'essay', 'math']),
        text: z.string().trim().min(8).max(1000),
        options: z.array(z.string().trim().min(1).max(400)).max(5).optional().nullable(),
        correctIndex: z.number().int().min(0).max(4).optional().nullable(),
        answer: z.string().trim().max(400).optional().nullable(),
        accept: z.array(z.string().trim().min(1).max(400)).max(6).optional().nullable(),
        explanation: z.string().trim().max(1000).optional().nullable(),
        page: z.number().int().min(1).max(5000).optional().nullable(),
      }),
    )
    .min(1)
    .max(50),
});

testsRouter.post(
  '/tests/manual',
  rateLimit({ key: 'tests-manual', limit: 30, windowMs: 60 * 60 * 1000 }),
  (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    let payload: z.infer<typeof manualSchema>;
    try {
      payload = manualSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new HttpError(400, error.issues[0]?.message ?? 'بيانات الاختبار غير صحيحة.');
      }
      throw error;
    }

    res.status(201).json(
      createManualTest({
        userId: user.id,
        title: payload.title ?? 'اختبار يدوي',
        difficulty: payload.difficulty ?? 'medium',
        durationMinutes: payload.durationMinutes ?? null,
        questions: payload.questions.map((question) => ({
          type: question.type,
          text: question.text,
          options: question.options ?? [],
          correctIndex: question.correctIndex ?? null,
          answer: question.answer ?? null,
          accept: question.accept ?? [],
          explanation: question.explanation ?? null,
          page: question.page ?? null,
        })),
      }),
    );
  },
);

testsRouter.get('/tests', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json(listTests(user.id));
});

testsRouter.get('/tests/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ test: getTest(user.id, idFrom(req.params.id, 'الاختبار')) });
});

testsRouter.delete('/tests/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  deleteTest(user.id, idFrom(req.params.id, 'الاختبار'));
  res.json({ ok: true });
});

testsRouter.post('/tests/:id/attempts', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.status(201).json(startAttempt(user.id, idFrom(req.params.id, 'الاختبار')));
});

const submitSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.number().int().positive(),
        optionId: z.number().int().positive().optional().nullable(),
        text: z.string().max(3000).optional().nullable(),
      }),
    )
    .max(60)
    .optional(),
});

testsRouter.post('/tests/:id/attempts/:attemptId/submit', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  let payload: z.infer<typeof submitSchema>;
  try {
    payload = submitSchema.parse(req.body ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new HttpError(400, error.issues[0]?.message ?? 'الإجابات غير صحيحة.');
    }
    throw error;
  }

  const result = submitAttempt({
    userId: user.id,
    testId: idFrom(req.params.id, 'الاختبار'),
    attemptId: idFrom(req.params.attemptId, 'المحاولة'),
    answers: (payload.answers ?? []).map((answer) => ({
      questionId: answer.questionId,
      optionId: answer.optionId ?? null,
      text: answer.text ?? null,
    })),
  });
  res.json(result);
});

const checkSchema = z.object({
  questionId: z.number().int().positive(),
  optionId: z.number().int().positive().optional().nullable(),
  text: z.string().max(3000).optional().nullable(),
});

testsRouter.post('/tests/:id/attempts/:attemptId/check', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const payload = checkSchema.parse(req.body ?? {});
  res.json(
    checkAttemptAnswer({
      userId: user.id,
      testId: idFrom(req.params.id, 'الاختبار'),
      attemptId: idFrom(req.params.attemptId, 'المحاولة'),
      questionId: payload.questionId,
      optionId: payload.optionId ?? null,
      text: payload.text ?? null,
    }),
  );
});

testsRouter.get('/tests/:id/attempts/:attemptId', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json(getAttemptResult(user.id, idFrom(req.params.id, 'الاختبار'), idFrom(req.params.attemptId, 'المحاولة')));
});
