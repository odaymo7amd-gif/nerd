export type DetailLevel = 'short' | 'medium' | 'detailed';

export interface AiStatus {
  configured: boolean;
  provider: string;
  model: string;
  allowedModels: string[];
  baseUrlHost: string | null;
  keySource?: 'client' | 'server';
  routingMode?: 'client' | 'server';
  providers?: Array<{
    id: 'A' | 'B';
    label: string;
    configured: boolean;
    model: string | null;
    vision: boolean;
    baseUrlHost: string | null;
  }>;
  keysUrl?: string;
  dailyLimit: number;
  usedToday: number;
  remaining: number;
  costKnown: boolean;
  missing: string[];
  limits: { batchChars: number; maxBatches: number; maxPagesPerRequest: number };
}

export interface StudyKitFlashcard {
  id: string;
  front: string;
  back: string;
}

export interface StudyKitQuizQuestion {
  id: string;
  type: 'mcq' | 'true_false' | 'short';
  prompt: string;
  options: string[];
  answer: string | number | boolean;
  explanation: string;
}

export interface StudyKit {
  version: 1;
  generatedAt: string;
  overview: string;
  keyPoints: Array<{ title: string; body: string }>;
  definitions: Array<{ term: string; definition: string }>;
  comparisons: Array<{
    title: string;
    leftTitle: string;
    rightTitle: string;
    rows: Array<{ aspect: string; left: string; right: string }>;
  }>;
  equations: Array<{
    expression: string;
    meaning: string;
    symbols: Array<{ symbol: string; meaning: string; unit: string }>;
    example: string;
  }>;
  timeline: Array<{ label: string; detail: string }>;
  visual: {
    kind: 'causes' | 'sequence' | 'hierarchy' | 'compare' | 'concept';
    title: string;
    center: string;
    branches: Array<{
      title: string;
      detail: string;
      children: Array<{ title: string; detail: string }>;
    }>;
  } | null;
  flashcards: StudyKitFlashcard[];
  quiz: StudyKitQuizQuestion[];
}

export type SummaryCardStatus = 'known' | 'learning';

export interface SummaryReviewState {
  cards: Record<string, SummaryCardStatus>;
  quiz: Record<string, { correct: boolean; answer: string }>;
  updatedAt: string;
}

export interface SummaryListItem {
  id: number;
  title: string;
  bookId: number | null;
  contentId: number | null;
  contentVersion: number | null;
  bookTitle: string | null;
  kind: 'book' | 'topic' | string;
  detailLevel: DetailLevel | string;
  detailLevelLabel: string;
  rangeLabel: string | null;
  content: string;
  pages: number[];
  pagesCount: number;
  preview: string;
  studyKit: StudyKit | null;
  hasStudyKit: boolean;
  reviewState: SummaryReviewState;
  createdAt: string;
}

export interface Citation {
  bookId: number;
  bookTitle: string;
  contentId: number | null;
  contentTitle: string | null;
  pageFrom: number;
  pageTo: number;
}

export interface ChatMessageItem {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources: Citation[];
  tokensIn: number;
  tokensOut: number;
  createdAt: string;
}

export interface Conversation {
  id: number;
  title: string;
  bookId: number | null;
  contentId: number | null;
  contentTitle: string | null;
  bookTitle: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string | null;
}

export interface ChatAskResponse {
  conversation: Conversation;
  message: ChatMessageItem | null;
  sources: Citation[];
  usage: { tokensIn: number; tokensOut: number; remainingToday: number };
}

export interface TeacherLessonSection {
  id: string;
  title: string;
  content: string;
}

export interface TeacherLesson {
  lessonTitle: string;
  sections: TeacherLessonSection[];
  sourceTitle: string | null;
  sourceContentId: number | null;
}

export interface TeacherLessonResponse {
  lesson: TeacherLesson;
  sources: Citation[];
  usage: {
    requests: number;
    tokensIn: number;
    tokensOut: number;
    remainingToday: number;
  };
}

export type StudyToolMode = 'teacher' | 'solver' | 'grader' | 'expression' | 'english-grammar';
export type StudyToolLevel = 'brief' | 'standard' | 'deep';

export interface StudyToolResult {
  mode: StudyToolMode;
  label: string;
  title: string;
  content: string;
  model: string;
  provider: string;
  citations: Citation[];
  pages: number[];
  sourceUsed: boolean;
  remainingToday: number;
}

export interface SummaryResponse {
  summary: SummaryListItem;
  usage: {
    requests: number;
    tokensIn: number;
    tokensOut: number;
    costKnown: boolean;
    costUsd: number;
    remainingToday: number;
  };
}
