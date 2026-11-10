export type QuestionType =
  | 'mcq'
  | 'true_false'
  | 'short'
  | 'fill_blank'
  | 'explain'
  | 'compare'
  | 'essay'
  | 'math';
// mixed قيمة قديمة محفوظة في اختبارات سابقة؛ الواجهة الجديدة تستخدم easy/medium/hard/advanced.
export type TestDifficulty = 'easy' | 'medium' | 'hard' | 'advanced' | 'mixed';

export interface TestOption {
  id: number;
  text: string;
}

export interface TestQuestion {
  id: number;
  type: string;
  typeLabel: string;
  difficulty: string;
  text: string;
  page: number | null;
  options: TestOption[];
}

export interface AttemptSummary {
  id: number;
  testId: number;
  status: 'in_progress' | 'finished' | 'abandoned';
  score: number | null;
  total: number;
  timeSpentSeconds: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface TestDetail {
  id: number;
  title: string;
  difficulty: string | null;
  bookId: number | null;
  contentId: number | null;
  contentVersion: number | null;
  bookTitle: string | null;
  questionsCount: number;
  durationMinutes: number | null;
  perQuestionSeconds: number | null;
  timed: boolean;
  showAnswers: 'after_finish' | 'after_each' | string;
  status: string;
  createdAt: string;
  questions: TestQuestion[];
  attempts: AttemptSummary[];
  activeAttempt: AttemptSummary | null;
}

export interface TestListItem {
  id: number;
  title: string;
  bookId: number | null;
  contentId: number | null;
  contentVersion: number | null;
  bookTitle: string | null;
  questionsCount: number;
  durationMinutes: number | null;
  timed: boolean;
  showAnswers: string;
  status: string;
  createdAt: string;
  attemptsCount: number;
  bestScore: number | null;
  lastAttemptAt: string | null;
}

export interface TestListResponse {
  tests: TestListItem[];
  stats: {
    testsCreated: number;
    testsCompleted: number;
    questionsAnswered: number;
    averageScore: number | null;
  };
}

export interface CreateTestResponse {
  test: TestDetail;
  warning: string | null;
  usage: {
    requests: number;
    tokensIn: number;
    tokensOut: number;
    costKnown: boolean;
    costUsd: number;
    remainingToday: number;
  };
}

export interface StartAttemptResponse {
  attempt: AttemptSummary;
  test: TestDetail;
  resumed: boolean;
}

export interface ResultQuestion {
  id: number;
  type: string;
  typeLabel: string;
  text: string;
  page: number | null;
  explanation: string | null;
  options: Array<TestOption & { isCorrect: boolean }>;
  correctAnswer: string | null;
  answerVariants: string[];
  selectedOptionId: number | null;
  answerText: string | null;
  isCorrect: boolean;
  answered: boolean;
}

export interface TestResultResponse {
  test: Pick<
    TestDetail,
    'id' | 'title' | 'bookId' | 'contentId' | 'bookTitle' | 'questionsCount' | 'durationMinutes' | 'difficulty'
  >;
  attempt: AttemptSummary;
  summary: {
    correctCount: number;
    wrongCount: number;
    unansweredCount: number;
    total: number;
    score: number;
    timedOut: boolean;
  };
  questions: ResultQuestion[];
}

export const TEXT_QUESTION_TYPES = new Set(['short', 'fill_blank', 'explain', 'compare', 'essay', 'math']);

export function isTextQuestion(type: string): boolean {
  return TEXT_QUESTION_TYPES.has(type);
}

export interface CheckAnswerResponse {
  isCorrect: boolean;
  correctAnswer: string | null;
  answerVariants: string[];
  explanation: string | null;
}

export const difficultyLabels: Record<TestDifficulty, string> = {
  easy: 'سهل',
  medium: 'متوسط',
  hard: 'صعب',
  advanced: 'قدرات عليا',
  mixed: 'متنوّع',
};

export const typeLabels: Record<QuestionType, string> = {
  mcq: 'اختيار من متعدد',
  true_false: 'صح أو خطأ',
  short: 'إجابة قصيرة',
  fill_blank: 'أكمل الفراغ',
  explain: 'علّل',
  compare: 'قارن',
  essay: 'سؤال مقالي',
  math: 'مسألة حسابية',
};

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0 دقيقة';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} ثانية`;
  if (rest === 0) return `${minutes} دقيقة`;
  return `${minutes}:${String(rest).padStart(2, '0')} دقيقة`;
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
