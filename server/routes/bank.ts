import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.ts';
import { HttpError, rateLimit } from '../http.ts';
import {
  bankMeta,
  createTestFromBank,
  deleteBankQuestion,
  listBankQuestions,
} from '../bank.ts';

export const bankRouter = Router();

const typeSchema = z.enum(['mcq', 'true_false', 'short']);
const difficultySchema = z.enum(['easy', 'medium', 'hard', 'advanced', 'mixed']);

function intFrom(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

bankRouter.get('/bank', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const type = typeSchema.safeParse(req.query.type);
  const difficulty = difficultySchema.safeParse(req.query.difficulty);
  const bookIdRaw = Number(req.query.bookId);
  const bookId = Number.isInteger(bookIdRaw) && bookIdRaw > 0 ? bookIdRaw : null;
  const limit = Math.min(60, Math.max(1, intFrom(req.query.limit, 30)));
  const offset = intFrom(req.query.offset, 0);

  const list = listBankQuestions({
    userId: user.id,
    search: search || null,
    type: type.success ? type.data : null,
    difficulty: difficulty.success ? difficulty.data : null,
    bookId,
    limit,
    offset,
  });

  res.json({ ...list, ...bankMeta(user.id) });
});

bankRouter.delete('/bank/questions/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف السؤال غير صحيح.');

  res.json(deleteBankQuestion(user.id, id));
});

const fromBankSchema = z.object({
  questionIds: z.array(z.number().int().positive()).min(1).max(50),
  title: z.string().trim().min(3).max(120).optional().nullable(),
  durationMinutes: z.number().int().min(3).max(180).optional().nullable(),
});

bankRouter.post(
  '/bank/tests',
  rateLimit({ key: 'bank-test', limit: 30, windowMs: 60 * 60 * 1000 }),
  (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    let payload: z.infer<typeof fromBankSchema>;
    try {
      payload = fromBankSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new HttpError(400, error.issues[0]?.message ?? 'بيانات الاختبار غير صحيحة.');
      }
      throw error;
    }

    res.status(201).json(
      createTestFromBank({
        userId: user.id,
        questionIds: payload.questionIds,
        title: payload.title ?? null,
        durationMinutes: payload.durationMinutes ?? null,
      }),
    );
  },
);
