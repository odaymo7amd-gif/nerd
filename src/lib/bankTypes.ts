export interface BankOption {
  id: number;
  text: string;
  isCorrect: boolean;
}

export interface BankQuestion {
  id: number;
  type: 'mcq' | 'true_false' | 'short';
  typeLabel: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'advanced' | 'mixed';
  difficultyLabel: string;
  text: string;
  answer: string | null;
  explanation: string | null;
  page: number | null;
  bookId: number | null;
  bookTitle: string | null;
  createdAt: string;
  testsCount: number;
  attemptsCount: number;
  bestScore: number | null;
  options: BankOption[];
}

export interface BankSummary {
  total: number;
  byType: { mcq: number; true_false: number; short: number };
  byDifficulty: Record<string, number>;
  books: number;
}

export interface BankResponse {
  questions: BankQuestion[];
  total: number;
  limit: number;
  offset: number;
  summary: BankSummary;
  books: Array<{ id: number; title: string; count: number }>;
  types: Array<{ value: string; label: string }>;
  difficulties: Array<{ value: string; label: string }>;
}

export interface BankTestResponse {
  test: {
    id: number;
    title: string;
    questionsCount: number;
    durationMinutes: number | null;
  };
}
