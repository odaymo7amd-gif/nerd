// بنك الأسئلة: عرض الأسئلة المحفوظة من كل الاختبارات السابقة وتصفيتها، وحذفها،
// وبناء اختبار جديد من أسئلة مختارة دون إعادة توليدها بالذكاء الاصطناعي.
// الأسئلة ملك صاحبها وحده؛ كل استعلام مقيّد بـ user_id.

import { all, get, run } from './db.ts';
import { logActivity } from './auth.ts';
import { HttpError } from './http.ts';
import {
  DIFFICULTY_LABELS,
  QUESTION_TYPES,
  TYPE_LABELS,
  getTest,
  type QuestionType,
  type TestDifficulty,
} from './ai/tests.ts';

interface BankRow {
  id: number;
  book_id: number | null;
  book_title: string | null;
  type: QuestionType;
  difficulty: TestDifficulty;
  text: string;
  correct_answer: string | null;
  explanation: string | null;
  source_page: number | null;
  created_at: string;
  tests_count: number;
  attempts_count: number;
  best_score: number | null;
}

interface OptionRow {
  id: number;
  question_id: number;
  text: string;
  is_correct: number;
  sort_order: number;
}

export interface BankQuery {
  userId: number;
  search?: string | null;
  type?: QuestionType | null;
  difficulty?: TestDifficulty | null;
  bookId?: number | null;
  limit: number;
  offset: number;
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

function serialize(row: BankRow, options: OptionRow[]) {
  return {
    id: row.id,
    type: row.type,
    typeLabel: TYPE_LABELS[row.type] ?? row.type,
    difficulty: row.difficulty,
    difficultyLabel: DIFFICULTY_LABELS[row.difficulty] ?? row.difficulty,
    text: row.text,
    answer: row.correct_answer,
    explanation: row.explanation,
    page: row.source_page,
    bookId: row.book_id,
    bookTitle: row.book_title,
    createdAt: row.created_at,
    testsCount: row.tests_count,
    attemptsCount: row.attempts_count,
    bestScore: row.best_score,
    options: options.map((option) => ({ id: option.id, text: option.text, isCorrect: option.is_correct === 1 })),
  };
}

function whereFor(query: BankQuery): { sql: string; params: Array<string | number> } {
  const clauses: string[] = ['q.user_id = ?'];
  const params: Array<string | number> = [query.userId];
  const search = query.search?.trim();

  if (search) {
    clauses.push("(q.text LIKE '%' || ? || '%' OR COALESCE(q.explanation, '') LIKE '%' || ? || '%')");
    params.push(search, search);
  }
  if (query.type) {
    clauses.push('q.type = ?');
    params.push(query.type);
  }
  if (query.difficulty) {
    clauses.push('q.difficulty = ?');
    params.push(query.difficulty);
  }
  if (query.bookId) {
    clauses.push('q.book_id = ?');
    params.push(query.bookId);
  }
  return { sql: clauses.join(' AND '), params };
}

export function listBankQuestions(query: BankQuery) {
  const where = whereFor(query);
  const total = get<{ total: number }>(`SELECT COUNT(*) AS total FROM questions q WHERE ${where.sql}`, ...where.params);

  const rows = all<BankRow>(
    `SELECT q.id, q.book_id, b.title AS book_title, q.type, q.difficulty, q.text, q.correct_answer,
            q.explanation, q.source_page, q.created_at,
            (SELECT COUNT(*) FROM test_questions tq JOIN tests t ON t.id = tq.test_id
              WHERE tq.question_id = q.id AND t.user_id = q.user_id) AS tests_count,
            (SELECT COUNT(*) FROM test_questions tq
               JOIN test_attempts a ON a.test_id = tq.test_id AND a.user_id = q.user_id
              WHERE tq.question_id = q.id AND a.status = 'finished') AS attempts_count,
            (SELECT MAX(a.score) FROM test_questions tq
               JOIN test_attempts a ON a.test_id = tq.test_id AND a.user_id = q.user_id
              WHERE tq.question_id = q.id AND a.status = 'finished') AS best_score
       FROM questions q
       LEFT JOIN books b ON b.id = q.book_id
      WHERE ${where.sql}
      ORDER BY q.created_at DESC, q.id DESC
      LIMIT ? OFFSET ?`,
    ...where.params,
    query.limit,
    query.offset,
  );

  const options = optionsFor(rows.map((row) => row.id));

  return {
    questions: rows.map((row) => serialize(row, options.get(row.id) ?? [])),
    total: total?.total ?? 0,
    limit: query.limit,
    offset: query.offset,
  };
}

export function bankSummary(userId: number) {
  const totals = get<{
    total: number;
    mcq: number;
    true_false: number;
    short: number;
    books: number;
  }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN type = 'mcq' THEN 1 ELSE 0 END) AS mcq,
            SUM(CASE WHEN type = 'true_false' THEN 1 ELSE 0 END) AS true_false,
            SUM(CASE WHEN type = 'short' THEN 1 ELSE 0 END) AS short,
            COUNT(DISTINCT book_id) AS books
       FROM questions
      WHERE user_id = ?`,
    userId,
  );

  const byDifficulty = all<{ difficulty: string; count: number }>(
    'SELECT difficulty, COUNT(*) AS count FROM questions WHERE user_id = ? GROUP BY difficulty',
    userId,
  );

  return {
    total: totals?.total ?? 0,
    byType: {
      mcq: totals?.mcq ?? 0,
      true_false: totals?.true_false ?? 0,
      short: totals?.short ?? 0,
    },
    byDifficulty: Object.fromEntries(byDifficulty.map((row) => [row.difficulty, row.count])),
    books: totals?.books ?? 0,
  };
}

/** كتب صاحب البنك التي لها أسئلة، لاستخدامها في قائمة التصفية. */
export function bankBooks(userId: number) {
  return all<{ id: number; title: string; count: number }>(
    `SELECT b.id, b.title, COUNT(q.id) AS count
       FROM questions q
       JOIN books b ON b.id = q.book_id
      WHERE q.user_id = ? AND q.book_id IS NOT NULL
      GROUP BY b.id, b.title
      ORDER BY count DESC, b.title`,
    userId,
  );
}

export function bankMeta(userId: number) {
  return {
    summary: bankSummary(userId),
    books: bankBooks(userId),
    types: QUESTION_TYPES.map((type) => ({ value: type, label: TYPE_LABELS[type] })),
    difficulties: (Object.keys(DIFFICULTY_LABELS) as TestDifficulty[]).map((value) => ({
      value,
      label: DIFFICULTY_LABELS[value],
    })),
  };
}

export function deleteBankQuestion(userId: number, questionId: number) {
  const question = get<{ id: number }>('SELECT id FROM questions WHERE id = ? AND user_id = ?', questionId, userId);
  if (!question) throw new HttpError(404, 'هذا السؤال غير موجود في بنكك.');

  const used = get<{ tests: number }>(
    `SELECT COUNT(*) AS tests FROM test_questions tq
       JOIN tests t ON t.id = tq.test_id
      WHERE tq.question_id = ? AND t.user_id = ?`,
    questionId,
    userId,
  );
  if ((used?.tests ?? 0) > 0) {
    throw new HttpError(
      409,
      'هذا السؤال مستخدم داخل اختبار محفوظ. احذف الاختبار نفسه من صفحة الاختبارات أولًا، ثم يمكن حذف السؤال من البنك.',
    );
  }

  run('DELETE FROM questions WHERE id = ? AND user_id = ?', questionId, userId);
  return { ok: true };
}

export interface TestFromBankInput {
  userId: number;
  questionIds: number[];
  title?: string | null;
  durationMinutes?: number | null;
}

const MAX_BANK_TEST_QUESTIONS = 50;

export function createTestFromBank(input: TestFromBankInput) {
  const ids = [...new Set(input.questionIds)];
  if (ids.length === 0) throw new HttpError(422, 'اختر سؤالًا واحدًا على الأقل من البنك.');
  if (ids.length > MAX_BANK_TEST_QUESTIONS) {
    throw new HttpError(422, `الحد الأقصى للاختبار من البنك ${MAX_BANK_TEST_QUESTIONS} سؤالًا.`);
  }

  const placeholders = ids.map(() => '?').join(', ');
  const rows = all<{ id: number; book_id: number | null; type: QuestionType; text: string }>(
    `SELECT id, book_id, type, text FROM questions
      WHERE user_id = ? AND id IN (${placeholders})
      ORDER BY created_at, id`,
    input.userId,
    ...ids,
  );

  if (rows.length !== ids.length) {
    throw new HttpError(422, 'بعض الأسئلة المختارة غير موجودة في بنكك. أعد تحميل الصفحة وحاول مرة أخرى.');
  }

  const bookIds = new Set(rows.map((row) => row.book_id).filter((value): value is number => value != null));
  const bookId = bookIds.size === 1 ? [...bookIds][0] : null;
  const book = bookId ? get<{ title: string }>('SELECT title FROM books WHERE id = ? AND user_id = ?', bookId, input.userId) : undefined;

  const durationMinutes =
    input.durationMinutes ?? Math.max(3, Math.ceil((rows.length * 75) / 60));
  const perQuestion = Math.round((durationMinutes * 60) / rows.length);
  const title = (input.title?.trim() || (book ? `${book.title} — من بنك الأسئلة` : 'اختبار من بنك الأسئلة')).slice(0, 150);

  const created = run(
    `INSERT INTO tests (user_id, book_id, title, questions_count, duration_minutes, per_question_seconds, status)
     VALUES (?, ?, ?, ?, ?, ?, 'ready')`,
    input.userId,
    bookId,
    title,
    rows.length,
    durationMinutes,
    perQuestion,
  );

  const testId = created.lastInsertRowid;
  rows.forEach((row, index) => {
    run('INSERT INTO test_questions (test_id, question_id, sort_order) VALUES (?, ?, ?)', testId, row.id, index);
  });

  logActivity(
    input.userId,
    'test',
    `اختبار «${title}»`,
    `${rows.length} سؤالًا من بنك الأسئلة`,
  );

  return { test: getTest(input.userId, testId) };
}
