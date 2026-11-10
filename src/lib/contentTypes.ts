export type ContentSourceType = 'images' | 'video' | 'text' | 'pdf';
export type ContentStatus = 'draft' | 'pending' | 'extracting' | 'ready' | 'needs_review' | 'failed';

export interface ContentProcessing {
  stage: string;
  label: string;
  percent: number;
  current?: number;
  total?: number;
  framesProcessed?: number;
  framesTotal?: number;
  segmentsProcessed?: number;
  segmentsTotal?: number;
  durationSeconds?: number;
  updatedAt?: string;
}

export interface ContentListItem {
  id: number;
  title: string;
  sourceType: ContentSourceType;
  sourceTypeLabel: string;
  status: ContentStatus;
  errorMessage: string | null;
  pagesCount: number;
  durationSeconds: number | null;
  textChars: number;
  version: number;
  needsRefresh: boolean;
  staleResults: number;
  transcriptStatus: 'none' | 'pending' | 'done' | 'skipped' | 'failed';
  transcriptError: string | null;
  transcriptPreview: string | null;
  subjectId: number | null;
  subjectName: string | null;
  gradeLevelId: number | null;
  gradeName: string | null;
  sizeBytes: number;
  chunksCount: number;
  imagesCount: number;
  hasImages: boolean;
  thumbnailPage: number | null;
  thumbnailUrl: string | null;
  hasSourceFile: boolean;
  processing: ContentProcessing | null;
  counts: { summaries: number; tests: number; conversations: number };
  createdAt: string;
  updatedAt: string;
}

export interface ContentStats {
  total: number;
  ready: number;
  review: number;
  processing: number;
  images: number;
  video: number;
  text: number;
  pdf: number;
}

export interface ContentListResponse {
  contents: ContentListItem[];
  stats: ContentStats;
}

export interface ContentPage {
  id: number;
  pageNumber: number;
  status: string;
  errorMessage: string | null;
  confidence: number | null;
  sourceKind: string;
  sourceTimeSeconds: number | null;
  hasImage: boolean;
  imageUrl: string | null;
  chars: number;
  preview: string;
}

export interface ContentSummaryRef {
  id: number;
  title: string;
  detailLevel: string;
  contentVersion: number | null;
  stale: boolean;
  createdAt: string;
}

export interface ContentTestRef {
  id: number;
  title: string;
  questionsCount: number;
  contentVersion: number | null;
  stale: boolean;
  attemptsCount: number;
  bestScore: number | null;
  createdAt: string;
}

export interface ContentConversationRef {
  id: number;
  title: string;
  contentVersion: number | null;
  stale: boolean;
  messageCount: number;
  updatedAt: string;
}

export interface ContentDetailResponse {
  content: ContentListItem;
  pages: ContentPage[];
  summaries: ContentSummaryRef[];
  tests: ContentTestRef[];
  conversations: ContentConversationRef[];
}

export type ContentTask = 'exam' | 'summary' | 'teacher' | 'none';
