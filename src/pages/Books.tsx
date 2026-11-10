import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, FileText, RefreshCcw, Trash2, Upload } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, EmptyState, FullPageLoader, PageHeader, Progress } from '../components/ui.tsx';
import { api, ApiError, formatDate, formatBytes } from '../lib/api.ts';
import type { Book } from '../lib/bookTypes.ts';

export const statusLabels: Record<Book['status'], string> = {
  uploading: 'جاري الرفع',
  pending: 'بانتظار المعالجة',
  extracting: 'جاري استخراج النص',
  ready: 'اكتملت المعالجة',
  failed: 'فشلت المعالجة',
};

export function StatusChip({ status }: { status: Book['status'] }) {
  const tone =
    status === 'ready'
      ? { color: 'var(--color-ok)', borderColor: 'var(--color-ok)' }
      : status === 'failed'
        ? { color: 'var(--color-bad)', borderColor: 'var(--color-bad)' }
        : { color: 'var(--color-warn)', borderColor: 'var(--color-warn)' };
  return (
    <span className="badge" style={tone}>
      {statusLabels[status]}
    </span>
  );
}

export default function BooksPage() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ books: Book[] }>('/books');
      setBooks(data.books);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الكتب.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const processing = books?.some((book) => book.status === 'pending' || book.status === 'extracting');

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [processing, load]);

  async function reprocess(book: Book) {
    if (busyId) return;
    setBusyId(book.id);
    setError(null);
    try {
      await api.post(`/books/${book.id}/reprocess`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّرت إعادة المعالجة.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(book: Book) {
    if (busyId) return;
    if (!window.confirm(`حذف «${book.title}» مع كل صفحاته ومقاطعه وملفاته؟ لا يمكن التراجع.`)) return;
    setBusyId(book.id);
    setError(null);
    try {
      await api.del(`/books/${book.id}`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حذف الكتاب.');
    } finally {
      setBusyId(null);
    }
  }

  const stats = useMemo(() => {
    const list = books ?? [];
    return {
      total: list.length,
      ready: list.filter((book) => book.status === 'ready').length,
      processing: list.filter((book) => book.status === 'pending' || book.status === 'extracting').length,
      pages: list.reduce((sum, book) => sum + book.pagesCount, 0),
      chunks: list.reduce((sum, book) => sum + book.chunksCount, 0),
    };
  }, [books]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="مكتبتك"
        title="الكتب الدراسية"
        subtitle="ارفع كتبك (PDF أو صور صفحات) ثم استخدمها في الملخصات والأسئلة والاختبارات."
        actions={
          <Link to="/books/upload" className="btn btn-primary">
            <Upload size={16} />
            رفع كتاب
          </Link>
        }
      />

      {error && <Alert>{error}</Alert>}

      {books && books.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatBox label="الكتب" value={stats.total} tint="blue" />
          <StatBox label="جاهزة للاستخدام" value={stats.ready} tint="mint" />
          <StatBox label="قيد المعالجة" value={stats.processing} tint="yellow" />
          <StatBox label="إجمالي الصفحات" value={stats.pages} tint="lavender" />
          <StatBox label="المقاطع النصية" value={stats.chunks} tint="pink" />
        </div>
      )}

      {!books ? (
        <FullPageLoader label="جار تحميل كتبك…" />
      ) : books.length === 0 ? (
        <EmptyState
          title="لا توجد كتب بعد"
          body="ارفع كتابًا بصيغة PDF يحتوي نصًا، أو صور صفحات كتابك (JPG/PNG/WEBP) وسيستخرج النظام النص منها."
          icon={<BookOpen size={26} />}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {books.map((book) => {
            const percent =
              book.pagesCount > 0 ? Math.round((book.processedPages / book.pagesCount) * 100) : 0;
            return (
              <div key={book.id} className="card card-hover book-card flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/books/${book.id}`} className="line-clamp-2 font-semibold hover:underline">
                      {book.title}
                    </Link>
                    <p className="muted mt-1 text-xs">
                      {[book.subjectName, book.gradeName, book.semesterName].filter(Boolean).join(' • ') ||
                        'بدون تصنيف'}
                    </p>
                  </div>
                  <StatusChip status={book.status} />
                </div>

                <div className="muted flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                  <span className="inline-flex items-center gap-1">
                    <FileText size={12} />
                    {book.fileType === 'pdf' ? 'PDF' : 'صور'}
                  </span>
                  <span>{book.pagesCount} صفحة</span>
                  <span>{formatBytes(book.sizeBytes)}</span>
                  <span>{formatDate(book.createdAt)}</span>
                </div>

                {(book.status === 'pending' || book.status === 'extracting') && (
                  <div>
                    <div className="muted mb-1 flex justify-between text-[11px]">
                      <span>جار استخراج النص…</span>
                      <span>{percent}%</span>
                    </div>
                    <Progress value={book.processedPages} max={Math.max(book.pagesCount, 1)} />
                  </div>
                )}

                {book.status === 'failed' && book.errorMessage && (
                  <p className="alert alert-error alert-compact text-[11px] leading-5">
                    {book.errorMessage}
                  </p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Link to={`/books/${book.id}`} className="btn btn-ghost min-h-9 px-3 text-xs">
                    فتح الكتاب
                  </Link>
                  <button
                    type="button"
                    className="btn btn-ghost min-h-9 px-3 text-xs"
                    disabled={busyId === book.id || processing}
                    onClick={() => void reprocess(book)}
                  >
                    <RefreshCcw size={13} />
                    إعادة المعالجة
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost min-h-9 px-3 text-xs"
                    style={{ color: 'var(--color-bad)' }}
                    disabled={busyId === book.id}
                    onClick={() => void remove(book)}
                  >
                    <Trash2 size={13} />
                    حذف
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function StatBox({
  label,
  value,
  tint = 'yellow',
}: {
  label: string;
  value: number;
  tint?: 'yellow' | 'blue' | 'mint' | 'pink' | 'lavender';
}) {
  const colors: Record<string, string> = {
    yellow: 'var(--yellow)',
    blue: 'var(--blue)',
    mint: 'var(--mint)',
    pink: 'var(--pink)',
    lavender: 'var(--lavender)',
  };
  return (
    <div className="stat-tile" style={{ borderColor: 'var(--line)' }}>
      <p className="muted text-[11px] leading-5">{label}</p>
      <div className="flex items-end justify-between gap-1">
        <p className="stat-value">{value}</p>
        <span
          className="mb-1 size-3 rounded-full border-2 border-[var(--line)]"
          style={{ background: colors[tint] }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
