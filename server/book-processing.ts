// خط معالجة الكتب: استخراج النص → OCR للصور → تقطيع → حالة نهائية.
// يعمل في الخلفية داخل نفس عملية الخادم (طابور تسلسلي) حتى لا تتأثر الاستجابة للمستخدم،
// والحالة الحقيقية محفوظة في قاعدة البيانات فيمكن متابعتها من أي جهاز.

import { all, get, run } from './db.ts';
import { buildChunks, estimateTokens, normalizeArabic } from './chunking.ts';
import { extractPdfPages } from './pdf.ts';
import { ocrImage } from './ocr.ts';
import { bookDirectory } from './storage.ts';
import { createNotification, logActivity } from './auth.ts';
import { nowIso } from './db.ts';

interface BookRow {
  id: number;
  user_id: number;
  title: string;
  file_path: string | null;
  file_type: string | null;
  status: string;
  pages_count: number;
}

const queue: number[] = [];
let running = false;

export function enqueueBook(bookId: number): void {
  if (!queue.includes(bookId)) queue.push(bookId);
  void pump();
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const bookId = queue.shift();
      if (bookId === undefined) break;
      await processBook(bookId).catch((error) => {
        console.error(`[nerd/books] فشل غير متوقع في الكتاب ${bookId}:`, error);
      });
    }
  } finally {
    running = false;
  }
}

function setStatus(bookId: number, status: string, errorMessage: string | null = null): void {
  run('UPDATE books SET status = ?, error_message = ?, updated_at = ? WHERE id = ?', status, errorMessage, nowIso(), bookId);
}

function markPage(pageId: number, text: string, status: string, errorMessage: string | null = null): void {
  run(
    'UPDATE book_pages SET text_content = ?, ocr_status = ?, error_message = ? WHERE id = ?',
    text,
    status,
    errorMessage,
    pageId,
  );
}

export async function processBook(bookId: number): Promise<void> {
  const book = get<BookRow>(
    'SELECT id, user_id, title, file_path, file_type, status, pages_count FROM books WHERE id = ?',
    bookId,
  );
  if (!book) return;

  setStatus(bookId, 'extracting');

  try {
    if (book.file_type === 'pdf') {
      await processPdf(book);
    } else {
      await processImages(book);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'خطأ غير معروف أثناء المعالجة.';
    setStatus(bookId, 'failed', message);
    run(
      'INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)',
      book.user_id,
      'books',
      'فشلت معالجة كتاب',
      `تعذّرت معالجة «${book.title}». السبب: ${message}`,
    );
  }
}

async function processPdf(book: BookRow): Promise<void> {
  if (!book.file_path) throw new Error('ملف الكتاب غير موجود في التخزين.');

  const { pages, numPages } = await extractPdfPages(book.file_path);
  if (pages.length === 0) throw new Error('لم يحتوي الملف على صفحات قابلة للقراءة.');

  run('DELETE FROM book_pages WHERE book_id = ?', book.id);
  run('DELETE FROM document_chunks WHERE book_id = ?', book.id);

  let emptyPages = 0;
  for (const page of pages) {
    const text = page.text.trim();
    const hasText = text.replace(/\s/g, '').length >= 10;
    if (!hasText) emptyPages += 1;
    run(
      'INSERT INTO book_pages (book_id, page_number, text_content, ocr_status) VALUES (?, ?, ?, ?)',
      book.id,
      page.pageNumber,
      hasText ? text : '',
      hasText ? 'done' : 'empty',
    );
  }

  run('UPDATE books SET pages_count = ? WHERE id = ?', numPages, book.id);

  if (emptyPages === pages.length) {
    throw new Error(
      'هذا الملف لا يحتوي نصًا قابلًا للاستخراج (غالبًا PDF مصور). حوّل صفحاته إلى صور JPG/PNG ثم ارفعها ليعمل OCR عليها.',
    );
  }

  const chunkPages = all<{ page_number: number; text_content: string }>(
    "SELECT page_number, text_content FROM book_pages WHERE book_id = ? AND text_content <> '' ORDER BY page_number",
    book.id,
  ).map((row) => ({ pageNumber: row.page_number, text: row.text_content }));

  writeChunks(book.id, chunkPages);
  finishBook(book, emptyPages);
}

async function processImages(book: BookRow): Promise<void> {
  const pages = all<{ id: number; page_number: number; image_path: string | null }>(
    'SELECT id, page_number, image_path FROM book_pages WHERE book_id = ? ORDER BY page_number',
    book.id,
  );
  if (pages.length === 0) throw new Error('لا توجد صفحات مرفوعة لهذا الكتاب.');

  run('DELETE FROM document_chunks WHERE book_id = ?', book.id);

  let failedPages = 0;
  let lastError = '';
  const texts: Array<{ pageNumber: number; text: string }> = [];

  for (const page of pages) {
    if (!page.image_path) {
      markPage(page.id, '', 'failed', 'ملف الصفحة مفقود.');
      failedPages += 1;
      lastError = lastError || 'ملف الصفحة مفقود.';
      continue;
    }
    try {
      const text = (await ocrImage(page.image_path)).trim();
      if (text.replace(/\s/g, '').length === 0) {
        markPage(page.id, '', 'empty', 'لم يُعثر على نص واضح في الصورة.');
        continue;
      }
      markPage(page.id, text, 'done');
      texts.push({ pageNumber: page.page_number, text });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'فشل OCR غير معروف.';
      failedPages += 1;
      lastError = message;
      markPage(page.id, '', 'failed', message);
    }
  }

  run('UPDATE books SET pages_count = ? WHERE id = ?', pages.length, book.id);

  if (failedPages === pages.length) {
    throw new Error(`تعذّر استخراج النص من كل الصفحات. آخر خطأ: ${lastError}`);
  }

  writeChunks(book.id, texts.map((item) => ({ pageNumber: item.pageNumber, text: item.text })));
  finishBook(book, failedPages);
}

function writeChunks(bookId: number, pages: Array<{ pageNumber: number; text: string }>): void {
  run('DELETE FROM document_chunks WHERE book_id = ?', bookId);
  const chunks = buildChunks(pages);
  for (const chunk of chunks) {
    run(
      'INSERT INTO document_chunks (book_id, chunk_index, content, page_from, page_to, tokens, content_search) VALUES (?, ?, ?, ?, ?, ?, ?)',
      bookId,
      chunk.chunkIndex,
      chunk.content,
      chunk.pageFrom,
      chunk.pageTo,
      chunk.tokens || estimateTokens(chunk.content),
      normalizeArabic(chunk.content),
    );
  }
}

function finishBook(book: BookRow, failedOrEmptyPages: number): void {
  setStatus(book.id, 'ready');
  const chunksCount =
    get<{ count: number }>('SELECT COUNT(*) AS count FROM document_chunks WHERE book_id = ?', book.id)?.count ?? 0;

  logActivity(
    book.user_id,
    'books',
    `اكتملت معالجة «${book.title}»`,
    `${book.pages_count} صفحة، ${chunksCount} مقطع نصي`,
  );
  createNotification(
    book.user_id,
    'books',
    'اكتملت معالجة كتاب',
    `تمت معالجة «${book.title}» بنجاح${failedOrEmptyPages > 0 ? ` (${failedOrEmptyPages} صفحة تحتاج مراجعة)` : ''}.`,
  );
}

/** عند إعادة تشغيل الخادم: أي كتاب بقي في منتصف المعالجة يُعاد تشغيله. */
export function resumePendingBooks(): void {
  const stuck = all<{ id: number }>(
    "SELECT id FROM books WHERE status IN ('pending', 'extracting', 'uploading')",
  );
  for (const row of stuck) enqueueBook(row.id);
  if (stuck.length > 0) console.log(`[nerd/books] استئناف معالجة ${stuck.length} كتاب.`);
}

export function resetBook(bookId: number): void {
  run('DELETE FROM document_chunks WHERE book_id = ?', bookId);
  run("UPDATE book_pages SET ocr_status = 'pending', text_content = '', error_message = NULL WHERE book_id = ?", bookId);
  setStatus(bookId, 'pending');
}

export function bookStorageDirectory(userId: number, bookId: number): string {
  return bookDirectory(userId, bookId);
}
