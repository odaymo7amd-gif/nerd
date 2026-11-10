export interface Book {
  id: number;
  title: string;
  unitName: string | null;
  status: 'uploading' | 'pending' | 'extracting' | 'ready' | 'failed';
  errorMessage: string | null;
  pagesCount: number;
  processedPages: number;
  chunksCount: number;
  sizeBytes: number;
  fileType: 'pdf' | 'images' | null;
  hasImages: boolean;
  subjectName: string | null;
  gradeName: string | null;
  semesterName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookPageSummary {
  pageNumber: number;
  status: 'pending' | 'done' | 'empty' | 'failed';
  errorMessage: string | null;
  hasImage: boolean;
  chars: number;
  preview: string;
}

export interface BookDetail {
  book: Book;
  pages: BookPageSummary[];
}

export interface BookSearchResult {
  pageFrom: number;
  pageTo: number;
  snippet: string;
}
