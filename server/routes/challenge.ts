// التحدي اليومي: خمسة أسئلة من بنك المستخدم، بترتيب ثابت يتغير كل يوم.
// لا يستهلك أي طلب ذكاء اصطناعي، ويُعاد استخدام محرك الاختبارات نفسه.

import { Router } from 'express';
import { all, get, run } from '../db.ts';
import { logActivity, requireUser } from '../auth.ts';
import { HttpError, rateLimit } from '../http.ts';
import { createTestFromBank } from '../bank.ts';
import { getTest } from '../ai/tests.ts';

export const challengeRouter = Router();

const QUESTION_COUNT = 5;
const MIN_QUESTIONS = 3;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ترتيب حتمي: نفس المستخدم ونفس اليوم يعطيان نفس الأسئلة، من دون تخزين قائمة إضافية.
function seededScore(id: number, seed: number): number {
  let value = (id * 2654435761 + seed) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

function seedFor(userId: number, date: string): number {
  let seed = 2166136261;
  for (const char of `${userId}:${date}`) {
    seed ^= char.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function challengeFor(userId: number, date: string) {
  return get<{
    id: number;
    title: string;
    questions_count: number;
    duration_minutes: number | null;
    status: string;
  }>(
    `SELECT id, title, questions_count, duration_minutes, status
       FROM tests
      WHERE user_id = ? AND challenge_date = ?`,
    userId,
    date,
  );
}

function summaryFor(userId: number, testId: number) {
  const row = get<{ attempts: number; best: number | null; last_attempt: number | null }>(
    `SELECT COUNT(*) AS attempts, MAX(score) AS best, MAX(id) AS last_attempt
       FROM test_attempts
      WHERE user_id = ? AND test_id = ? AND status = 'finished'`,
    userId,
    testId,
  );
  const active = get<{ id: number }>(
    `SELECT id FROM test_attempts
      WHERE user_id = ? AND test_id = ? AND status = 'in_progress'
      ORDER BY id DESC LIMIT 1`,
    userId,
    testId,
  );
  return {
    attempts: row?.attempts ?? 0,
    bestScore: row?.best ?? null,
    lastAttemptId: row?.last_attempt ?? null,
    activeAttemptId: active?.id ?? null,
  };
}

challengeRouter.get('/challenge', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const date = today();
  const bank = get<{ total: number }>('SELECT COUNT(*) AS total FROM questions WHERE user_id = ?', user.id);
  const test = challengeFor(user.id, date);
  const summary = test ? summaryFor(user.id, test.id) : { attempts: 0, bestScore: null, lastAttemptId: null, activeAttemptId: null };

  res.json({
    date,
    questionCount: QUESTION_COUNT,
    bankCount: bank?.total ?? 0,
    canStart: (bank?.total ?? 0) >= MIN_QUESTIONS,
    minimumQuestions: MIN_QUESTIONS,
    test: test
      ? {
          id: test.id,
          title: test.title,
          questionsCount: test.questions_count,
          durationMinutes: test.duration_minutes,
          status: test.status,
          ...summary,
        }
      : null,
  });
});

challengeRouter.post(
  '/challenge/start',
  rateLimit({ key: 'daily-challenge', limit: 12, windowMs: 60 * 60 * 1000 }),
  (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const date = today();

    const existing = challengeFor(user.id, date);
    if (existing) {
      res.json({
        test: getTest(user.id, existing.id),
        reused: true,
        ...summaryFor(user.id, existing.id),
      });
      return;
    }

    const ids = all<{ id: number }>('SELECT id FROM questions WHERE user_id = ?', user.id).map(
      (row) => row.id,
    );
    if (ids.length < MIN_QUESTIONS) {
      throw new HttpError(
        422,
        `تحتاج ${MIN_QUESTIONS} أسئلة على الأقل في بنك الأسئلة لبدء التحدي. أنشئ اختبارًا أولًا أو اكتب أسئلة يدوية.`,
      );
    }
    const seed = seedFor(user.id, date);
    const picked = ids
      .map((id) => ({ id, score: seededScore(id, seed) }))
      .sort((left, right) => left.score - right.score)
      .slice(0, Math.min(QUESTION_COUNT, ids.length))
      .map((item) => item.id);

    const created = createTestFromBank({
      userId: user.id,
      questionIds: picked,
      title: `تحدي اليوم — ${date}`,
      durationMinutes: 10,
    });
    const testId = created.test.id;
    run(
      `UPDATE tests
          SET challenge_date = ?, timed = 1, show_answers = 'after_finish'
        WHERE id = ? AND user_id = ?`,
      date,
      testId,
      user.id,
    );
    logActivity(user.id, 'challenge', 'تحدي اليوم', `${picked.length} أسئلة من بنك الأسئلة`);

    res.status(201).json({
      test: getTest(user.id, testId),
      reused: false,
      ...summaryFor(user.id, testId),
    });
  },
);
