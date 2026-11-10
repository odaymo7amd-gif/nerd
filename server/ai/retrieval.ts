// استرجاع المقاطع من الكتب (RAG) دون أي مزوّد خارجي:
// بحث معجمي BM25 مع تطبيع عربي، والنتيجة تحمل دائمًا أرقام الصفحات.

import { all, get } from '../db.ts';
import { normalizeArabic } from '../chunking.ts';
import { HttpError } from '../http.ts';

export interface PageRange {
  from: number;
  to: number;
}

export interface ChunkRef {
  id: number;
  bookId: number;
  bookTitle: string;
  chunkIndex: number;
  content: string;
  pageFrom: number;
  pageTo: number;
}

export interface ScoredChunk extends ChunkRef {
  score: number;
}

const STOPWORDS = new Set([
  'من', 'الى', 'إلى', 'على', 'في', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'تلك', 'التي', 'الذي',
  'الذين', 'كان', 'كانت', 'يكون', 'هو', 'هي', 'هم', 'انه', 'أنه', 'ان', 'أن', 'إن', 'او', 'أو',
  'ثم', 'قد', 'ما', 'لا', 'لم', 'لن', 'كل', 'بعض', 'بين', 'حتى', 'عند', 'بعد', 'قبل', 'اي', 'أي',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'you', 'your', 'not',
]);

export function tokenize(text: string): string[] {
  return normalizeArabic(text)
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function ownershipGuard(userId: number, bookId: number): { id: number; title: string } {
  const book = get<{ id: number; title: string }>(
    'SELECT id, title FROM books WHERE id = ? AND user_id = ?',
    bookId,
    userId,
  );
  if (!book) throw new HttpError(404, 'الكتاب غير موجود.');
  return book;
}

export function chunksForBook(userId: number, bookId: number, range?: PageRange | null): ChunkRef[] {
  ownershipGuard(userId, bookId);
  const params: Array<number> = [bookId];
  let where = 'c.book_id = ?';
  if (range) {
    where += ' AND c.page_to >= ? AND c.page_from <= ?';
    params.push(range.from, range.to);
  }
  const rows = all<{
    id: number;
    book_id: number;
    book_title: string;
    chunk_index: number;
    content: string;
    page_from: number | null;
    page_to: number | null;
  }>(
    `SELECT c.id, c.book_id, b.title AS book_title, c.chunk_index, c.content, c.page_from, c.page_to
       FROM document_chunks c
       JOIN books b ON b.id = c.book_id
      WHERE ${where}
      ORDER BY c.chunk_index`,
    ...params,
  );
  return rows.map(toChunkRef);
}

function toChunkRef(row: {
  id: number;
  book_id: number;
  book_title: string;
  chunk_index: number;
  content: string;
  page_from: number | null;
  page_to: number | null;
}): ChunkRef {
  return {
    id: row.id,
    bookId: row.book_id,
    bookTitle: row.book_title,
    chunkIndex: row.chunk_index,
    content: row.content,
    pageFrom: row.page_from ?? row.page_to ?? 0,
    pageTo: row.page_to ?? row.page_from ?? 0,
  };
}

// مقاطع كل كتب الطالب الجاهزة — تُستخدم في المحادثة العامة
export function chunksForUser(userId: number, maxChunks = 4000): ChunkRef[] {
  const rows = all<{
    id: number;
    book_id: number;
    book_title: string;
    chunk_index: number;
    content: string;
    page_from: number | null;
    page_to: number | null;
  }>(
    `SELECT c.id, c.book_id, b.title AS book_title, c.chunk_index, c.content, c.page_from, c.page_to
       FROM document_chunks c
       JOIN books b ON b.id = c.book_id
      WHERE b.user_id = ? AND b.status = 'ready'
      ORDER BY c.book_id, c.chunk_index
      LIMIT ?`,
    userId,
    maxChunks,
  );
  return rows.map(toChunkRef);
}

// BM25: مفيد للنصوص العربية القصيرة بلا تضمينات، ويعمل بلا تكلفة ولا مزوّد.
export function scoreChunks(chunks: ChunkRef[], query: string, limit = 8): ScoredChunk[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || chunks.length === 0) return [];

  const docs = chunks.map((chunk) => {
    const terms = tokenize(chunk.content);
    const frequency = new Map<string, number>();
    for (const term of terms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
    return { chunk, terms, frequency, length: terms.length };
  });

  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc.terms)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const total = docs.length;
  const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(total, 1);
  const k1 = 1.2;
  const b = 0.75;
  const normalizedQuery = normalizeArabic(query).trim();

  const scored = docs.map((doc) => {
    let score = 0;
    for (const term of queryTerms) {
      const frequency = doc.frequency.get(term) ?? 0;
      if (frequency === 0) continue;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      const normalization = 1 - b + b * (doc.length / Math.max(averageLength, 1));
      score += idf * ((frequency * (k1 + 1)) / (frequency + k1 * normalization));
    }
    if (normalizedQuery.length > 3 && normalizeArabic(doc.chunk.content).includes(normalizedQuery)) {
      score += 2.5;
    }
    return { ...doc.chunk, score: Number(score.toFixed(4)) };
  });

  return scored
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.min(limit, 20));
}

export function retrieveChunks(
  userId: number,
  options: { bookId: number; query: string; range?: PageRange | null; limit?: number },
): ScoredChunk[] {
  return scoreChunks(chunksForBook(userId, options.bookId, options.range), options.query, options.limit ?? 8);
}

export function retrieveAcrossBooks(
  userId: number,
  query: string,
  limit = 6,
): ScoredChunk[] {
  return scoreChunks(chunksForUser(userId), query, limit);
}

export interface Citation {
  bookId: number;
  bookTitle: string;
  contentId: number | null;
  contentTitle: string | null;
  pageFrom: number;
  pageTo: number;
}

export function citationsOf(chunks: ChunkRef[]): Citation[] {
  const seen = new Map<string, Citation>();
  for (const chunk of chunks) {
    const key = `${chunk.bookId}:${chunk.pageFrom}-${chunk.pageTo}`;
    if (!seen.has(key)) {
      const content = get<{ id: number; title: string }>(
        'SELECT id, title FROM study_contents WHERE book_id = ?',
        chunk.bookId,
      );
      seen.set(key, {
        bookId: chunk.bookId,
        bookTitle: chunk.bookTitle,
        contentId: content?.id ?? null,
        contentTitle: content?.title ?? null,
        pageFrom: chunk.pageFrom,
        pageTo: chunk.pageTo,
      });
    }
  }
  return [...seen.values()];
}

export function groupByBatch(chunks: ChunkRef[], maxChars: number): ChunkRef[][] {
  const batches: ChunkRef[][] = [];
  let current: ChunkRef[] = [];
  let size = 0;
  for (const chunk of chunks) {
    const chunkSize = chunk.content.length + 24;
    if (current.length > 0 && size + chunkSize > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(chunk);
    size += chunkSize;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function pagesOf(chunks: ChunkRef[]): number[] {
  const pages = new Set<number>();
  for (const chunk of chunks) {
    for (let page = chunk.pageFrom; page <= chunk.pageTo; page += 1) {
      if (page > 0) pages.add(page);
    }
  }
  return [...pages].sort((left, right) => left - right);
}
