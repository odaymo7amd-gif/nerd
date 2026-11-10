// معالجة «المحتوى الدراسي» في الخلفية: صور، فيديو، نص، أو PDF.
//
// المحتوى يملك كتابًا مخفيًا داخليًا يحمل الصفحات والمقاطع النصية، فتستفيد منه
// أدوات التلخيص والاختبارات والمحادثة الموجودة دون تكرار المحرك. لا تُحفظ مفاتيح
// الذكاء الاصطناعي: مفتاح الرؤية/التفريغ يبقى في الذاكرة أثناء المعالجة فقط.

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { all, get, nowIso, run } from './db.ts';
import { buildChunks, estimateTokens, normalizeArabic } from './chunking.ts';
import { ocrPrepared, prepareImage } from './ocr.ts';
import { createNotification, logActivity } from './auth.ts';
import { bookDirectory } from './storage.ts';
import { visionAvailable, visionExtractText, transcribeAudio } from './ai/vision.ts';
import { recordUsage } from './ai/usage.ts';
import { readAiConfig } from './ai/config.ts';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static') as string | null;
const ffprobePath = (require('ffprobe-static') as { path: string }).path;
const execFileAsync = promisify(execFile);

// صفر = بلا حد عملي. يمكن لمدير الخادم ضبط حد أعلى عند الحاجة، لكن الافتراضي
// لا يمنع فيديو طويلًا بسبب عدد الدقائق كما كان سابقًا.
const MAX_VIDEO_SECONDS = Number(process.env.MAX_VIDEO_SECONDS ?? 0);
const MAX_VIDEO_FRAMES = Number(process.env.MAX_VIDEO_FRAMES ?? 0);
const VIDEO_FRAME_INTERVAL_SECONDS = Math.max(1, Number(process.env.VIDEO_FRAME_INTERVAL_SECONDS ?? 8));
const VIDEO_SEGMENT_SECONDS = Math.max(30, Number(process.env.VIDEO_SEGMENT_SECONDS ?? 180));
const VIDEO_TRANSCRIBE_CHUNK_SECONDS = Math.max(
  120,
  Number(process.env.VIDEO_TRANSCRIBE_CHUNK_SECONDS ?? 600),
);
const RECENT_TEXT_LIMIT = 10;

export type ContentSourceType = 'images' | 'video' | 'text' | 'pdf';
export type ContentMode = 'initial' | 'append' | 'failed' | 'full' | 'resume';

interface ContentRow {
  id: number;
  user_id: number;
  book_id: number;
  title: string;
  source_type: ContentSourceType;
  status: string;
  version: number;
  metadata_json: string | null;
  transcript_text: string | null;
  transcript_status: string;
  transcript_error: string | null;
}

interface PageRow {
  id: number;
  page_number: number;
  text_content: string | null;
  image_path: string | null;
  ocr_status: string;
  error_message: string | null;
  source_kind: string;
}

interface Job {
  mode: ContentMode;
  apiKey: string | null;
}

const queue: number[] = [];
const jobs = new Map<number, Job>();
const cancelRequests = new Set<number>();
let running = false;
let activeContentId: number | null = null;

class ContentCancelledError extends Error {
  constructor() {
    super('أُلغيت معالجة المحتوى بطلب من المستخدم.');
    this.name = 'ContentCancelledError';
  }
}

function assertNotCancelled(contentId: number): void {
  if (cancelRequests.has(contentId)) throw new ContentCancelledError();
}

function contentRow(contentId: number): ContentRow | undefined {
  return get<ContentRow>(
    'SELECT id, user_id, book_id, title, source_type, status, version, metadata_json, transcript_text, transcript_status, transcript_error FROM study_contents WHERE id = ?',
    contentId,
  );
}

export function enqueueContent(contentId: number, mode: ContentMode, apiKey?: string | null): void {
  cancelRequests.delete(contentId);
  const previous = jobs.get(contentId);
  const nextMode =
    previous && previous.mode === 'full' && mode !== 'full' ? 'full' : mode;
  jobs.set(contentId, { mode: nextMode, apiKey: apiKey?.trim() || previous?.apiKey || null });
  if (!queue.includes(contentId)) queue.push(contentId);
  void pump();
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const contentId = queue.shift();
      if (contentId === undefined) break;
      const job = jobs.get(contentId) ?? { mode: 'initial' as ContentMode, apiKey: null };
      jobs.delete(contentId);
      activeContentId = contentId;
      try {
        await processContent(contentId, job.mode, job.apiKey);
      } catch (error) {
        if (error instanceof ContentCancelledError) {
          markCancelled(contentId);
        } else {
          console.error(`[nerd/content] فشل غير متوقع في المحتوى ${contentId}:`, error);
          failContent(contentId, 'تعذّرت معالجة المحتوى بسبب خطأ غير متوقع.');
        }
      } finally {
        activeContentId = null;
      }
    }
  } finally {
    running = false;
  }
}

function setContentStatus(contentId: number, status: string, error: string | null): void {
  run(
    'UPDATE study_contents SET status = ?, error_message = ?, updated_at = ? WHERE id = ?',
    status,
    error,
    nowIso(),
    contentId,
  );
}

function setBookStatus(bookId: number, status: string, error: string | null, pages: number): void {
  run(
    'UPDATE books SET status = ?, error_message = ?, pages_count = ?, updated_at = ? WHERE id = ?',
    status,
    error,
    pages,
    nowIso(),
    bookId,
  );
}

function pageCount(bookId: number): number {
  return get<{ count: number }>('SELECT COUNT(*) AS count FROM book_pages WHERE book_id = ?', bookId)?.count ?? 0;
}

function refreshContentStats(contentId: number, bookId: number): void {
  const stats = get<{ pages: number; chars: number }>(
    `SELECT COUNT(*) AS pages,
            COALESCE(SUM(LENGTH(REPLACE(text_content, ' ', ''))), 0) AS chars
       FROM book_pages WHERE book_id = ?`,
    bookId,
  );
  run(
    'UPDATE study_contents SET pages_count = ?, text_chars = ? WHERE id = ?',
    stats?.pages ?? 0,
    stats?.chars ?? 0,
    contentId,
  );
}

function failContent(contentId: number, message: string): void {
  const content = contentRow(contentId);
  if (!content) return;
  const meta = parseMeta(content.metadata_json);
  const previous = meta.processing && typeof meta.processing === 'object'
    ? (meta.processing as Record<string, unknown>)
    : {};
  meta.processing = {
    ...previous,
    stage: 'failed',
    label: message,
    percent: Number(previous.percent ?? 0),
    updatedAt: nowIso(),
  };
  saveMeta(contentId, meta);
  setContentStatus(contentId, 'failed', message);
  setBookStatus(content.book_id, 'failed', message, pageCount(content.book_id));
  refreshContentStats(contentId, content.book_id);
  createNotification(
    content.user_id,
    'content',
    'تعذّرت معالجة المحتوى',
    `«${content.title}»: ${message}`,
  );
}

function markCancelled(contentId: number): void {
  const content = contentRow(contentId);
  if (!content) return;
  const meta = parseMeta(content.metadata_json);
  meta.cancelled = true;
  const previous = meta.processing && typeof meta.processing === 'object'
    ? (meta.processing as Record<string, unknown>)
    : {};
  meta.processing = {
    ...previous,
    stage: 'cancelled',
    label: 'أُلغيت المعالجة. النص المستخرج حتى الآن محفوظ ويمكن استئناف المعالجة.',
    updatedAt: nowIso(),
  };
  saveMeta(contentId, meta);
  const message =
    'أُلغيت معالجة المحتوى. النص المستخرج حتى الآن محفوظ، ويمكنك استئناف المعالجة من حيث توقفت.';
  setContentStatus(contentId, 'failed', message);
  setBookStatus(content.book_id, 'failed', message, pageCount(content.book_id));
  refreshContentStats(contentId, content.book_id);
}

/** إلغاء طلب في الانتظار أو إشارة إلغاء لمعالجة جارية بين الإطارات/المقاطع. */
export function cancelContent(contentId: number): boolean {
  const content = contentRow(contentId);
  if (!content) return false;
  if (!['pending', 'extracting'].includes(content.status) && activeContentId !== contentId) return false;
  cancelRequests.add(contentId);
  const queued = queue.indexOf(contentId);
  if (queued >= 0) {
    queue.splice(queued, 1);
    jobs.delete(contentId);
    markCancelled(contentId);
    return true;
  }
  return activeContentId === contentId;
}

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function saveMeta(contentId: number, meta: Record<string, unknown>): void {
  run('UPDATE study_contents SET metadata_json = ? WHERE id = ?', JSON.stringify(meta), contentId);
}

interface ProcessingProgress {
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

function setProgress(
  contentId: number,
  meta: Record<string, unknown>,
  progress: ProcessingProgress,
): void {
  meta.processing = {
    ...progress,
    percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
    updatedAt: nowIso(),
  };
  meta.cancelled = false;
  saveMeta(contentId, meta);
}

async function pageOcr(
  content: ContentRow,
  page: PageRow,
  apiKey: string | null,
  meta: Record<string, unknown>,
): Promise<{ text: string; status: string; confidence: number; error: string | null }> {
  if (!page.image_path || !existsSync(page.image_path)) {
    return { text: '', status: 'failed', confidence: 0, error: 'ملف الصفحة مفقود.' };
  }

  let prepared;
  try {
    prepared = await prepareImage(page.image_path);
  } catch (error) {
    return {
      text: '',
      status: 'failed',
      confidence: 0,
      error: error instanceof Error ? error.message : 'تعذّر تجهيز الصورة.',
    };
  }

  if (prepared.blurred) {
    meta.blurryPages = Number(meta.blurryPages ?? 0) + 1;
  }

  let text = '';
  let confidence = 0;
  let source = 'ocr';

  if (visionAvailable() && apiKey) {
    try {
      const vision = await visionExtractText({ apiKey, prepared });
      text = vision.text;
      confidence = 98;
      source = 'vision';
      meta.visionPages = Number(meta.visionPages ?? 0) + 1;
      meta.visionModel = vision.model;
      recordUsage({
        userId: content.user_id,
        task: 'vision-ocr',
        model: vision.model,
        provider: readAiConfig().provider,
        tokensIn: vision.tokensIn,
        tokensOut: vision.tokensOut,
        status: 'success',
      });
    } catch (error) {
      meta.visionFallbacks = Number(meta.visionFallbacks ?? 0) + 1;
      meta.lastVisionError = error instanceof Error ? error.message : 'فشل نموذج الرؤية.';
    }
  }

  if (!text.trim() || text.includes('[صورة غير مقروءة]')) {
    const result = await ocrPrepared(prepared);
    text = result.text;
    confidence = result.confidence;
    source = 'ocr';
    if (result.blurred && !prepared.blurred) meta.blurryPages = Number(meta.blurryPages ?? 0) + 1;
  }

  const clean = text.trim();
  const chars = clean.replace(/\s/g, '').length;
  if (chars < 10) {
    return {
      text: '',
      status: 'empty',
      confidence,
      error: 'لم يُعثر على نص واضح. صوّر الصفحة بإضاءة أفضل وبشكل مستقيم.',
    };
  }

  const weak = source === 'ocr' && (confidence < 45 || prepared.blurred);
  if (weak) meta.lowQualityPages = Number(meta.lowQualityPages ?? 0) + 1;

  return {
    text: clean,
    status: weak ? 'needs_review' : 'done',
    confidence,
    error: weak ? 'النص مقروء جزئيًا؛ راجع الصورة أو أعد تصويرها إن كان النص ناقصًا.' : null,
  };
}

function markPage(
  pageId: number,
  text: string,
  status: string,
  confidence: number,
  error: string | null,
): void {
  run(
    'UPDATE book_pages SET text_content = ?, ocr_status = ?, confidence = ?, error_message = ? WHERE id = ?',
    text,
    status,
    confidence || null,
    error,
    pageId,
  );
}

async function processImagePages(
  content: ContentRow,
  apiKey: string | null,
  mode: ContentMode,
  meta: Record<string, unknown>,
): Promise<void> {
  const pages = all<PageRow>(
    "SELECT id, page_number, text_content, image_path, ocr_status, error_message, source_kind FROM book_pages WHERE book_id = ? AND image_path IS NOT NULL AND source_kind IN ('image', 'video_frame') ORDER BY page_number",
    content.book_id,
  );
  if (pages.length === 0) throw new Error('لا توجد صفحات في هذا المحتوى.');

  for (const page of pages) {
    if (mode === 'append' && page.ocr_status !== 'pending') continue;
    if (mode === 'failed' && !['failed', 'empty', 'needs_review'].includes(page.ocr_status)) continue;
    if (mode === 'resume' && !['pending', 'failed'].includes(page.ocr_status)) continue;
    try {
      const result = await pageOcr(content, page, apiKey, meta);
      markPage(page.id, result.text, result.status, result.confidence, result.error);
    } catch (error) {
      markPage(
        page.id,
        '',
        'failed',
        0,
        error instanceof Error ? error.message : 'تعذّرت قراءة الصورة.',
      );
    }
    saveMeta(content.id, meta);
  }
}

async function renumberPages(bookId: number): Promise<void> {
  const rows = all<{ id: number }>(
    'SELECT id FROM book_pages WHERE book_id = ? ORDER BY page_number, id',
    bookId,
  );
  run('UPDATE book_pages SET page_number = page_number + 100000 WHERE book_id = ?', bookId);
  rows.forEach((row, index) => {
    run('UPDATE book_pages SET page_number = ? WHERE id = ?', index + 1, row.id);
  });
}

async function processPdf(content: ContentRow): Promise<number> {
  const book = get<{ file_path: string | null }>('SELECT file_path FROM books WHERE id = ?', content.book_id);
  if (!book?.file_path || !existsSync(book.file_path)) throw new Error('ملف PDF غير موجود.');
  const { extractPdfPages } = await import('./pdf.ts');
  const { pages, numPages } = await extractPdfPages(book.file_path);
  if (pages.length === 0) throw new Error('لم يحتوي الملف على صفحات.');

  const addedImages = all<PageRow>(
    "SELECT id, page_number, text_content, image_path, ocr_status, error_message, source_kind FROM book_pages WHERE book_id = ? AND source_kind = 'image' ORDER BY page_number",
    content.book_id,
  );
  run('DELETE FROM book_pages WHERE book_id = ? AND source_kind <> \'image\'', content.book_id);
  run('UPDATE book_pages SET page_number = page_number + 100000 WHERE book_id = ?', content.book_id);

  let empty = 0;
  for (const page of pages) {
    const text = page.text.trim();
    const hasText = text.replace(/\s/g, '').length >= 10;
    if (!hasText) empty += 1;
    run(
      'INSERT INTO book_pages (book_id, page_number, text_content, ocr_status, source_kind) VALUES (?, ?, ?, ?, ?)',
      content.book_id,
      page.pageNumber,
      hasText ? text : '',
      hasText ? 'done' : 'empty',
      'pdf',
    );
  }
  let next = numPages;
  for (const page of addedImages) {
    next += 1;
    run('UPDATE book_pages SET page_number = ? WHERE id = ?', next, page.id);
  }
  if (empty === pages.length) {
    throw new Error('هذا PDF لا يحتوي نصًا قابلًا للاستخراج (غالبًا صفحات مصوّرة). ارفع صفحاته كصور ليعمل OCR عليها.');
  }
  return next;
}

async function processText(content: ContentRow, text: string): Promise<number> {
  const clean = text.trim();
  if (clean.replace(/\s/g, '').length < 20) {
    throw new Error('النص قصير جدًا. اكتب فقرة دراسية واحدة على الأقل (20 حرفًا).');
  }
  const addedImages = all<PageRow>(
    "SELECT id, page_number, text_content, image_path, ocr_status, error_message, source_kind FROM book_pages WHERE book_id = ? AND source_kind = 'image' ORDER BY page_number",
    content.book_id,
  );
  run("DELETE FROM book_pages WHERE book_id = ? AND source_kind <> 'image'", content.book_id);
  run('UPDATE book_pages SET page_number = page_number + 100000 WHERE book_id = ?', content.book_id);
  run(
    'INSERT INTO book_pages (book_id, page_number, text_content, ocr_status, source_kind) VALUES (?, 1, ?, ?, ?)',
    content.book_id,
    clean,
    'done',
    'text',
  );
  let next = 1;
  for (const image of addedImages) {
    next += 1;
    run('UPDATE book_pages SET page_number = ? WHERE id = ?', next, image.id);
  }
  return next;
}

function ffmpegBinary(): string {
  if (!ffmpegPath || !existsSync(ffmpegPath)) {
    throw new Error('محرك الفيديو غير متاح على الخادم. أعد تثبيت الحزم أو ارفع صور الصفحات.');
  }
  return ffmpegPath;
}

async function probeVideo(path: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path],
      { timeout: 30_000 },
    );
    const duration = Number(String(stdout).trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('مدة غير معروفة');
    return duration;
  } catch {
    throw new Error('تعذّر قراءة الفيديو. تأكد أن الملف صالح بصيغة MP4 أو MOV أو WEBM.');
  }
}

async function averageHash(path: string): Promise<bigint> {
  const raw = await sharp(path)
    .resize(8, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();
  let sum = 0;
  for (const value of raw) sum += value;
  const average = sum / raw.length;
  let hash = 0n;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash << 1n) | (raw[index] >= average ? 1n : 0n);
  }
  return hash;
}

function hamming(left: bigint, right: bigint): number {
  let value = left ^ right;
  let count = 0;
  while (value > 0n) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

interface VideoFrame {
  path: string;
  seconds: number;
}

async function extractSegmentFrames(
  videoPath: string,
  framesDir: string,
  segmentIndex: number,
  start: number,
  length: number,
  interval: number,
): Promise<{ directory: string; frames: VideoFrame[] }> {
  const segmentDirectory = join(framesDir, `segment-${String(segmentIndex).padStart(4, '0')}`);
  await rm(segmentDirectory, { recursive: true, force: true });
  await mkdir(segmentDirectory, { recursive: true });
  const pattern = join(segmentDirectory, 'frame-%05d.jpg');
  try {
    await execFileAsync(
      ffmpegBinary(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        start.toFixed(3),
        '-i',
        videoPath,
        '-t',
        Math.max(0.1, length).toFixed(3),
        '-vf',
        `fps=1/${interval.toFixed(3)},scale='min(1600,iw)':-2`,
        '-q:v',
        '3',
        pattern,
      ],
      { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (error) {
    if (error instanceof Error && /no such file|not found/i.test(error.message)) {
      throw new Error('محرك الفيديو غير متاح على الخادم.');
    }
    throw new Error('تعذّر استخراج إطارات من مقطع الفيديو. تأكد أن الملف سليم ثم أعد المحاولة.');
  }

  const files = (await readdir(segmentDirectory)).filter((name) => name.endsWith('.jpg')).sort();
  return {
    directory: segmentDirectory,
    frames: files.map((name, index) => ({
      path: join(segmentDirectory, name),
      seconds: start + index * interval,
    })),
  };
}

function videoTextKey(text: string): string {
  return normalizeArabic(text).replace(/[^\p{L}\p{N}]+/gu, '');
}

function videoWords(text: string): string[] {
  return normalizeArabic(text)
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.trim())
    .filter(Boolean);
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/**
 * إزالة تكرار حذرة: تمنع إطارًا مطابقًا أو شبه مطابق تمامًا، لكنها لا تحذف
 * نصًا مختلفًا أو إطارًا أضاف سطرًا جديدًا لمجرد تشابهه مع سابقه.
 */
function isDuplicateVideoText(
  text: string,
  keys: Set<string>,
  recent: string[][],
): boolean {
  const key = videoTextKey(text);
  if (!key) return true;
  if (keys.has(key)) return true;
  const words = videoWords(text);
  if (words.length >= 4) {
    for (const previous of recent) {
      const lengthRatio = words.length / Math.max(1, previous.length);
      if (lengthRatio < 0.9 || lengthRatio > 1.1) continue;
      // عتبة عالية جدًا: لا نعتبر النص مكررًا إذا تغيّرت كلمة مهمة، حتى لو كان
      // الشكل العام مشابهًا. تكرار OCR شبه التام فقط هو ما يُسقط.
      if (jaccard(words, previous) >= 0.99) return true;
    }
  }
  keys.add(key);
  recent.push(words);
  if (recent.length > RECENT_TEXT_LIMIT) recent.shift();
  return false;
}

async function extractAudioSegment(
  videoPath: string,
  directory: string,
  index: number,
  start: number,
  length: number,
): Promise<string | null> {
  const audioPath = join(directory, `audio-part-${String(index).padStart(4, '0')}.mp3`);
  try {
    await execFileAsync(
      ffmpegBinary(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        start.toFixed(3),
        '-i',
        videoPath,
        '-t',
        Math.max(0.1, length).toFixed(3),
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-b:a',
        '32k',
        audioPath,
      ],
      { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 },
    );
    const info = await stat(audioPath).catch(() => null);
    if (!info || info.size < 1_000) {
      await rm(audioPath, { force: true });
      return null;
    }
    return audioPath;
  } catch {
    await rm(audioPath, { force: true }).catch(() => undefined);
    return null;
  }
}

async function renumberVideoPages(bookId: number): Promise<void> {
  const rows = all<{ id: number }>(
    `SELECT id FROM book_pages
      WHERE book_id = ?
      ORDER BY CASE WHEN source_kind IN ('video_frame', 'transcript') THEN 0 ELSE 1 END,
               COALESCE(source_time_seconds, 999999999),
               page_number,
               id`,
    bookId,
  );
  if (rows.length === 0) return;
  run('UPDATE book_pages SET page_number = page_number + 100000 WHERE book_id = ?', bookId);
  rows.forEach((row, index) => {
    run('UPDATE book_pages SET page_number = ? WHERE id = ?', index + 1, row.id);
  });
}

async function processVideo(
  content: ContentRow,
  apiKey: string | null,
  meta: Record<string, unknown>,
  mode: ContentMode,
): Promise<number> {
  const book = get<{ file_path: string | null }>('SELECT file_path FROM books WHERE id = ?', content.book_id);
  if (!book?.file_path || !existsSync(book.file_path)) throw new Error('ملف الفيديو غير موجود.');

  const duration = await probeVideo(book.file_path);
  if (MAX_VIDEO_SECONDS > 0 && duration > MAX_VIDEO_SECONDS) {
    throw new Error(
      `مدة الفيديو ${Math.round(duration / 60)} دقيقة، والحد المضبوط في الخادم ${Math.round(MAX_VIDEO_SECONDS / 60)} دقيقة. يمكن للمشرف رفع MAX_VIDEO_SECONDS، أو ارفع صورًا للصفحات.`,
    );
  }
  run('UPDATE study_contents SET duration_seconds = ? WHERE id = ?', Math.round(duration), content.id);

  const directory = bookDirectory(content.user_id, content.book_id);
  const framesDir = join(directory, 'video-frames');
  await mkdir(framesDir, { recursive: true });

  if (mode === 'full') {
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });
    run("DELETE FROM book_pages WHERE book_id = ? AND source_kind IN ('video_frame', 'transcript')", content.book_id);
  }

  // الإطارات الفارغة القديمة لا تُعرض كصفحات تحتاج مراجعة.
  const emptyFrames = all<{ id: number; image_path: string | null }>(
    "SELECT id, image_path FROM book_pages WHERE book_id = ? AND source_kind = 'video_frame' AND ocr_status = 'empty'",
    content.book_id,
  );
  for (const page of emptyFrames) {
    if (page.image_path) await rm(page.image_path, { force: true }).catch(() => undefined);
  }
  run("DELETE FROM book_pages WHERE book_id = ? AND source_kind = 'video_frame' AND ocr_status = 'empty'", content.book_id);

  const existing = all<PageRow & { source_time_seconds: number | null }>(
    `SELECT id, page_number, text_content, image_path, ocr_status, error_message, source_kind, source_time_seconds
       FROM book_pages
      WHERE book_id = ? AND source_kind IN ('video_frame', 'transcript')
      ORDER BY COALESCE(source_time_seconds, 0), page_number`,
    content.book_id,
  );
  const existingByTime = new Map<number, PageRow & { source_time_seconds: number | null }>();
  const textKeys = new Set<string>();
  const recentTexts: string[][] = [];
  for (const row of existing) {
    if (row.source_kind === 'video_frame') {
      existingByTime.set(Math.round(Number(row.source_time_seconds ?? 0)), row);
      if (row.text_content?.trim() && ['done', 'needs_review'].includes(row.ocr_status)) {
        const key = videoTextKey(row.text_content);
        if (key) textKeys.add(key);
        const words = videoWords(row.text_content);
        if (words.length > 0) {
          recentTexts.push(words);
          if (recentTexts.length > RECENT_TEXT_LIMIT) recentTexts.shift();
        }
      }
    }
  }

  let requestedFrames = Math.max(1, Math.ceil(duration / VIDEO_FRAME_INTERVAL_SECONDS));
  if (MAX_VIDEO_FRAMES > 0) requestedFrames = Math.min(requestedFrames, MAX_VIDEO_FRAMES);
  const coveredSeconds = MAX_VIDEO_FRAMES > 0
    ? Math.min(duration, requestedFrames * VIDEO_FRAME_INTERVAL_SECONDS)
    : duration;
  const segmentsTotal = Math.max(1, Math.ceil(coveredSeconds / VIDEO_SEGMENT_SECONDS));
  setProgress(content.id, meta, {
    stage: 'frames',
    label: 'جاري تحليل الفيديو واستخراج النصوص…',
    percent: 4,
    current: 0,
    total: segmentsTotal,
    framesProcessed: 0,
    framesTotal: requestedFrames,
    segmentsProcessed: 0,
    segmentsTotal,
    durationSeconds: Math.round(duration),
  });

  let processedFrames = 0;
  let lastHash: bigint | null = null;
  let framesInserted = 0;
  let pageSequence = 0;
  const maxExistingPage = get<{ max: number }>(
    'SELECT COALESCE(MAX(page_number), 0) AS max FROM book_pages WHERE book_id = ?',
    content.book_id,
  )?.max ?? 0;
  // أرقام مؤقتة فوق كل الصفحات الحالية، حتى لا يصطدم استئناف بعد إلغاء بصفحة قديمة.
  const temporaryPageBase = Math.max(2_000_000, maxExistingPage + 10_000);
  let visualDuplicates = 0;
  let textDuplicates = 0;
  let failedSegments = 0;

  for (let segmentIndex = 0; segmentIndex < segmentsTotal; segmentIndex += 1) {
    assertNotCancelled(content.id);
    if (MAX_VIDEO_FRAMES > 0 && processedFrames >= MAX_VIDEO_FRAMES) break;
    const start = segmentIndex * VIDEO_SEGMENT_SECONDS;
    const length = Math.min(VIDEO_SEGMENT_SECONDS, duration - start);
    if (length <= 0) break;

    // عند الاستئناف: إن كانت كل إطارات هذا المقطع محفوظة وناجحة، لا نعيد استخراجها.
    const expectedTimes: number[] = [];
    for (
      let seconds = Math.ceil(start / VIDEO_FRAME_INTERVAL_SECONDS) * VIDEO_FRAME_INTERVAL_SECONDS;
      seconds < start + length;
      seconds += VIDEO_FRAME_INTERVAL_SECONDS
    ) {
      expectedTimes.push(Math.round(seconds));
    }
    const segmentComplete =
      mode !== 'full' &&
      expectedTimes.length > 0 &&
      expectedTimes.every((seconds) => {
        const page = existingByTime.get(seconds);
        return Boolean(page && ['done', 'needs_review'].includes(page.ocr_status));
      });
    if (segmentComplete) {
      processedFrames = Math.min(requestedFrames, processedFrames + expectedTimes.length);
      setProgress(content.id, meta, {
        stage: 'frames',
        label: `تمت معالجة ${segmentIndex + 1} من ${segmentsTotal} مقطعًا سابقًا، ننتقل إلى التالي…`,
        percent: 4 + Math.min(72, ((segmentIndex + 1) / segmentsTotal) * 72),
        current: segmentIndex + 1,
        total: segmentsTotal,
        framesProcessed: processedFrames,
        framesTotal: requestedFrames,
        segmentsProcessed: segmentIndex + 1,
        segmentsTotal,
        durationSeconds: Math.round(duration),
      });
      continue;
    }

    let segment: { directory: string; frames: VideoFrame[] };
    try {
      segment = await extractSegmentFrames(
        book.file_path,
        framesDir,
        segmentIndex,
        start,
        length,
        VIDEO_FRAME_INTERVAL_SECONDS,
      );
    } catch (error) {
      // مقطع تالف لا يجب أن يُسقط كل ما استُخرج قبله.
      failedSegments += 1;
      console.warn(`[nerd/content] تعذّر استخراج المقطع ${segmentIndex + 1}:`, error);
      await rm(join(framesDir, `segment-${String(segmentIndex).padStart(4, '0')}`), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
      continue;
    }

    try {
      for (const frame of segment.frames) {
      assertNotCancelled(content.id);
      if (MAX_VIDEO_FRAMES > 0 && processedFrames >= MAX_VIDEO_FRAMES) break;
      processedFrames += 1;
      const seconds = Math.round(frame.seconds);
      const previousPage = existingByTime.get(seconds);

      if (previousPage && ['done', 'needs_review'].includes(previousPage.ocr_status)) {
        await rm(frame.path, { force: true }).catch(() => undefined);
        continue;
      }

      const hash = await averageHash(frame.path).catch(() => null);
      if (hash != null && lastHash != null && hamming(hash, lastHash) <= 2) {
        visualDuplicates += 1;
        await rm(frame.path, { force: true }).catch(() => undefined);
        continue;
      }
      if (hash != null) lastHash = hash;

      const result = await pageOcr(
        content,
        {
          id: previousPage?.id ?? 0,
          page_number: previousPage?.page_number ?? 0,
          text_content: null,
          image_path: frame.path,
          ocr_status: 'pending',
          error_message: null,
          source_kind: 'video_frame',
        },
        apiKey,
        meta,
      );

      if (!result.text.trim()) {
        await rm(frame.path, { force: true }).catch(() => undefined);
        if (previousPage) run('DELETE FROM book_pages WHERE id = ?', previousPage.id);
        continue;
      }

      if (isDuplicateVideoText(result.text, textKeys, recentTexts)) {
        textDuplicates += 1;
        await rm(frame.path, { force: true }).catch(() => undefined);
        if (previousPage) run('DELETE FROM book_pages WHERE id = ?', previousPage.id);
        continue;
      }

      const permanent = join(framesDir, `frame-${String(seconds).padStart(6, '0')}.jpg`);
      await rm(permanent, { force: true }).catch(() => undefined);
      await rename(frame.path, permanent);
      pageSequence += 1;
      const temporaryNumber = temporaryPageBase + pageSequence;

      let pageId: number;
      if (previousPage) {
        pageId = previousPage.id;
        run(
          `UPDATE book_pages
              SET page_number = ?, image_path = ?, text_content = '', ocr_status = 'pending',
                  confidence = NULL, error_message = NULL, source_time_seconds = ?
            WHERE id = ?`,
          temporaryNumber,
          permanent,
          seconds,
          pageId,
        );
      } else {
        const inserted = run(
          `INSERT INTO book_pages
             (book_id, page_number, image_path, ocr_status, source_kind, source_time_seconds)
           VALUES (?, ?, ?, 'pending', 'video_frame', ?)`,
          content.book_id,
          temporaryNumber,
          permanent,
          seconds,
        );
        pageId = inserted.lastInsertRowid;
      }

      markPage(pageId, result.text, result.status, result.confidence, result.error);
      existingByTime.set(seconds, {
        id: pageId,
        page_number: temporaryNumber,
        text_content: result.text,
        image_path: permanent,
        ocr_status: result.status,
        error_message: result.error,
        source_kind: 'video_frame',
        source_time_seconds: seconds,
      });
      framesInserted += 1;

      if (processedFrames % 5 === 0) {
        setProgress(content.id, meta, {
          stage: 'frames',
          label: `جاري استخراج النصوص من الفيديو… ${Math.min(processedFrames, requestedFrames)}/${requestedFrames}`,
          percent: 4 + Math.min(72, (segmentIndex / segmentsTotal) * 72),
          current: segmentIndex,
          total: segmentsTotal,
          framesProcessed: processedFrames,
          framesTotal: requestedFrames,
          segmentsProcessed: segmentIndex,
          segmentsTotal,
          durationSeconds: Math.round(duration),
        });
      }
    }
    } finally {
      await rm(segment.directory, { recursive: true, force: true }).catch(() => undefined);
    }
    meta.videoDuplicates = visualDuplicates;
    meta.duplicateTextFrames = textDuplicates;
    setProgress(content.id, meta, {
      stage: 'frames',
      label: `تمت معالجة ${segmentIndex + 1} من ${segmentsTotal} مقطعًا من الفيديو…`,
      percent: 4 + Math.min(72, ((segmentIndex + 1) / segmentsTotal) * 72),
      current: segmentIndex + 1,
      total: segmentsTotal,
      framesProcessed: processedFrames,
      framesTotal: requestedFrames,
      segmentsProcessed: segmentIndex + 1,
      segmentsTotal,
      durationSeconds: Math.round(duration),
    });
  }

  meta.videoFrameIntervalSeconds = VIDEO_FRAME_INTERVAL_SECONDS;
  meta.videoSegments = segmentsTotal;
  meta.framesProcessed = processedFrames;
  meta.framesInserted = framesInserted;
  meta.failedVideoSegments = failedSegments;
  meta.videoDuplicates = visualDuplicates;
  meta.duplicateTextFrames = textDuplicates;
  saveMeta(content.id, meta);

  // تفريغ الصوت على مقاطع زمنية صغيرة: يتجنب حد حجم الملف وحد الطلب الواحد.
  const transcriptRows = all<PageRow & { source_time_seconds: number | null }>(
    `SELECT id, page_number, text_content, image_path, ocr_status, error_message, source_kind, source_time_seconds
       FROM book_pages WHERE book_id = ? AND source_kind = 'transcript'
      ORDER BY COALESCE(source_time_seconds, 0), page_number`,
    content.book_id,
  );
  const transcriptByStart = new Map<number, string>();
  for (const row of transcriptRows) {
    if (row.text_content?.trim()) transcriptByStart.set(Math.round(Number(row.source_time_seconds ?? 0)), row.text_content);
  }

  let transcriptStatus =
    content.transcript_status === 'done'
      ? 'done'
      : transcriptRows.length > 0
        ? 'failed'
        : 'skipped';
  let transcriptError: string | null = null;
  let transcriptText = [...transcriptByStart.entries()]
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1])
    .join('\n\n');
  let transcriptModel: string | null = null;

  const transcriptAlreadyComplete =
    content.transcript_status === 'done' &&
    Boolean(content.transcript_text?.trim()) &&
    existing.some((row) => row.source_kind === 'transcript' && row.text_content?.trim());
  const audioChunks = Math.max(1, Math.ceil(duration / VIDEO_TRANSCRIBE_CHUNK_SECONDS));

  if (transcriptAlreadyComplete) {
    transcriptStatus = 'done';
    if (transcriptText.trim()) transcriptText = transcriptText.trim();
  } else if (!apiKey) {
    if (transcriptRows.length > 0) {
      transcriptStatus = content.transcript_status === 'failed' ? 'failed' : 'done';
      transcriptError = content.transcript_error ?? 'تفريغ الصوت غير مكتمل؛ النص المرئي محفوظ ويمكن استئنافه لاحقًا.';
    } else {
      transcriptStatus = 'skipped';
      transcriptError = 'لم يُرسل مفتاح الذكاء الاصطناعي مع الرفع، لذلك لم يُفرَّغ الصوت. النص المرئي كافٍ للمتابعة.';
    }
  } else {
    setProgress(content.id, meta, {
      stage: 'audio',
      label: 'جاري تفريغ صوت الفيديو على مقاطع…',
      percent: 78,
      current: 0,
      total: audioChunks,
      durationSeconds: Math.round(duration),
    });

    for (let index = 0; index < audioChunks; index += 1) {
      assertNotCancelled(content.id);
      const start = index * VIDEO_TRANSCRIBE_CHUNK_SECONDS;
      const length = Math.min(VIDEO_TRANSCRIBE_CHUNK_SECONDS, duration - start);
      if (length <= 0) break;
      if (transcriptByStart.has(Math.round(start))) {
        setProgress(content.id, meta, {
          stage: 'audio',
          label: `تم تفريغ ${index + 1} من ${audioChunks} مقطعًا صوتيًا…`,
          percent: 78 + ((index + 1) / audioChunks) * 17,
          current: index + 1,
          total: audioChunks,
          durationSeconds: Math.round(duration),
        });
        continue;
      }

      const audioPath = await extractAudioSegment(book.file_path, directory, index, start, length);
      if (!audioPath) {
        if (index === 0 && transcriptRows.length === 0) {
          transcriptStatus = 'skipped';
          transcriptError = 'لا يوجد مسار صوتي واضح في الفيديو.';
          break;
        }
        continue;
      }

      try {
        const transcript = await transcribeAudio({
          apiKey,
          path: audioPath,
          label: `${Math.floor(start / 60)}:${String(Math.floor(start % 60)).padStart(2, '0')}`,
        });
        transcriptModel = transcript.model;
        if (transcript.text.trim()) {
          run(
            `INSERT INTO book_pages
               (book_id, page_number, text_content, ocr_status, source_kind, source_time_seconds)
             VALUES (?, ?, ?, 'done', 'transcript', ?)`,
            content.book_id,
            1_100_000 + index,
            transcript.text.trim(),
            start,
          );
          transcriptByStart.set(Math.round(start), transcript.text.trim());
          transcriptText = [...transcriptByStart.entries()]
            .sort((left, right) => left[0] - right[0])
            .map((entry) => entry[1])
            .join('\n\n');
          transcriptStatus = 'done';
        }
      } catch (error) {
        transcriptStatus = 'failed';
        transcriptError = error instanceof Error ? error.message : 'تعذّر تفريغ صوت الفيديو.';
        console.warn(`[nerd/content] فشل تفريغ المقطع الصوتي ${index + 1}:`, error);
        // نحتفظ بما نجح ونسمح بالاستئناف لاحقًا بدل إعادة كل شيء.
        break;
      } finally {
        await rm(audioPath, { force: true }).catch(() => undefined);
      }

      setProgress(content.id, meta, {
        stage: 'audio',
        label: `تم تفريغ ${index + 1} من ${audioChunks} مقطعًا صوتيًا…`,
        percent: 78 + ((index + 1) / audioChunks) * 17,
        current: index + 1,
        total: audioChunks,
        durationSeconds: Math.round(duration),
      });
    }
  }

  run(
    'UPDATE study_contents SET transcript_status = ?, transcript_text = ?, transcript_error = ? WHERE id = ?',
    transcriptStatus,
    transcriptText.trim() || null,
    transcriptError,
    content.id,
  );
  meta.transcriptStatus = transcriptStatus;
  if (transcriptModel) meta.transcriptModel = transcriptModel;
  delete meta.lastVisionError;
  delete meta.visionFallbacks;
  saveMeta(content.id, meta);

  await renumberVideoPages(content.book_id);
  setProgress(content.id, meta, {
    stage: 'index',
    label: 'تم استخراج النص، وجارٍ تجهيز فهرس المحتوى…',
    percent: 97,
    current: audioChunks,
    total: audioChunks,
    framesProcessed: processedFrames,
    framesTotal: requestedFrames,
    segmentsProcessed: segmentsTotal,
    segmentsTotal,
    durationSeconds: Math.round(duration),
  });
  return pageCount(content.book_id);
}

function rebuildChunks(bookId: number): number {
  run('DELETE FROM document_chunks WHERE book_id = ?', bookId);
  const pages = all<{ page_number: number; text_content: string }>(
    "SELECT page_number, text_content FROM book_pages WHERE book_id = ? AND text_content <> '' ORDER BY page_number",
    bookId,
  ).map((row) => ({ pageNumber: row.page_number, text: row.text_content }));
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
  return chunks.length;
}

export async function processContent(
  contentId: number,
  mode: ContentMode = 'initial',
  apiKey: string | null = null,
): Promise<void> {
  const content = contentRow(contentId);
  if (!content) return;

  setContentStatus(contentId, 'extracting', null);
  setBookStatus(content.book_id, 'extracting', null, pageCount(content.book_id));
  const meta = parseMeta(content.metadata_json);
  meta.cancelled = false;
  delete meta.lastVisionError;
  delete meta.visionFallbacks;

  try {
    if (mode === 'append' || mode === 'failed') {
      await processImagePages(content, apiKey, mode, meta);
      await renumberPages(content.book_id);
    } else if (content.source_type === 'video') {
      await processVideo(content, apiKey, meta, mode);
    } else if (content.source_type === 'pdf') {
      await processPdf(content);
    } else if (content.source_type === 'text') {
      const text = String(meta.textInput ?? '');
      await processText(content, text);
    } else {
      const pages = all<PageRow>(
        "SELECT id, page_number, text_content, image_path, ocr_status, error_message, source_kind FROM book_pages WHERE book_id = ? AND image_path IS NOT NULL ORDER BY page_number",
        content.book_id,
      );
      setProgress(contentId, meta, {
        stage: 'pages',
        label: `جاري استخراج النص من الصفحات… 0/${pages.length}`,
        percent: 5,
        current: 0,
        total: pages.length,
      });
      await processImagePages(content, apiKey, mode === 'resume' ? 'resume' : mode, meta);
      setProgress(contentId, meta, {
        stage: 'pages',
        label: 'تم استخراج النص من الصفحات، وجارٍ تجهيز الفهرس…',
        percent: 92,
        current: pages.length,
        total: pages.length,
      });
    }

    const chunksCount = rebuildChunks(content.book_id);
    if (chunksCount === 0) {
      throw new Error(
        content.source_type === 'video'
          ? 'لم نستخرج نصًا واضحًا من إطارات الفيديو أو صوته. جرّب فيديو أوضح أو صورًا للصفحات.'
          : 'لم نستخرج نصًا قابلًا للاستخدام من هذا المحتوى.',
      );
    }

    const stats = get<{ pages: number; chars: number; review: number; failed: number }>(
      `SELECT COUNT(*) AS pages,
              COALESCE(SUM(LENGTH(REPLACE(text_content, ' ', ''))), 0) AS chars,
              SUM(CASE WHEN ocr_status IN ('needs_review', 'empty') THEN 1 ELSE 0 END) AS review,
              SUM(CASE WHEN ocr_status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM book_pages WHERE book_id = ?`,
      content.book_id,
    );
    const pages = stats?.pages ?? 0;
    const chars = stats?.chars ?? 0;
    const review = stats?.review ?? 0;
    const failed = stats?.failed ?? 0;
    const failedSegments = Number(meta.failedVideoSegments ?? 0);
    const status = review + failed + failedSegments > 0 ? 'needs_review' : 'ready';
    const warnings: string[] = [];
    if (review + failed > 0) {
      warnings.push(
        `${review + failed} صفحة تحتاج مراجعة (صورة غير واضحة أو نص ناقص). يمكنك إعادة تصويرها أو إعادة معالجتها.`,
      );
    }
    if (failedSegments > 0) {
      warnings.push(
        `تعذّر استخراج ${failedSegments} مقطعًا من الفيديو. النص المستخرج من بقية المقاطع محفوظ، ويمكنك إعادة المحاولة.`,
      );
    }
    const warning = warnings.length > 0 ? warnings.join(' ') : null;

    run(
      'UPDATE study_contents SET status = ?, error_message = ?, pages_count = ?, text_chars = ?, updated_at = ? WHERE id = ?',
      status,
      warning,
      pages,
      chars,
      nowIso(),
      contentId,
    );
    setBookStatus(content.book_id, 'ready', warning, pages);
    meta.chunksCount = chunksCount;
    meta.pagesCount = pages;
    meta.cancelled = false;
    meta.processing = {
      stage: 'done',
      label: 'اكتملت المعالجة بنجاح.',
      percent: 100,
      current: pages,
      total: pages,
      updatedAt: nowIso(),
    };
    saveMeta(contentId, meta);

    logActivity(
      content.user_id,
      'content',
      `اكتملت معالجة «${content.title}»`,
      `${pages} صفحة · ${chunksCount} مقطع · ${chars} حرف`,
    );
    createNotification(
      content.user_id,
      'content',
      'محتواك الدراسي جاهز',
      `تمت معالجة «${content.title}»${warning ? ' مع صفحات تحتاج مراجعة.' : '.'}`,
    );
  } catch (error) {
    // حتى عند الإلغاء/الفشل نرتّب الصفحات المحفوظة ونتركها قابلة للعرض والاستئناف.
    if (content.source_type === 'video') {
      await renumberVideoPages(content.book_id).catch(() => undefined);
    }
    if (error instanceof ContentCancelledError) {
      markCancelled(contentId);
      return;
    }
    const message = error instanceof Error ? error.message : 'خطأ غير معروف أثناء المعالجة.';
    console.error(`[nerd/content] فشل المحتوى ${contentId}:`, error);
    failContent(contentId, message);
  }
}

export async function rebuildContentIndex(contentId: number): Promise<void> {
  const content = contentRow(contentId);
  if (!content) return;
  await renumberPages(content.book_id);
  const chunks = rebuildChunks(content.book_id);
  const stats = get<{ pages: number; chars: number; review: number; failed: number }>(
    `SELECT COUNT(*) AS pages,
            COALESCE(SUM(LENGTH(REPLACE(text_content, ' ', ''))), 0) AS chars,
            SUM(CASE WHEN ocr_status IN ('needs_review', 'empty') THEN 1 ELSE 0 END) AS review,
            SUM(CASE WHEN ocr_status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM book_pages WHERE book_id = ?`,
    content.book_id,
  );
  const pages = stats?.pages ?? 0;
  const status = chunks === 0 ? 'failed' : (stats?.review ?? 0) + (stats?.failed ?? 0) > 0 ? 'needs_review' : 'ready';
  run(
    'UPDATE study_contents SET pages_count = ?, text_chars = ?, status = ?, updated_at = ? WHERE id = ?',
    pages,
    stats?.chars ?? 0,
    status,
    nowIso(),
    contentId,
  );
  setBookStatus(content.book_id, status === 'failed' ? 'failed' : 'ready', null, pages);
}

export function resumePendingContents(): void {
  const stuck = all<{ id: number }>(
    "SELECT id FROM study_contents WHERE status IN ('pending', 'extracting', 'draft')",
  );
  // resume يحافظ على الصفحات والإطارات الناجحة بدل إعادة معالجة الفيديو كله.
  for (const row of stuck) enqueueContent(row.id, 'resume');
  if (stuck.length > 0) console.log(`[nerd/content] استئناف معالجة ${stuck.length} محتوى.`);
}

/** يفشل المحتوى المعلّق عند تعذّر الوصول إلى ملفاته. */
export function failMissingContent(contentId: number): void {
  failContent(contentId, 'الملفات الأصلية للمحتوى غير موجودة. أعد رفع المحتوى.');
}
