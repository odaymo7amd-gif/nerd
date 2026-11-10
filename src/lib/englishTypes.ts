export type EnglishQuestionType = 'mcq' | 'fill_blank' | 'error_correction';
export type EnglishQuestionMode = 'mcq' | 'mixed';
export type EnglishDifficulty = 'easy' | 'medium' | 'hard' | 'advanced';

export const englishDifficultyLabels: Record<EnglishDifficulty, string> = {
  easy: 'سهل',
  medium: 'متوسط',
  hard: 'صعب',
  advanced: 'قدرات عليا',
};

export const englishDifficultyHints: Record<EnglishDifficulty, string> = {
  easy: 'جمل قصيرة وتطبيق مباشر للقاعدة.',
  medium: 'سياقات متنوعة وخيارات أقرب قليلًا.',
  hard: 'تحليل وتفاصيل وحالات متشابهة.',
  advanced: 'استنتاج متعدد الخطوات على النمط الوزاري.',
};

export const englishQuestionModeLabels: Record<EnglishQuestionMode, string> = {
  mcq: 'ضع دائرة فقط',
  mixed: 'ضع دائرة + أكمل الفراغ',
};

export interface EnglishExplanation {
  rule: string;
  note: string | null;
  content: string;
  provider: string;
  model: string;
  remainingToday: number;
}

export interface EnglishQuestion {
  id: string;
  type: EnglishQuestionType;
  typeLabel: string;
  prompt: string;
  options: string[];
}

export interface EnglishTest {
  sessionId: string;
  rule: string;
  note: string | null;
  count: number;
  questionMode: EnglishQuestionMode;
  difficulty: EnglishDifficulty;
  questions: EnglishQuestion[];
  provider: string;
  model: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  remainingToday: number;
}

export interface EnglishReviewQuestion extends EnglishQuestion {
  answered: boolean;
  selectedIndex: number | null;
  answerText: string | null;
  correctIndex: number | null;
  correctAnswer: string;
  explanation: string;
  isCorrect: boolean;
}

export interface EnglishResult {
  sessionId: string;
  rule: string;
  note: string | null;
  questionMode: EnglishQuestionMode;
  difficulty: EnglishDifficulty;
  score: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  total: number;
  questions: EnglishReviewQuestion[];
}

export interface EnglishAnswerDraft {
  selectedIndex?: number;
  text?: string;
}
