import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const dataDir = process.env.VIDEO_TEST_DATA ?? '/tmp/nerd-video-test';
process.env.DATA_DIR = dataDir;
process.env.DATABASE_PATH = join(dataDir, 'nerd.db');
process.env.OCR_PROVIDER = 'tesseract';

const { all, db, get, run } = await import('../server/db.ts');
const { cancelContent, enqueueContent, processContent } = await import('../server/content-processing.ts');
const { shutdownOcr } = await import('../server/ocr.ts');
const { ensureBookDirectory } = await import('../server/storage.ts');

const video = join(
  process.cwd(),
  process.env.VIDEO_TEST_FILE ?? 'data/fixtures/video-test/long-text.mp4',
);
const minimumPages = Number(process.env.VIDEO_TEST_MIN_PAGES ?? 2);
const hash = createHash('sha256').update('video-pipeline-test').digest('hex');

const user = run(
  "INSERT INTO users (username, email, password_hash, role) VALUES ('videotester', 'video@test.local', 'x', 'student')",
);
const userId = user.lastInsertRowid;
const book = run(
  `INSERT INTO books (user_id, title, file_type, status, content_hash, is_content_source, content_source_type)
   VALUES (?, 'اختبار فيديو', 'video', 'pending', ?, 1, 'video')`,
  userId,
  hash,
);
const bookId = book.lastInsertRowid;
const content = run(
  "INSERT INTO study_contents (user_id, book_id, title, source_type, status, metadata_json) VALUES (?, ?, 'اختبار فيديو', 'video', 'pending', '{}')",
  userId,
  bookId,
);
const contentId = content.lastInsertRowid;

const directory = ensureBookDirectory(userId, bookId);
copyFileSync(video, join(directory, 'source.mp4'));
run('UPDATE books SET file_path = ? WHERE id = ?', join(directory, 'source.mp4'), bookId);

const progressTimer = setInterval(() => {
  const current = get<{ status: string; metadata_json: string }>(
    'SELECT status, metadata_json FROM study_contents WHERE id = ?',
    contentId,
  );
  console.log('PROGRESS', current?.status, current?.metadata_json?.slice(0, 260));
}, 10_000);
console.log('START initial');
await processContent(contentId, 'initial', null);
clearInterval(progressTimer);
console.log('END initial');
let row = get<{ status: string; pages_count: number; text_chars: number; metadata_json: string }>(
  'SELECT status, pages_count, text_chars, metadata_json FROM study_contents WHERE id = ?',
  contentId,
);
const pages = all<{
  page_number: number;
  text_content: string;
  source_kind: string;
  source_time_seconds: number;
  ocr_status: string;
}>(
  'SELECT page_number, text_content, source_kind, source_time_seconds, ocr_status FROM book_pages WHERE book_id = ? ORDER BY page_number',
  bookId,
);
const chunks = all<{ content: string }>('SELECT content FROM document_chunks WHERE book_id = ?', bookId);
console.log('FIRST', row);
console.log('PAGES', pages.map((page) => ({ n: page.page_number, t: page.source_time_seconds, text: page.text_content.slice(0, 60) })));
console.log('CHUNKS', chunks.length);
if (
  !row ||
  !['ready', 'needs_review'].includes(row.status) ||
  pages.length < minimumPages ||
  chunks.length === 0 ||
  pages.some((page) => page.ocr_status === 'empty')
) {
  process.exitCode = 1;
}
if (!row?.metadata_json.includes('"stage":"done"')) {
  console.error('progress did not finish');
  process.exitCode = 1;
}

// محاكاة فشل جزء واحد ثم استئنافه: يجب ألا تُحذف الصفحات الناجحة.
const failedPage = pages[Math.min(1, pages.length - 1)];
run("UPDATE book_pages SET text_content = '', ocr_status = 'failed' WHERE book_id = ? AND source_time_seconds = ?", bookId, failedPage.source_time_seconds);
console.log('START resume');
await processContent(contentId, 'resume', null);
console.log('END resume');
row = get<{ status: string; pages_count: number; text_chars: number; metadata_json: string }>(
  'SELECT status, pages_count, text_chars, metadata_json FROM study_contents WHERE id = ?',
  contentId,
);
const resumedPages = all<{
  page_number: number;
  text_content: string;
  source_kind: string;
  source_time_seconds: number;
  ocr_status: string;
}>(
  'SELECT page_number, text_content, source_kind, source_time_seconds, ocr_status FROM book_pages WHERE book_id = ? ORDER BY page_number',
  bookId,
);
console.log('RESUME', row);
console.log('RESUME_PAGES', resumedPages.map((page) => ({ n: page.page_number, t: page.source_time_seconds })));
if (resumedPages.length !== pages.length || resumedPages.some((page) => !page.text_content.trim())) {
  console.error('resume lost or failed to restore pages');
  process.exitCode = 1;
}

if (process.env.VIDEO_TEST_SKIP_CANCEL !== '1') {
  // اختبار الإلغاء أثناء المعالجة: يجب حفظ الحالة وإتاحة الاستئناف.
  const cancelBook = run(
    `INSERT INTO books (user_id, title, file_type, status, content_hash, is_content_source, content_source_type)
     VALUES (?, 'اختبار إلغاء', 'video', 'pending', ?, 1, 'video')`,
    userId,
    createHash('sha256').update('video-cancel-test').digest('hex'),
  );
  const cancelBookId = cancelBook.lastInsertRowid;
  const cancelContentRow = run(
    "INSERT INTO study_contents (user_id, book_id, title, source_type, status, metadata_json) VALUES (?, ?, 'اختبار إلغاء', 'video', 'pending', '{}')",
    userId,
    cancelBookId,
  );
  const cancelId = cancelContentRow.lastInsertRowid;
  const cancelDirectory = ensureBookDirectory(userId, cancelBookId);
  copyFileSync(video, join(cancelDirectory, 'source.mp4'));
  run('UPDATE books SET file_path = ? WHERE id = ?', join(cancelDirectory, 'source.mp4'), cancelBookId);
  enqueueContent(cancelId, 'initial', null);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = get<{ status: string }>('SELECT status FROM study_contents WHERE id = ?', cancelId);
    if (state?.status === 'extracting') break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const cancelAccepted = cancelContent(cancelId);
  let cancelledState = '';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = get<{ status: string; metadata_json: string }>(
      'SELECT status, metadata_json FROM study_contents WHERE id = ?',
      cancelId,
    );
    cancelledState = state?.status ?? '';
    if (cancelledState === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const cancelledRow = get<{ metadata_json: string; pages_count: number }>(
    'SELECT metadata_json, pages_count FROM study_contents WHERE id = ?',
    cancelId,
  );
  console.log('CANCEL', cancelAccepted, cancelledState, cancelledRow?.metadata_json?.slice(0, 220));
  if (!cancelAccepted || cancelledState !== 'failed' || !cancelledRow?.metadata_json.includes('"stage":"cancelled"')) {
    console.error('cancel did not persist resumable state');
    process.exitCode = 1;
  }

  enqueueContent(cancelId, 'resume', null);
  let afterCancelState = '';
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const state = get<{ status: string }>('SELECT status FROM study_contents WHERE id = ?', cancelId);
    afterCancelState = state?.status ?? '';
    if (['ready', 'needs_review', 'failed'].includes(afterCancelState)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const afterCancelRow = get<{ pages_count: number; chunks_count: number }>(
    `SELECT c.pages_count, (SELECT COUNT(*) FROM document_chunks dc WHERE dc.book_id = c.book_id) AS chunks_count
       FROM study_contents c WHERE c.id = ?`,
    cancelId,
  );
  console.log('RESUME_AFTER_CANCEL', afterCancelState, afterCancelRow);
  if (!['ready', 'needs_review'].includes(afterCancelState) || (afterCancelRow?.chunks_count ?? 0) === 0) {
    console.error('resume after cancel failed');
    process.exitCode = 1;
  }
}

await shutdownOcr();
rmSync(dataDir, { recursive: true, force: true });
db.close();
console.log('DONE');
