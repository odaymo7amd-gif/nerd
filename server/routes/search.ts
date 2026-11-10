// البحث الشامل في بيانات المستخدم فقط: المحتوى، الكتب، الملخصات، الاختبارات،
// الأسئلة والمحادثات. كل نتيجة تحمل رابطًا مباشرًا، ولا تُعاد بيانات حساب آخر.

import { Router } from 'express';
import { all } from '../db.ts';
import { requireUser } from '../auth.ts';
import { HttpError } from '../http.ts';
import { normalizeArabic } from '../chunking.ts';

export const searchRouter = Router();

interface SearchItem {
  id: number;
  title: string;
  subtitle: string | null;
  href: string;
  meta: string | null;
}

function normal(value: string | null | undefined): string {
  return normalizeArabic(value ?? '');
}

function matches(query: string, ...values: Array<string | null | undefined>): boolean {
  return values.some((value) => normal(value).includes(query));
}

function group(key: string, label: string, items: SearchItem[]) {
  return { key, label, count: items.length, items };
}

const SOURCE_LABELS: Record<string, string> = {
  images: 'صور',
  video: 'فيديو',
  text: 'نص',
  pdf: 'PDF',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  pending: 'في الانتظار',
  extracting: 'قيد المعالجة',
  ready: 'جاهز',
  needs_review: 'يحتاج مراجعة',
  failed: 'تعذّرت المعالجة',
  in_progress: 'قيد التنفيذ',
  finished: 'منتهٍ',
};

const TYPE_LABELS: Record<string, string> = {
  mcq: 'اختيار من متعدد',
  true_false: 'صح أو خطأ',
  short: 'إجابة قصيرة',
  essay: 'مقالي',
  fill_blank: 'أكمل الفراغ',
  matching: 'مطابقة',
  ordering: 'ترتيب',
  explain: 'علّل',
};

searchRouter.get('/search', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const raw = String(req.query.q ?? '').trim();
  if (raw.length < 2) {
    throw new HttpError(400, 'اكتب حرفين على الأقل للبحث.');
  }
  const query = normal(raw);
  if (query.length < 2) {
    throw new HttpError(400, 'اكتب حرفين عربيين أو أكثر للبحث.');
  }
  const like = `%${raw}%`;

  const contents = all<{
    id: number;
    title: string;
    source_type: string;
    status: string;
    updated_at: string;
  }>(
    `SELECT id, title, source_type, status, updated_at
       FROM study_contents
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT 300`,
    user.id,
  )
    .filter((row) => matches(query, row.title))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: `محتوى دراسي · ${SOURCE_LABELS[row.source_type] ?? row.source_type}`,
      href: `/content/${row.id}`,
      meta: STATUS_LABELS[row.status] ?? row.status,
    }));

  const books = all<{ id: number; title: string; pages_count: number; status: string }>(
    `SELECT id, title, pages_count, status
       FROM books
      WHERE user_id = ? AND is_content_source = 0
      ORDER BY created_at DESC
      LIMIT 200`,
    user.id,
  )
    .filter((row) => matches(query, row.title))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: `كتاب · ${row.pages_count} صفحة`,
      href: `/books/${row.id}`,
      meta: STATUS_LABELS[row.status] ?? row.status,
    }));

  const summaries = all<{
    id: number;
    title: string;
    content: string;
    content_id: number | null;
    book_id: number | null;
  }>(
    `SELECT id, title, content, content_id, book_id
       FROM summaries
      WHERE user_id = ? AND (title LIKE ? OR content LIKE ?)
      ORDER BY created_at DESC
      LIMIT 100`,
    user.id,
    like,
    like,
  )
    .filter((row) => matches(query, row.title, row.content))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: 'ملخص ذكي',
      href: `/summary/${row.id}`,
      meta: row.content_id ? 'من محتوى' : row.book_id ? 'من كتاب' : null,
    }));

  const tests = all<{ id: number; title: string; questions_count: number; status: string }>(
    `SELECT id, title, questions_count, status
       FROM tests
      WHERE user_id = ? AND title LIKE ?
      ORDER BY created_at DESC
      LIMIT 100`,
    user.id,
    like,
  )
    .filter((row) => matches(query, row.title))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: `اختبار · ${row.questions_count} سؤالًا`,
      href: `/tests/${row.id}`,
      meta: STATUS_LABELS[row.status] ?? row.status,
    }));

  const questions = all<{ id: number; text: string; type: string; explanation: string | null }>(
    `SELECT id, text, type, explanation
       FROM questions
      WHERE user_id = ? AND (text LIKE ? OR COALESCE(explanation, '') LIKE ?)
      ORDER BY created_at DESC
      LIMIT 100`,
    user.id,
    like,
    like,
  )
    .filter((row) => matches(query, row.text, row.explanation))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      title: row.text.slice(0, 180),
      subtitle: 'سؤال في بنك الأسئلة',
      href: '/bank',
      meta: TYPE_LABELS[row.type] ?? row.type,
    }));

  const conversations = all<{
    id: number;
    title: string;
    message: string | null;
    updated_at: string;
  }>(
    `SELECT c.id, c.title,
            (SELECT m.content FROM chat_messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.id DESC LIMIT 1) AS message,
            c.updated_at
       FROM chat_conversations c
      WHERE c.user_id = ?
        AND (c.title LIKE ? OR EXISTS (
          SELECT 1 FROM chat_messages m
           WHERE m.conversation_id = c.id AND m.content LIKE ?
        ))
      ORDER BY c.updated_at DESC
      LIMIT 100`,
    user.id,
    like,
    like,
  )
    .filter((row) => matches(query, row.title, row.message))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.message ? row.message.slice(0, 140) : 'محادثة تعليمية',
      href: `/assistant?conversation=${row.id}`,
      meta: 'محادثة',
    }));

  const groups = [
    group('contents', 'محتواي الدراسي', contents),
    group('books', 'الكتب', books),
    group('summaries', 'الملخصات', summaries),
    group('tests', 'الاختبارات', tests),
    group('questions', 'بنك الأسئلة', questions),
    group('conversations', 'المحادثات', conversations),
  ].filter((item) => item.count > 0);

  res.json({
    query: raw,
    total: groups.reduce((sum, item) => sum + item.count, 0),
    groups,
  });
});
