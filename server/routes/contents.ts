import { Router } from 'express';
import multer from 'multer';
import { extname, join, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { z } from 'zod';
import { all, get, nowIso, run } from '../db.ts';
import { createNotification, logActivity, requireUser } from '../auth.ts';
import { HttpError, rateLimit } from '../http.ts';
import { aiKeyFromRequest } from '../ai/key.ts';
import { chatCompletion } from '../ai/provider.ts';
import { assertQuota, recordUsage, usageToday } from '../ai/usage.ts';
import {
  bookDirectory,
  ensureBookDirectory,
  fileSize,
  moveFile,
  removeFile,
  sha256File,
  tmpRoot,
} from '../storage.ts';
import {
  cancelContent,
  enqueueContent,
  rebuildContentIndex,
  type ContentSourceType,
} from '../content-processing.ts';

export const contentsRouter = Router();

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v', '.ogv'];
const MAX_IMAGE_BYTES = Number(process.env.MAX_CONTENT_IMAGE_BYTES ?? 25 * 1024 * 1024);
const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_BYTES ?? 200 * 1024 * 1024);
const MAX_PDF_BYTES = Number(process.env.MAX_CONTENT_PDF_BYTES ?? 50 * 1024 * 1024);
const MAX_IMAGES = Number(process.env.MAX_CONTENT_FILES ?? 30);
const MAX_TEXT_CHARS = Number(process.env.MAX_CONTENT_TEXT_CHARS ?? 100_000);
const MAX_PAGES = Number(process.env.MAX_CONTENT_PAGES ?? 250);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, tmpRoot),
    filename: (_req, file, callback) =>
      callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_VIDEO_BYTES, files: MAX_IMAGES },
});

function receiveFiles(req: Parameters<typeof requireUser>[0], res: Parameters<typeof requireUser>[1]) {
  return new Promise<Express.Multer.File[]>((resolvePromise, rejectPromise) => {
    upload.array('files', MAX_IMAGES)(req, res, (error: unknown) => {
      if (!error) {
        resolvePromise((req.files as Express.Multer.File[] | undefined) ?? []);
        return;
      }
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          rejectPromise(
            new HttpError(
              400,
              `حجم الملف كبير جدًا. الحد الأقصى ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} ميغابايت للفيديو، و${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} ميغابايت للصورة.`,
            ),
          );
          return;
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
          rejectPromise(new HttpError(400, `الحد الأقصى ${MAX_IMAGES} ملفًا في المرة الواحدة.`));
          return;
        }
      }
      rejectPromise(error);
    });
  });
}

async function cleanup(files: Array<{ path?: string }> | undefined): Promise<void> {
  for (const file of files ?? []) {
    if (file.path) await removeFile(file.path);
  }
}

type SourceType = ContentSourceType;

const SOURCE_LABELS: Record<SourceType, string> = {
  images: 'صور صفحات',
  video: 'فيديو',
  text: 'نص',
  pdf: 'PDF',
};

interface ContentListRow {
  id: number;
  user_id: number;
  book_id: number;
  title: string;
  source_type: SourceType;
  status: string;
  error_message: string | null;
  pages_count: number;
  duration_seconds: number | null;
  text_chars: number;
  version: number;
  needs_refresh: number;
  transcript_status: string;
  transcript_text: string | null;
  transcript_error: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
  subject_name: string | null;
  grade_name: string | null;
  size_bytes: number;
  file_path: string | null;
  summaries_count: number;
  tests_count: number;
  conversations_count: number;
  images_count: number;
  thumbnail_page: number | null;
  chunks_count: number;
  stale_count: number;
}

const contentSelect = `
  SELECT c.*, s.name_ar AS subject_name, g.name_ar AS grade_name,
         b.size_bytes, b.file_path,
         (SELECT COUNT(*) FROM summaries sm WHERE sm.content_id = c.id) AS summaries_count,
         (SELECT COUNT(*) FROM tests t WHERE t.content_id = c.id) AS tests_count,
         (SELECT COUNT(*) FROM chat_conversations cc WHERE cc.content_id = c.id) AS conversations_count,
         (SELECT COUNT(*) FROM book_pages p WHERE p.book_id = c.book_id AND p.image_path IS NOT NULL) AS images_count,
         (SELECT p.page_number FROM book_pages p WHERE p.book_id = c.book_id AND p.image_path IS NOT NULL ORDER BY p.page_number LIMIT 1) AS thumbnail_page,
         (SELECT COUNT(*) FROM document_chunks dc WHERE dc.book_id = c.book_id) AS chunks_count,
         (SELECT COUNT(*) FROM summaries sm2 WHERE sm2.content_id = c.id AND COALESCE(sm2.content_version, 0) < c.version)
         + (SELECT COUNT(*) FROM tests t2 WHERE t2.content_id = c.id AND COALESCE(t2.content_version, 0) < c.version)
         + (SELECT COUNT(*) FROM chat_conversations cc2 WHERE cc2.content_id = c.id AND COALESCE(cc2.content_version, 0) < c.version) AS stale_count
    FROM study_contents c
    JOIN books b ON b.id = c.book_id
    LEFT JOIN subjects s ON s.id = c.subject_id
    LEFT JOIN grade_levels g ON g.id = c.grade_level_id`;

function serializeContent(row: ContentListRow) {
  let processing: Record<string, unknown> | null = null;
  if (row.metadata_json) {
    try {
      const meta = JSON.parse(row.metadata_json) as { processing?: unknown };
      if (meta.processing && typeof meta.processing === 'object') {
        processing = meta.processing as Record<string, unknown>;
      }
    } catch {
      processing = null;
    }
  }
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    sourceTypeLabel: SOURCE_LABELS[row.source_type] ?? row.source_type,
    status: row.status,
    errorMessage: row.error_message,
    pagesCount: row.pages_count,
    durationSeconds: row.duration_seconds,
    textChars: row.text_chars,
    version: row.version,
    needsRefresh: Boolean(row.needs_refresh) || row.stale_count > 0,
    staleResults: row.stale_count,
    transcriptStatus: row.transcript_status,
    transcriptError: row.transcript_error,
    transcriptPreview: row.transcript_text ? row.transcript_text.slice(0, 220) : null,
    subjectId: (row as unknown as { subject_id: number | null }).subject_id,
    subjectName: row.subject_name,
    gradeLevelId: (row as unknown as { grade_level_id: number | null }).grade_level_id,
    gradeName: row.grade_name,
    sizeBytes: row.size_bytes,
    chunksCount: row.chunks_count,
    imagesCount: row.images_count,
    hasImages: row.thumbnail_page != null,
    thumbnailPage: row.thumbnail_page,
    thumbnailUrl: row.thumbnail_page != null ? `/api/contents/${row.id}/thumbnail` : null,
    hasSourceFile: Boolean(row.file_path) && row.source_type !== 'images',
    counts: {
      summaries: row.summaries_count,
      tests: row.tests_count,
      conversations: row.conversations_count,
    },
    processing,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ownedContent(userId: number, rawId: string | number): ContentListRow {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف المحتوى غير صحيح.');
  const row = get<ContentListRow>(`${contentSelect} WHERE c.id = ? AND c.user_id = ?`, id, userId);
  if (!row) throw new HttpError(404, 'المحتوى غير موجود.');
  return row;
}

function idFrom(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, `معرّف ${label} غير صحيح.`);
  return value;
}

function optionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function validateMeta(subjectId: number | null, gradeLevelId: number | null): void {
  if (subjectId) {
    const subject = get<{ id: number }>('SELECT id FROM subjects WHERE id = ? AND is_active = 1', subjectId);
    if (!subject) throw new HttpError(400, 'المادة المختارة غير متاحة.');
  }
  if (gradeLevelId) {
    const grade = get<{ id: number }>('SELECT id FROM grade_levels WHERE id = ? AND is_active = 1', gradeLevelId);
    if (!grade) throw new HttpError(400, 'الصف المختار غير متاح.');
  }
}

function classify(files: Express.Multer.File[]): SourceType {
  if (files.length === 0) return 'text';
  const extensions = files.map((file) => extname(file.originalname).toLowerCase());
  if (extensions.includes('.pdf')) return 'pdf';
  if (extensions.some((extension) => VIDEO_EXTENSIONS.includes(extension))) return 'video';
  return 'images';
}

function validateFiles(sourceType: SourceType, files: Express.Multer.File[]): void {
  const extensions = files.map((file) => extname(file.originalname).toLowerCase());
  if (sourceType === 'text') {
    if (files.length > 0) throw new HttpError(400, 'محتوى النص لا يقبل ملفات. احذف الملفات أو اختر نوع محتوى آخر.');
    return;
  }
  if (sourceType === 'pdf') {
    if (files.length !== 1 || extensions[0] !== '.pdf') {
      throw new HttpError(400, 'رفع PDF يتطلب ملف PDF واحدًا فقط.');
    }
    return;
  }
  if (sourceType === 'video') {
    if (files.length !== 1 || !VIDEO_EXTENSIONS.includes(extensions[0])) {
      throw new HttpError(400, 'رفع الفيديو يتطلب ملفًا واحدًا بصيغة MP4 أو MOV أو WEBM.');
    }
    return;
  }
  if (files.length === 0) throw new HttpError(400, 'اختر صورة صفحة واحدة على الأقل.');
  if (files.length > MAX_IMAGES) throw new HttpError(400, `الحد الأقصى ${MAX_IMAGES} صورة.`);
  for (const extension of extensions) {
    if (!IMAGE_EXTENSIONS.includes(extension)) {
      throw new HttpError(400, `صيغة غير مدعومة (${extension}). الصور المدعومة: JPG وPNG وWEBP.`);
    }
  }
}

contentsRouter.get('/contents', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const q = String(req.query.q ?? '').trim();
  const sourceType = String(req.query.sourceType ?? '').trim();
  const subjectId = optionalId(req.query.subjectId);
  const clauses = ['c.user_id = ?'];
  const params: Array<string | number> = [user.id];
  if (q) {
    clauses.push("(c.title LIKE '%' || ? || '%' OR COALESCE(c.transcript_text, '') LIKE '%' || ? || '%')");
    params.push(q, q);
  }
  if (sourceType && ['images', 'video', 'text', 'pdf'].includes(sourceType)) {
    clauses.push('c.source_type = ?');
    params.push(sourceType);
  }
  if (subjectId) {
    clauses.push('c.subject_id = ?');
    params.push(subjectId);
  }
  const rows = all<ContentListRow>(
    `${contentSelect} WHERE ${clauses.join(' AND ')} ORDER BY c.updated_at DESC, c.id DESC LIMIT 100`,
    ...params,
  );
  const stats = get<{ total: number; ready: number; review: number; processing: number; images: number; video: number; text: number; pdf: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready,
            SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END) AS review,
            SUM(CASE WHEN status IN ('pending', 'extracting') THEN 1 ELSE 0 END) AS processing,
            SUM(CASE WHEN source_type = 'images' THEN 1 ELSE 0 END) AS images,
            SUM(CASE WHEN source_type = 'video' THEN 1 ELSE 0 END) AS video,
            SUM(CASE WHEN source_type = 'text' THEN 1 ELSE 0 END) AS text,
            SUM(CASE WHEN source_type = 'pdf' THEN 1 ELSE 0 END) AS pdf
       FROM study_contents WHERE user_id = ?`,
    user.id,
  );
  res.json({
    contents: rows.map(serializeContent),
    stats: {
      total: stats?.total ?? 0,
      ready: stats?.ready ?? 0,
      review: stats?.review ?? 0,
      processing: stats?.processing ?? 0,
      images: stats?.images ?? 0,
      video: stats?.video ?? 0,
      text: stats?.text ?? 0,
      pdf: stats?.pdf ?? 0,
    },
  });
});

contentsRouter.post(
  '/contents',
  rateLimit({ key: 'content-create', limit: 40, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    let files: Express.Multer.File[] = [];
    let contentId: number | null = null;
    let bookId: number | null = null;
    try {
      files = await receiveFiles(req, res);

      const requested = String(req.body?.sourceType ?? '').trim() as SourceType | '';
      const detected = classify(files);
      const sourceType: SourceType = requested || detected;
      if (!['images', 'video', 'text', 'pdf'].includes(sourceType)) {
        throw new HttpError(400, 'نوع المحتوى غير معروف.');
      }
      if (files.length > 0 && sourceType !== detected) {
        throw new HttpError(400, 'نوع المحتوى المختار لا يطابق الملفات المرفوعة.');
      }
      validateFiles(sourceType, files);

      const text = String(req.body?.text ?? '').trim();
      if (sourceType === 'text') {
        const chars = text.replace(/\s/g, '').length;
        if (chars < 20) throw new HttpError(400, 'اكتب فقرة دراسية واحدة على الأقل (20 حرفًا).');
        if (text.length > MAX_TEXT_CHARS) {
          throw new HttpError(400, `النص أطول من الحد المسموح (${MAX_TEXT_CHARS} حرفًا).`); 
        }
      }

      const subjectId = optionalId(req.body?.subjectId);
      const gradeLevelId = optionalId(req.body?.gradeLevelId);
      validateMeta(subjectId, gradeLevelId);

      const suppliedTitle = String(req.body?.title ?? '').trim();
      if (suppliedTitle.length > 160) throw new HttpError(400, 'عنوان الموضوع طويل جدًا.');
      const fallbackTitle =
        sourceType === 'images'
          ? 'صور دراسية جديدة'
          : sourceType === 'video'
            ? 'درس مصوّر جديد'
            : sourceType === 'pdf'
              ? 'ملف دراسي جديد'
              : 'ملاحظات دراسية جديدة';
      const title = suppliedTitle || fallbackTitle;

      let primaryHash: string | null = null;
      if (files.length > 0) {
        primaryHash = await sha256File(files[0].path);
        const duplicate = get<{ id: number; title: string }>(
          `SELECT c.id, c.title FROM study_contents c
             JOIN books b ON b.id = c.book_id
            WHERE c.user_id = ? AND b.content_hash = ?`,
          user.id,
          primaryHash,
        );
        if (duplicate) {
          throw new HttpError(
            409,
            `هذا المحتوى موجود لديك مسبقًا بعنوان «${duplicate.title}». افتحه من مكتبتك وأعد استخدامه بدل رفعه مرة أخرى.|${duplicate.id}`,
          );
        }
      }

      const createdBook = run(
        `INSERT INTO books (user_id, subject_id, grade_level_id, title, file_type, status, content_hash, is_content_source, content_source_type)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, 1, ?)`,
        user.id,
        subjectId,
        gradeLevelId,
        title,
        sourceType,
        primaryHash,
        sourceType,
      );
      bookId = createdBook.lastInsertRowid;

      const meta: Record<string, unknown> = {};
      if (sourceType === 'text') meta.textInput = text;

      const createdContent = run(
        `INSERT INTO study_contents (user_id, book_id, subject_id, grade_level_id, title, source_type, status, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        user.id,
        bookId,
        subjectId,
        gradeLevelId,
        title,
        sourceType,
        JSON.stringify(meta),
      );
      contentId = createdContent.lastInsertRowid;

      const directory = ensureBookDirectory(user.id, bookId);
      let totalBytes = 0;

      if (sourceType === 'images') {
        const ordered = [...files].sort((left, right) =>
          left.originalname.localeCompare(right.originalname, 'ar', { numeric: true }),
        );
        let pageNumber = 1;
        for (const file of ordered) {
          const size = await fileSize(file.path);
          if (size > MAX_IMAGE_BYTES) {
            throw new HttpError(400, `الصورة «${file.originalname}» أكبر من ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} ميغابايت.`);
          }
          const extension = extname(file.originalname).toLowerCase();
          const destination = join(directory, `page-${String(pageNumber).padStart(3, '0')}${extension}`);
          await moveFile(file.path, destination);
          totalBytes += size;
          run(
            "INSERT INTO book_pages (book_id, page_number, image_path, ocr_status, source_kind) VALUES (?, ?, ?, 'pending', 'image')",
            bookId,
            pageNumber,
            destination,
          );
          pageNumber += 1;
        }
        run(
          "UPDATE books SET file_path = ?, size_bytes = ?, pages_count = ? WHERE id = ?",
          directory,
          totalBytes,
          ordered.length,
          bookId,
        );
      } else if (sourceType === 'video' || sourceType === 'pdf') {
        const file = files[0];
        const size = await fileSize(file.path);
        const maxBytes = sourceType === 'video' ? MAX_VIDEO_BYTES : MAX_PDF_BYTES;
        if (size > maxBytes) {
          throw new HttpError(400, `حجم الملف أكبر من الحد المسموح (${Math.round(maxBytes / (1024 * 1024))} ميغابايت).`);
        }
        const extension = extname(file.originalname).toLowerCase();
        const destination = join(directory, sourceType === 'video' ? `source${extension}` : 'source.pdf');
        await moveFile(file.path, destination);
        totalBytes = size;
        run(
          'UPDATE books SET file_path = ?, size_bytes = ?, file_type = ? WHERE id = ?',
          destination,
          totalBytes,
          sourceType,
          bookId,
        );
      } else {
        run("UPDATE books SET size_bytes = ?, pages_count = 1 WHERE id = ?", Buffer.byteLength(text, 'utf8'), bookId);
      }

      run('UPDATE study_contents SET pages_count = ? WHERE id = ?', sourceType === 'text' ? 1 : files.length, contentId);
      enqueueContent(contentId, 'initial', req.get('x-ai-key'));

      logActivity(
        user.id,
        'content',
        `إضافة محتوى «${title}»`,
        `${SOURCE_LABELS[sourceType]}${files.length ? ` · ${files.length} ملف` : ''}`,
      );

      const row = ownedContent(user.id, contentId);
      res.status(201).json({ content: serializeContent(row) });
    } catch (error) {
      await cleanup(files);
      if (contentId) run('DELETE FROM study_contents WHERE id = ?', contentId);
      if (bookId) {
        await rm(bookDirectory(user.id, bookId), { recursive: true, force: true }).catch(() => undefined);
        run('DELETE FROM books WHERE id = ?', bookId);
      }
      if (error instanceof HttpError) {
        const [message, duplicateId] = error.message.split('|');
        res
          .status(error.status)
          .json({ error: { message, ...(duplicateId ? { contentId: Number(duplicateId) } : {}) } });
        return;
      }
      console.error('[nerd/content] فشل إنشاء المحتوى:', error);
      res.status(500).json({ error: { message: 'تعذّر حفظ المحتوى. حاول مرة أخرى.' } });
    }
  },
);

contentsRouter.get('/contents/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const content = ownedContent(user.id, String(req.params.id));

  const pages = all<{
    id: number;
    page_number: number;
    ocr_status: string;
    error_message: string | null;
    confidence: number | null;
    source_kind: string;
    source_time_seconds: number | null;
    text_content: string | null;
    image_path: string | null;
  }>(
    'SELECT id, page_number, ocr_status, error_message, confidence, source_kind, source_time_seconds, text_content, image_path FROM book_pages WHERE book_id = ? ORDER BY page_number',
    content.book_id,
  );

  const summaries = all<{ id: number; title: string; detail_level: string; content_version: number | null; created_at: string }>(
    'SELECT id, title, detail_level, content_version, created_at FROM summaries WHERE content_id = ? ORDER BY created_at DESC, id DESC',
    content.id,
  );
  const tests = all<{
    id: number;
    title: string;
    questions_count: number;
    content_version: number | null;
    created_at: string;
    attempts_count: number;
    best_score: number | null;
  }>(
    `SELECT t.id, t.title, t.questions_count, t.content_version, t.created_at,
            (SELECT COUNT(*) FROM test_attempts a WHERE a.test_id = t.id AND a.status = 'finished') AS attempts_count,
            (SELECT MAX(a.score) FROM test_attempts a WHERE a.test_id = t.id AND a.status = 'finished') AS best_score
       FROM tests t WHERE t.content_id = ? ORDER BY t.created_at DESC, t.id DESC`,
    content.id,
  );
  const conversations = all<{
    id: number;
    title: string;
    content_version: number | null;
    updated_at: string;
    message_count: number;
  }>(
    `SELECT cc.id, cc.title, cc.content_version, cc.updated_at,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = cc.id) AS message_count
       FROM chat_conversations cc WHERE cc.content_id = ? ORDER BY cc.updated_at DESC, cc.id DESC`,
    content.id,
  );

  res.json({
    content: serializeContent(content),
    pages: pages.map((page) => ({
      id: page.id,
      pageNumber: page.page_number,
      status: page.ocr_status,
      errorMessage: page.error_message,
      confidence: page.confidence,
      sourceKind: page.source_kind,
      sourceTimeSeconds: page.source_time_seconds,
      hasImage: Boolean(page.image_path),
      imageUrl: page.image_path ? `/api/contents/${content.id}/pages/${page.id}/image` : null,
      chars: page.text_content?.length ?? 0,
      preview: (page.text_content ?? '').slice(0, 180),
    })),
    summaries: summaries.map((row) => ({
      id: row.id,
      title: row.title,
      detailLevel: row.detail_level,
      contentVersion: row.content_version,
      stale: (row.content_version ?? 0) < content.version,
      createdAt: row.created_at,
    })),
    tests: tests.map((row) => ({
      id: row.id,
      title: row.title,
      questionsCount: row.questions_count,
      contentVersion: row.content_version,
      stale: (row.content_version ?? 0) < content.version,
      attemptsCount: row.attempts_count,
      bestScore: row.best_score,
      createdAt: row.created_at,
    })),
    conversations: conversations.map((row) => ({
      id: row.id,
      title: row.title,
      contentVersion: row.content_version,
      stale: (row.content_version ?? 0) < content.version,
      messageCount: row.message_count,
      updatedAt: row.updated_at,
    })),
  });
});

contentsRouter.patch('/contents/:id', (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    const content = ownedContent(user.id, String(req.params.id));
    const payload = z
      .object({
        title: z.string().trim().min(2, 'العنوان قصير جدًا.').max(160).optional(),
        subjectId: z.number().int().positive().nullable().optional(),
        gradeLevelId: z.number().int().positive().nullable().optional(),
      })
      .parse(req.body ?? {});

    if (payload.subjectId) validateMeta(payload.subjectId, null);
    if (payload.gradeLevelId) validateMeta(null, payload.gradeLevelId);

    const updates: string[] = [];
    const params: Array<string | number | null> = [];
    if (payload.title !== undefined) {
      updates.push('title = ?');
      params.push(payload.title);
      run('UPDATE books SET title = ? WHERE id = ?', payload.title, content.book_id);
    }
    if (payload.subjectId !== undefined) {
      updates.push('subject_id = ?');
      params.push(payload.subjectId);
    }
    if (payload.gradeLevelId !== undefined) {
      updates.push('grade_level_id = ?');
      params.push(payload.gradeLevelId);
    }
    if (updates.length === 0) throw new HttpError(400, 'لا توجد بيانات للتعديل.');
    updates.push('updated_at = ?');
    params.push(nowIso());
    params.push(content.id);
    run(`UPDATE study_contents SET ${updates.join(', ')} WHERE id = ?`, ...params);
    res.json({ content: serializeContent(ownedContent(user.id, content.id)) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: error.issues[0]?.message ?? 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

contentsRouter.delete('/contents/:id', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const content = ownedContent(user.id, String(req.params.id));

  await rm(bookDirectory(user.id, content.book_id), { recursive: true, force: true }).catch(() => undefined);
  run('DELETE FROM tests WHERE content_id = ? OR book_id = ?', content.id, content.book_id);
  run('DELETE FROM chat_conversations WHERE content_id = ? OR book_id = ?', content.id, content.book_id);
  run('DELETE FROM summaries WHERE content_id = ? OR book_id = ?', content.id, content.book_id);
  run('DELETE FROM study_contents WHERE id = ?', content.id);
  run('DELETE FROM books WHERE id = ?', content.book_id);
  logActivity(user.id, 'content', `حذف محتوى «${content.title}»`, 'حُذفت الصفحات والملفات والملخصات والاختبارات والمحادثات المرتبطة.');
  res.json({ ok: true });
});

contentsRouter.post(
  '/contents/:id/pages',
  rateLimit({ key: 'content-pages', limit: 40, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    let files: Express.Multer.File[] = [];
    try {
      const content = ownedContent(user.id, String(req.params.id));
      if (['pending', 'extracting'].includes(content.status)) {
        throw new HttpError(409, 'المحتوى قيد المعالجة الآن. انتظر ثم أضف الصفحات.');
      }
      files = await receiveFiles(req, res);
      if (files.length === 0) throw new HttpError(400, 'اختر صورًا لإضافتها.');
      for (const file of files) {
        const extension = extname(file.originalname).toLowerCase();
        if (!IMAGE_EXTENSIONS.includes(extension)) {
          throw new HttpError(400, 'إضافة الصفحات تقبل صور JPG وPNG وWEBP فقط.');
        }
      }
      if (content.pages_count + files.length > MAX_PAGES) {
        throw new HttpError(400, `الحد الأقصى ${MAX_PAGES} صفحة للمحتوى الواحد.`);
      }

      const max = get<{ value: number }>('SELECT COALESCE(MAX(page_number), 0) AS value FROM book_pages WHERE book_id = ?', content.book_id)?.value ?? 0;
      const directory = ensureBookDirectory(user.id, content.book_id);
      let pageNumber = max;
      for (const file of [...files].sort((left, right) => left.originalname.localeCompare(right.originalname, 'ar', { numeric: true }))) {
        const size = await fileSize(file.path);
        if (size > MAX_IMAGE_BYTES) throw new HttpError(400, 'إحدى الصور أكبر من الحد المسموح.');
        pageNumber += 1;
        const destination = join(directory, `page-${String(pageNumber).padStart(3, '0')}${extname(file.originalname).toLowerCase()}`);
        await moveFile(file.path, destination);
        run(
          "INSERT INTO book_pages (book_id, page_number, image_path, ocr_status, source_kind) VALUES (?, ?, ?, 'pending', 'image')",
          content.book_id,
          pageNumber,
          destination,
        );
      }

      run(
        'UPDATE study_contents SET status = ?, version = version + 1, needs_refresh = 1, updated_at = ? WHERE id = ?',
        'pending',
        nowIso(),
        content.id,
      );
      run("UPDATE books SET status = 'pending' WHERE id = ?", content.book_id);
      enqueueContent(content.id, 'append', req.get('x-ai-key'));
      res.status(202).json({ content: serializeContent(ownedContent(user.id, content.id)) });
    } catch (error) {
      await cleanup(files);
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: { message: error.message } });
        return;
      }
      console.error('[nerd/content] فشل إضافة صفحات:', error);
      res.status(500).json({ error: { message: 'تعذّر حفظ الصفحات الجديدة.' } });
    }
  },
);

contentsRouter.patch('/contents/:id/pages/order', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const content = ownedContent(user.id, String(req.params.id));
  const payload = z.object({ pageIds: z.array(z.number().int().positive()).min(1).max(MAX_PAGES) }).parse(req.body ?? {});
  const pages = all<{ id: number }>('SELECT id FROM book_pages WHERE book_id = ? ORDER BY page_number', content.book_id);
  const existing = new Set(pages.map((page) => page.id));
  if (payload.pageIds.length !== pages.length || payload.pageIds.some((id) => !existing.has(id))) {
    throw new HttpError(400, 'ترتيب الصفحات غير مطابق لصفحات المحتوى.');
  }
  run('UPDATE book_pages SET page_number = page_number + 100000 WHERE book_id = ?', content.book_id);
  payload.pageIds.forEach((id, index) => {
    run('UPDATE book_pages SET page_number = ? WHERE id = ?', index + 1, id);
  });
  run(
    'UPDATE study_contents SET version = version + 1, needs_refresh = 1, updated_at = ? WHERE id = ?',
    nowIso(),
    content.id,
  );
  rebuildContentIndex(content.id)
    .then(() => undefined)
    .catch((error) => console.error('[nerd/content] فشل تحديث فهرس المحتوى:', error));
  res.json({ content: serializeContent(ownedContent(user.id, content.id)) });
});

contentsRouter.delete('/contents/:id/pages/:pageId', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const content = ownedContent(user.id, String(req.params.id));
  const pageId = idFrom(String(req.params.pageId), 'الصفحة');
  const page = get<{ id: number; image_path: string | null }>(
    'SELECT id, image_path FROM book_pages WHERE id = ? AND book_id = ?',
    pageId,
    content.book_id,
  );
  if (!page) throw new HttpError(404, 'الصفحة غير موجودة.');
  run('DELETE FROM book_pages WHERE id = ?', page.id);

  if (page.image_path) {
    const directory = resolve(bookDirectory(user.id, content.book_id));
    const target = resolve(page.image_path);
    if (target.startsWith(directory + sep)) await removeFile(target);
  }
  const remaining = get<{ count: number }>('SELECT COUNT(*) AS count FROM book_pages WHERE book_id = ?', content.book_id)?.count ?? 0;
  run(
    'UPDATE study_contents SET version = version + 1, needs_refresh = 1, status = ?, updated_at = ? WHERE id = ?',
    remaining === 0 ? 'failed' : 'pending',
    nowIso(),
    content.id,
  );
  await rebuildContentIndex(content.id);
  res.json({ content: serializeContent(ownedContent(user.id, content.id)) });
});

contentsRouter.post('/contents/:id/pages/:pageId/reprocess', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const content = ownedContent(user.id, String(req.params.id));
  const pageId = idFrom(String(req.params.pageId), 'الصفحة');
  const page = get<{ id: number; image_path: string | null }>(
    'SELECT id, image_path FROM book_pages WHERE id = ? AND book_id = ?',
    pageId,
    content.book_id,
  );
  if (!page) throw new HttpError(404, 'الصفحة غير موجودة.');
  if (!page.image_path) throw new HttpError(400, 'هذه الصفحة نصية ولا تحتاج إعادة قراءة.');
  run(
    "UPDATE book_pages SET text_content = '', ocr_status = 'pending', error_message = NULL WHERE id = ?",
    page.id,
  );
  run("UPDATE study_contents SET status = 'pending', updated_at = ? WHERE id = ?", nowIso(), content.id);
  enqueueContent(content.id, 'append', req.get('x-ai-key'));
  res.status(202).json({ ok: true });
});

contentsRouter.post('/contents/:id/cancel', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const content = ownedContent(user.id, String(req.params.id));
  if (!['pending', 'extracting'].includes(content.status)) {
    throw new HttpError(409, 'لا توجد معالجة جارية لهذا المحتوى.');
  }
  const cancelled = cancelContent(content.id);
  res.status(202).json({ ok: cancelled, content: serializeContent(ownedContent(user.id, content.id)) });
});

contentsRouter.post('/contents/:id/resume', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const content = ownedContent(user.id, String(req.params.id));
  if (content.source_type !== 'video') {
    throw new HttpError(400, 'الاستئناف متاح للفيديو. استخدم إعادة المعالجة لهذا النوع.');
  }
  if (['pending', 'extracting'].includes(content.status)) {
    throw new HttpError(409, 'المحتوى قيد المعالجة الآن.');
  }
  run(
    "UPDATE study_contents SET status = 'pending', error_message = NULL, updated_at = ? WHERE id = ?",
    nowIso(),
    content.id,
  );
  enqueueContent(content.id, 'resume', req.get('x-ai-key'));
  res.status(202).json({ ok: true, content: serializeContent(ownedContent(user.id, content.id)) });
});

contentsRouter.post('/contents/:id/reprocess', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const content = ownedContent(user.id, String(req.params.id));
  if (['pending', 'extracting'].includes(content.status)) {
    throw new HttpError(409, 'المحتوى قيد المعالجة الآن.');
  }
  run(
    "UPDATE study_contents SET status = 'pending', error_message = NULL, version = version + 1, needs_refresh = 1, updated_at = ? WHERE id = ?",
    nowIso(),
    content.id,
  );
  enqueueContent(content.id, 'full', req.get('x-ai-key'));
  createNotification(user.id, 'content', 'أُعيدت معالجة المحتوى', `بدأت إعادة معالجة «${content.title}».`);
  res.status(202).json({ ok: true });
});

contentsRouter.get('/contents/:id/pages/:pageId/text', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const content = ownedContent(user.id, String(req.params.id));
  const page = get<{ text_content: string | null }>(
    'SELECT text_content FROM book_pages WHERE id = ? AND book_id = ?',
    idFrom(req.params.pageId, 'الصفحة'),
    content.book_id,
  );
  if (!page) throw new HttpError(404, 'الصفحة غير موجودة.');
  res.json({ text: page.text_content ?? '' });
});

contentsRouter.get('/contents/:id/pages/:pageId/image', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const content = ownedContent(user.id, String(req.params.id));
  const pageId = idFrom(String(req.params.pageId), 'الصفحة');
  const page = get<{ image_path: string | null }>(
    'SELECT image_path FROM book_pages WHERE id = ? AND book_id = ?',
    pageId,
    content.book_id,
  );
  if (!page?.image_path || !existsSync(page.image_path)) {
    res.status(404).json({ error: { message: 'لا توجد صورة لهذه الصفحة.' } });
    return;
  }
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(page.image_path);
});

contentsRouter.get('/contents/:id/thumbnail', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const content = ownedContent(user.id, String(req.params.id));
  const page = get<{ image_path: string | null }>(
    'SELECT image_path FROM book_pages WHERE book_id = ? AND image_path IS NOT NULL ORDER BY page_number LIMIT 1',
    content.book_id,
  );
  if (!page?.image_path || !existsSync(page.image_path)) {
    res.status(404).json({ error: { message: 'لا توجد صورة مصغّرة.' } });
    return;
  }
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(page.image_path);
});

contentsRouter.get('/contents/:id/file', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const content = ownedContent(user.id, String(req.params.id));
  const book = get<{ file_path: string | null; file_type: string | null }>(
    'SELECT file_path, file_type FROM books WHERE id = ?',
    content.book_id,
  );
  if (!book?.file_path || !['pdf', 'video'].includes(book.file_type ?? '') || !existsSync(book.file_path)) {
    res.status(404).json({ error: { message: 'لا يوجد ملف أصلي لهذا المحتوى.' } });
    return;
  }
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(book.file_path);
});

// اقتراح عنوان من النص المستخرج — لا يغيّر العنوان تلقائيًا، بل يعيده للطالب ليعدّله.
contentsRouter.post('/contents/:id/suggest-title', rateLimit({ key: 'content-title', limit: 20, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const content = ownedContent(user.id, String(req.params.id));
  if (!['ready', 'needs_review'].includes(content.status)) {
    throw new HttpError(409, 'انتظر اكتمال معالجة المحتوى أولًا.');
  }
  const text = all<{ text_content: string | null }>(
    'SELECT text_content FROM book_pages WHERE book_id = ? ORDER BY page_number LIMIT 6',
    content.book_id,
  )
    .map((page) => page.text_content ?? '')
    .join('\n')
    .slice(0, 6000);
  if (!text.trim()) throw new HttpError(422, 'لا يوجد نص مستخرج لاقتراح عنوان.');
  const apiKey = aiKeyFromRequest(req);
  assertQuota(user.id, 1);
  const result = await chatCompletion({
    apiKey,
    temperature: 0.2,
    maxTokens: 80,
    task: 'content',
    messages: [
      {
        role: 'system',
        content: 'أنت تساعد طالبًا في تسمية درس. أعد عنوانًا عربيًا واحدًا فقط، من 3 إلى 8 كلمات، بلا علامات اقتباس ولا شرح.',
      },
      { role: 'user', content: `النص:\n${text}\n\nاقترح عنوان الموضوع.` },
    ],
  });
  recordUsage({
    userId: user.id,
    task: 'content-title',
    model: result.model,
    provider: result.provider,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    status: 'success',
  });
  const title = result.content
    .replace(/["'«»]/g, '')
    .split('\n')[0]
    .trim()
    .slice(0, 120);
  res.json({ title, remaining: Math.max(0, usageToday(user.id).requests) });
});

export function contentBookForUser(
  userId: number,
  contentId: number,
): { id: number; title: string; version: number; status: string; bookId: number } {
  const row = get<{ id: number; title: string; version: number; status: string; book_id: number }>(
    'SELECT id, title, version, status, book_id FROM study_contents WHERE id = ? AND user_id = ?',
    contentId,
    userId,
  );
  if (!row) throw new HttpError(404, 'المحتوى غير موجود.');
  if (!['ready', 'needs_review'].includes(row.status)) {
    throw new HttpError(409, 'المحتوى ما زال قيد المعالجة. انتظر اكتمال استخراج النص ثم أعد المحاولة.');
  }
  return { id: row.id, title: row.title, version: row.version, status: row.status, bookId: row.book_id };
}
