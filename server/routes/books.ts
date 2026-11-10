import { Router } from 'express';
import multer from 'multer';
import { extname, join } from 'node:path';
import { z } from 'zod';
import { all, get, nowIso, run } from '../db.ts';
import { createNotification, logActivity, requireUser } from '../auth.ts';
import { HttpError, rateLimit } from '../http.ts';
import { buildSnippet, normalizeArabic } from '../chunking.ts';
import { enqueueBook, resetBook } from '../book-processing.ts';
import {
  ALLOWED_EXTENSIONS,
  MAX_FILES_PER_BOOK,
  MAX_FILE_BYTES,
  ensureBookDirectory,
  fileSize,
  moveFile,
  removeBookDirectory,
  removeFile,
  sha256File,
  tmpRoot,
} from '../storage.ts';

export const booksRouter = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, tmpRoot),
    filename: (_req, file, callback) => {
      const extension = extname(file.originalname).toLowerCase();
      callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`);
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_BOOK },
  fileFilter: (_req, file, callback) => {
    const extension = extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      callback(new HttpError(400, `صيغة الملف غير مدعومة (${extension}). المدعوم: PDF وJPG وPNG وWEBP.`));
      return;
    }
    callback(null, true);
  },
});

interface BookListRow {
  id: number;
  title: string;
  unit_name: string | null;
  status: string;
  error_message: string | null;
  pages_count: number;
  size_bytes: number;
  file_type: string | null;
  created_at: string;
  updated_at: string;
  subject_name: string | null;
  grade_name: string | null;
  semester_name: string | null;
  processed_pages: number;
  chunks_count: number;
  has_images: number;
}

const bookSelect = `
  SELECT b.id, b.title, b.unit_name, b.status, b.error_message, b.pages_count, b.size_bytes,
         b.file_type, b.created_at, b.updated_at,
         s.name_ar AS subject_name, g.name_ar AS grade_name, sem.name_ar AS semester_name,
         (SELECT COUNT(*) FROM book_pages p WHERE p.book_id = b.id AND p.ocr_status IN ('done', 'empty', 'failed')) AS processed_pages,
         (SELECT COUNT(*) FROM document_chunks c WHERE c.book_id = b.id) AS chunks_count,
         (SELECT COUNT(*) FROM book_pages p2 WHERE p2.book_id = b.id AND p2.image_path IS NOT NULL) AS has_images
    FROM books b
    LEFT JOIN subjects s ON s.id = b.subject_id
    LEFT JOIN grade_levels g ON g.id = b.grade_level_id
    LEFT JOIN semesters sem ON sem.id = b.semester_id`;

function serializeBook(row: BookListRow) {
  return {
    id: row.id,
    title: row.title,
    unitName: row.unit_name,
    status: row.status,
    errorMessage: row.error_message,
    pagesCount: row.pages_count,
    processedPages: row.processed_pages,
    chunksCount: row.chunks_count,
    sizeBytes: row.size_bytes,
    fileType: row.file_type,
    hasImages: row.has_images > 0,
    subjectName: row.subject_name,
    gradeName: row.grade_name,
    semesterName: row.semester_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ownedBook(req: Parameters<typeof requireUser>[0], res: Parameters<typeof requireUser>[1]) {
  const user = requireUser(req, res);
  if (!user) return null;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'معرّف الكتاب غير صحيح.' } });
    return null;
  }
  const book = get<{
    id: number;
    user_id: number;
    title: string;
    file_path: string | null;
    file_type: string | null;
    status: string;
  }>(
    'SELECT id, user_id, title, file_path, file_type, status FROM books WHERE id = ? AND user_id = ? AND is_content_source = 0',
    id,
    user.id,
  );
  if (!book) {
    res.status(404).json({ error: { message: 'الكتاب غير موجود.' } });
    return null;
  }
  return { user, book };
}

async function cleanupTemps(files: Array<{ path?: string }> | undefined): Promise<void> {
  if (!files) return;
  for (const file of files) {
    if (file.path) await removeFile(file.path);
  }
}

booksRouter.get('/books', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const rows = all<BookListRow>(
    `${bookSelect} WHERE b.user_id = ? AND b.is_content_source = 0 ORDER BY b.created_at DESC, b.id DESC`,
    user.id,
  );
  res.json({ books: rows.map(serializeBook) });
});

const optionalId = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

function validateMeta(values: {
  subjectId: number | null;
  gradeLevelId: number | null;
  semesterId: number | null;
}): void {
  if (values.subjectId) {
    const subject = get<{ id: number }>('SELECT id FROM subjects WHERE id = ? AND is_active = 1', values.subjectId);
    if (!subject) throw new HttpError(400, 'المادة المختارة غير متاحة.');
  }
  if (values.gradeLevelId) {
    const grade = get<{ id: number }>('SELECT id FROM grade_levels WHERE id = ? AND is_active = 1', values.gradeLevelId);
    if (!grade) throw new HttpError(400, 'الصف المختار غير متاح.');
  }
  if (values.semesterId) {
    const semester = get<{ id: number }>('SELECT id FROM semesters WHERE id = ? AND is_active = 1', values.semesterId);
    if (!semester) throw new HttpError(400, 'الفصل الدراسي المختار غير متاح.');
  }
}

booksRouter.post(
  '/books',
  rateLimit({ key: 'book-upload', limit: 30, windowMs: 60 * 60 * 1000 }),
  (req, res, next) => {
    upload.array('files', MAX_FILES_PER_BOOK)(req, res, (error: unknown) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          next(new HttpError(400, `حجم الملف كبير جدًا. الحد الأقصى ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} ميغابايت للملف.`));
          return;
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
          next(new HttpError(400, `الحد الأقصى ${MAX_FILES_PER_BOOK} ملفًا في الرفع الواحد.`));
          return;
        }
        next(new HttpError(400, 'تعذّر استلام الملف.')) ;
        return;
      }
      next(error);
    });
  },
  async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    try {
      if (files.length === 0) throw new HttpError(400, 'اختر ملفًا واحدًا على الأقل (PDF أو صور صفحات).');

      const title = String(req.body?.title ?? '').trim();
      if (title.length < 2) throw new HttpError(400, 'اسم الكتاب مطلوب (حرفان على الأقل).');
      if (title.length > 160) throw new HttpError(400, 'اسم الكتاب طويل جدًا.');

      const subjectId = optionalId(req.body?.subjectId);
      const gradeLevelId = optionalId(req.body?.gradeLevelId);
      const semesterId = optionalId(req.body?.semesterId);
      const unitName = String(req.body?.unitName ?? '').trim() || null;
      validateMeta({ subjectId, gradeLevelId, semesterId });

      const hasPdf = files.some((file) => extname(file.originalname).toLowerCase() === '.pdf');
      if (hasPdf && files.length > 1) {
        throw new HttpError(400, 'ملف PDF يُرفع منفردًا. لرفع صفحات مصورة أضفها كصور في رفع منفصل.');
      }
      const fileType = hasPdf ? 'pdf' : 'images';
      const primary = files[0];
      const hash = await sha256File(primary.path);

      const duplicate = get<{ id: number; title: string }>(
        'SELECT id, title FROM books WHERE user_id = ? AND content_hash = ?',
        user.id,
        hash,
      );
      if (duplicate) {
        throw new HttpError(409, `هذا الملف موجود لديك مسبقًا بعنوان «${duplicate.title}». لن يتم رفعه مرة أخرى.`);
      }

      const created = run(
        `INSERT INTO books (user_id, subject_id, grade_level_id, semester_id, title, unit_name, file_type, status, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        user.id,
        subjectId,
        gradeLevelId,
        semesterId,
        title,
        unitName,
        fileType,
        hash,
      );
      const bookId = created.lastInsertRowid;
      const directory = ensureBookDirectory(user.id, bookId);

      let totalBytes = 0;
      if (fileType === 'pdf') {
        const destination = join(directory, 'source.pdf');
        await moveFile(primary.path, destination);
        totalBytes = await fileSize(destination);
        run('UPDATE books SET file_path = ?, size_bytes = ? WHERE id = ?', destination, totalBytes, bookId);
      } else {
        const ordered = [...files].sort((a, b) =>
          a.originalname.localeCompare(b.originalname, 'ar', { numeric: true }),
        );
        let pageNumber = 1;
        for (const file of ordered) {
          const extension = extname(file.originalname).toLowerCase();
          const destination = join(directory, `page-${String(pageNumber).padStart(3, '0')}${extension}`);
          await moveFile(file.path, destination);
          const size = await fileSize(destination);
          totalBytes += size;
          run(
            'INSERT INTO book_pages (book_id, page_number, image_path, ocr_status) VALUES (?, ?, ?, ?)',
            bookId,
            pageNumber,
            destination,
            'pending',
          );
          pageNumber += 1;
        }
        run(
          'UPDATE books SET file_path = ?, size_bytes = ?, pages_count = ? WHERE id = ?',
          directory,
          totalBytes,
          ordered.length,
          bookId,
        );
      }

      logActivity(
        user.id,
        'books',
        `رفع كتاب «${title}»`,
        fileType === 'pdf' ? 'ملف PDF' : `${files.length} صورة صفحة`,
      );
      enqueueBook(bookId);

      const row = get<BookListRow>(`${bookSelect} WHERE b.id = ?`, bookId);
      res.status(201).json({ book: row ? serializeBook(row) : null });
    } catch (error) {
      await cleanupTemps(files);
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: { message: error.message } });
        return;
      }
      console.error('[nerd/books] فشل رفع الكتاب:', error);
      res.status(500).json({ error: { message: 'تعذّر حفظ الكتاب. حاول مرة أخرى.' } });
    }
  },
);

booksRouter.get('/books/:id', (req, res) => {
  const owned = ownedBook(req, res);
  if (!owned) return;

  const row = get<BookListRow>(`${bookSelect} WHERE b.id = ?`, owned.book.id);
  if (!row) {
    res.status(404).json({ error: { message: 'الكتاب غير موجود.' } });
    return;
  }

  const pages = all<{
    page_number: number;
    ocr_status: string;
    error_message: string | null;
    text_content: string | null;
    image_path: string | null;
  }>(
    'SELECT page_number, ocr_status, error_message, text_content, image_path FROM book_pages WHERE book_id = ? ORDER BY page_number',
    owned.book.id,
  );

  res.json({
    book: serializeBook(row),
    pages: pages.map((page) => ({
      pageNumber: page.page_number,
      status: page.ocr_status,
      errorMessage: page.error_message,
      hasImage: Boolean(page.image_path),
      chars: page.text_content?.length ?? 0,
      preview: (page.text_content ?? '').slice(0, 140),
    })),
  });
});

booksRouter.get('/books/:id/pages/:pageNumber', (req, res) => {
  const owned = ownedBook(req, res);
  if (!owned) return;
  const pageNumber = Number(req.params.pageNumber);
  if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
    res.status(400).json({ error: { message: 'رقم الصفحة غير صحيح.' } });
    return;
  }
  const page = get<{
    page_number: number;
    text_content: string | null;
    ocr_status: string;
    error_message: string | null;
    image_path: string | null;
  }>(
    'SELECT page_number, text_content, ocr_status, error_message, image_path FROM book_pages WHERE book_id = ? AND page_number = ?',
    owned.book.id,
    pageNumber,
  );
  if (!page) {
    res.status(404).json({ error: { message: 'الصفحة غير موجودة.' } });
    return;
  }
  res.json({
    page: {
      pageNumber: page.page_number,
      text: page.text_content ?? '',
      status: page.ocr_status,
      errorMessage: page.error_message,
      hasImage: Boolean(page.image_path),
    },
  });
});

booksRouter.get('/books/:id/pages/:pageNumber/image', (req, res) => {
  const owned = ownedBook(req, res);
  if (!owned) return;
  const pageNumber = Number(req.params.pageNumber);
  const page = get<{ image_path: string | null }>(
    'SELECT image_path FROM book_pages WHERE book_id = ? AND page_number = ?',
    owned.book.id,
    pageNumber,
  );
  if (!page?.image_path) {
    res.status(404).json({ error: { message: 'لا توجد صورة لهذه الصفحة.' } });
    return;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(page.image_path);
});

booksRouter.get('/books/:id/file', (req, res) => {
  const owned = ownedBook(req, res);
  if (!owned) return;
  if (owned.book.file_type !== 'pdf' || !owned.book.file_path) {
    res.status(404).json({ error: { message: 'لا يوجد ملف PDF لهذا الكتاب.' } });
    return;
  }
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(owned.book.file_path);
});

const updateSchema = z.object({
  title: z.string().trim().min(2, 'اسم الكتاب قصير جدًا.').max(160).optional(),
  unitName: z.string().trim().max(120).nullable().optional(),
  subjectId: z.number().int().positive().nullable().optional(),
  gradeLevelId: z.number().int().positive().nullable().optional(),
  semesterId: z.number().int().positive().nullable().optional(),
});

booksRouter.patch('/books/:id', (req, res, next) => {
  try {
    const owned = ownedBook(req, res);
    if (!owned) return;
    const payload = updateSchema.parse(req.body);

    validateMeta({
      subjectId: payload.subjectId ?? null,
      gradeLevelId: payload.gradeLevelId ?? null,
      semesterId: payload.semesterId ?? null,
    });

    const updates: string[] = [];
    const params: Array<string | number | null> = [];
    if (payload.title !== undefined) {
      updates.push('title = ?');
      params.push(payload.title);
    }
    if (payload.unitName !== undefined) {
      updates.push('unit_name = ?');
      params.push(payload.unitName);
    }
    if (payload.subjectId !== undefined) {
      updates.push('subject_id = ?');
      params.push(payload.subjectId);
    }
    if (payload.gradeLevelId !== undefined) {
      updates.push('grade_level_id = ?');
      params.push(payload.gradeLevelId);
    }
    if (payload.semesterId !== undefined) {
      updates.push('semester_id = ?');
      params.push(payload.semesterId);
    }

    if (updates.length === 0) throw new HttpError(400, 'لا توجد بيانات للتعديل.');

    updates.push('updated_at = ?');
    params.push(nowIso());
    params.push(owned.book.id);
    run(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`, ...params);

    const row = get<BookListRow>(`${bookSelect} WHERE b.id = ?`, owned.book.id);
    res.json({ book: row ? serializeBook(row) : null });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { message: error.issues[0]?.message ?? 'بيانات غير صحيحة.' } });
      return;
    }
    next(error);
  }
});

booksRouter.delete('/books/:id', async (req, res) => {
  const owned = ownedBook(req, res);
  if (!owned) return;
  await removeBookDirectory(owned.user.id, owned.book.id);
  run('DELETE FROM books WHERE id = ?', owned.book.id);
  logActivity(owned.user.id, 'books', `حذف كتاب «${owned.book.title}»`, 'حُذفت الصفحات والمقاطع والملفات.');
  res.json({ ok: true });
});

booksRouter.post('/books/:id/reprocess', (req, res) => {
  const owned = ownedBook(req, res);
  if (!owned) return;
  if (owned.book.status === 'extracting' || owned.book.status === 'pending') {
    res.status(409).json({ error: { message: 'الكتاب قيد المعالجة حاليًا.' } });
    return;
  }
  resetBook(owned.book.id);
  enqueueBook(owned.book.id);
  createNotification(
    owned.user.id,
    'books',
    'أُعيدت معالجة كتاب',
    `بدأت إعادة معالجة «${owned.book.title}».`,
  );
  res.status(202).json({ ok: true });
});

booksRouter.get('/books/:id/search', (req, res) => {
  const owned = ownedBook(req, res);
  if (!owned) return;
  const query = String(req.query.q ?? '').trim();
  if (query.length < 2) {
    res.status(400).json({ error: { message: 'اكتب كلمتين على الأقل للبحث.' } });
    return;
  }
  const normalized = normalizeArabic(query);
  const rows = all<{ content: string; page_from: number; page_to: number; chunk_index: number }>(
    `SELECT content, page_from, page_to, chunk_index FROM document_chunks
      WHERE book_id = ? AND content_search LIKE ?
      ORDER BY page_from, chunk_index
      LIMIT 30`,
    owned.book.id,
    `%${normalized}%`,
  );
  res.json({
    query,
    results: rows.map((row) => ({
      pageFrom: row.page_from,
      pageTo: row.page_to,
      snippet: buildSnippet(row.content, query),
    })),
  });
});
