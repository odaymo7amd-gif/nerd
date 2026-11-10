import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, HardDrive, Layers, RefreshCcw, Search, Sparkles, Trash2 } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, Field, FullPageLoader, PageHeader, Progress, StatTile } from '../components/ui.tsx';
import { api, ApiError, formatBytes, formatDate } from '../lib/api.ts';
import type { BookDetail, BookSearchResult } from '../lib/bookTypes.ts';
import type { MetaPayload } from '../lib/types.ts';
import { StatusChip } from './Books.tsx';

export default function BookViewPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [meta, setMeta] = useState<MetaPayload | null>(null);
  const [selectedPage, setSelectedPage] = useState(1);
  const [pageText, setPageText] = useState('');
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookSearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: '', unitName: '', subjectId: '', gradeLevelId: '', semesterId: '' });

  const load = useCallback(async () => {
    try {
      const data = await api.get<BookDetail>(`/books/${id}`);
      setDetail(data);
      setForm({
        title: data.book.title,
        unitName: data.book.unitName ?? '',
        subjectId: '',
        gradeLevelId: '',
        semesterId: '',
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الكتاب.');
    }
  }, [id]);

  useEffect(() => {
    void load();
    api
      .get<MetaPayload>('/meta')
      .then(setMeta)
      .catch(() => undefined);
  }, [load]);

  const processing = detail?.book.status === 'pending' || detail?.book.status === 'extracting';

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [processing, load]);

  const loadPage = useCallback(
    async (pageNumber: number) => {
      setPageLoading(true);
      setError(null);
      try {
        const data = await api.get<{ page: { pageNumber: number; text: string } }>(
          `/books/${id}/pages/${pageNumber}`,
        );
        setPageText(data.page.text);
        setSelectedPage(pageNumber);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الصفحة.');
      } finally {
        setPageLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    if (!detail?.pages.length) return;
    const requested = Number(searchParams.get('page'));
    const exists = detail.pages.some((page) => page.pageNumber === requested);
    void loadPage(exists ? requested : detail.pages[0].pageNumber);
  }, [detail?.book.status, detail?.pages.length, loadPage, searchParams]);

  async function search() {
    if (query.trim().length < 2) {
      setError('اكتب كلمتين على الأقل للبحث داخل الكتاب.');
      return;
    }
    setError(null);
    try {
      const data = await api.get<{ results: BookSearchResult[] }>(
        `/books/${id}/search?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(data.results);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر البحث.');
    }
  }

  async function saveMeta() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/books/${id}`, {
        title: form.title.trim(),
        unitName: form.unitName.trim() || null,
        ...(form.subjectId ? { subjectId: Number(form.subjectId) } : {}),
        ...(form.gradeLevelId ? { gradeLevelId: Number(form.gradeLevelId) } : {}),
        ...(form.semesterId ? { semesterId: Number(form.semesterId) } : {}),
      });
      setEditing(false);
      setNotice('تم تحديث بيانات الكتاب دون إعادة معالجة المحتوى.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حفظ البيانات.');
    } finally {
      setBusy(false);
    }
  }

  async function reprocess() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/books/${id}/reprocess`);
      setResults(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّرت إعادة المعالجة.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    if (!window.confirm('حذف الكتاب مع كل صفحاته ومقاطعه وملفاته؟')) return;
    setBusy(true);
    try {
      await api.del(`/books/${id}`);
      navigate('/books', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حذف الكتاب.');
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <AppShell>
        {error ? <Alert>{error}</Alert> : <FullPageLoader label="جار تحميل الكتاب…" />}
      </AppShell>
    );
  }

  const { book, pages } = detail;
  const percent = book.pagesCount > 0 ? Math.round((book.processedPages / book.pagesCount) * 100) : 0;
  const current = pages.find((page) => page.pageNumber === selectedPage);
  const failedPages = pages.filter((page) => page.status === 'failed').length;
  const emptyPages = pages.filter((page) => page.status === 'empty').length;
  const curriculum = meta?.curricula[0];

  return (
    <AppShell>
      <Link to="/books" className="muted inline-flex items-center gap-1 text-sm">
        <ArrowRight size={15} />
        كل الكتب
      </Link>

      <PageHeader
        eyebrow="كتاب"
        title={book.title}
        subtitle={[book.subjectName, book.gradeName, book.semesterName, book.unitName]
          .filter(Boolean)
          .join(' • ')}
        actions={
          <div className="flex items-center gap-2">
            <StatusChip status={book.status} />
            {book.status === 'ready' && book.chunksCount > 0 && (
              <Link to={`/summary?bookId=${book.id}`} className="btn btn-ghost min-h-9 px-3 text-xs">
                <Sparkles size={13} />
                ملخص الكتاب
              </Link>
            )}
          </div>
        }
      />

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {processing && (
        <div className="card p-4">
          <div className="muted mb-1 flex justify-between text-xs">
            <span>جار استخراج النص وبناء المقاطع…</span>
            <span>
              {book.processedPages}/{book.pagesCount} صفحة ({percent}%)
            </span>
          </div>
          <Progress value={book.processedPages} max={Math.max(book.pagesCount, 1)} />
          <p className="muted mt-2 text-[11px]">
            يمكنك مغادرة الصفحة؛ المعالجة تستمر في الخادم وتُحدَّث الحالة عند عودتك.
          </p>
        </div>
      )}

      {book.status === 'failed' && (
        <div className="card p-4">
          <p className="font-semibold text-[var(--color-bad)]">فشلت المعالجة</p>
          <p className="mt-1 text-sm">{book.errorMessage ?? 'سبب غير معروف.'}</p>
          <button type="button" className="btn btn-ghost mt-3 min-h-9 px-3 text-xs" onClick={() => void reprocess()}>
            <RefreshCcw size={13} />
            إعادة المحاولة
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <StatTile icon={<BookOpen size={15} />} tint="blue" label="الصفحات" value={String(book.pagesCount)} />
        <StatTile icon={<Layers size={15} />} tint="lavender" label="المقاطع النصية" value={String(book.chunksCount)} />
        <StatTile icon={<HardDrive size={15} />} tint="pink" label="حجم الملفات" value={formatBytes(book.sizeBytes)} />
        <StatTile icon={<CalendarDays size={15} />} tint="mint" label="تاريخ الرفع" value={formatDate(book.createdAt)} />
      </div>

      {(failedPages > 0 || emptyPages > 0) && (
        <Alert tone="info">
          {failedPages > 0 && `${failedPages} صفحة فشل استخراجها. `}
          {emptyPages > 0 && `${emptyPages} صفحة بلا نص واضح (قد تكون صورة غير مقروءة). `}
          يمكنك إعادة المعالجة، أو رفع تلك الصفحات كصور عالية الوضوح.
        </Alert>
      )}

      <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
        <aside className="card max-h-[70vh] overflow-auto p-2">
          <p className="muted px-2 py-1 text-xs">الصفحات</p>
          <ul className="space-y-0.5">
            {pages.map((page) => (
              <li key={page.pageNumber}>
                <button
                  type="button"
                  onClick={() => void loadPage(page.pageNumber)}
                  aria-current={page.pageNumber === selectedPage ? 'page' : undefined}
                  className={`page-item ${page.pageNumber === selectedPage ? 'is-active' : ''}`}
                >
                  <span>صفحة {page.pageNumber}</span>
                  <span
                    className="size-2.5 rounded-full border border-[var(--line)]"
                    style={{
                      background:
                        page.status === 'done'
                          ? 'var(--color-ok)'
                          : page.status === 'failed'
                            ? 'var(--color-bad)'
                            : page.status === 'empty'
                              ? 'var(--color-warn)'
                              : 'var(--line-soft)',
                    }}
                    title={
                      page.status === 'done'
                        ? 'نص مستخرج'
                        : page.status === 'failed'
                          ? 'فشل'
                          : page.status === 'empty'
                            ? 'بلا نص'
                            : 'بانتظار المعالجة'
                    }
                  />
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="card min-h-[320px] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="font-semibold">
              صفحة {selectedPage}
              {current?.status === 'empty' && <span className="badge ms-2">بلا نص</span>}
              {current?.status === 'failed' && <span className="badge ms-2">فشل</span>}
            </p>
            {current?.hasImage && (
              <a
                href={`/api/books/${book.id}/pages/${selectedPage}/image`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost min-h-8 px-2.5 text-[11px]"
              >
                عرض صورة الصفحة
              </a>
            )}
            {book.fileType === 'pdf' && (
              <a
                href={`/api/books/${book.id}/file`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost min-h-8 px-2.5 text-[11px]"
              >
                فتح ملف PDF
              </a>
            )}
            {current?.errorMessage && (
              <span className="muted text-[11px]">سبب الفشل: {current.errorMessage}</span>
            )}
          </div>

          {current?.hasImage && (
            <img
              src={`/api/books/${book.id}/pages/${selectedPage}/image`}
              alt={`صفحة ${selectedPage}`}
              className="mb-3 max-h-80 w-full rounded-[14px_10px_16px_9px] border-2 border-[var(--line)] bg-[var(--surface-solid)] object-contain shadow-[var(--shadow-xs)]"
            />
          )}

          {pageLoading ? (
            <p className="muted text-sm">جار تحميل النص…</p>
          ) : pageText ? (
            <div dir="auto" className="reader-text">
              {pageText}
            </div>
          ) : (
            <p className="muted text-sm">
              {current?.status === 'pending'
                ? 'الصفحة بانتظار المعالجة.'
                : 'لا يوجد نص مستخرج لهذه الصفحة.'}
            </p>
          )}
        </section>
      </div>

      <section className="card p-4">
        <h3 className="mb-2 font-bold">البحث داخل الكتاب</h3>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <input
            className="input"
            placeholder="ابحث عن كلمة أو عبارة…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="btn btn-ghost shrink-0">
            <Search size={16} />
            بحث
          </button>
        </form>

        {results && (
          <div className="mt-3">
            {results.length === 0 ? (
              <p className="muted text-sm">لا نتائج داخل هذا الكتاب.</p>
            ) : (
              <ul className="space-y-2">
                {results.map((result, index) => (
                  <li key={`${result.pageFrom}-${index}`}>
                    <button
                      type="button"
                      onClick={() => void loadPage(result.pageFrom)}
                      className="w-full rounded-[13px_9px_15px_10px] border-2 border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-start text-sm shadow-[var(--shadow-xs)] transition hover:-translate-y-0.5 hover:bg-[var(--surface-hover)]"
                    >
                      <span className="badge mb-1">صفحة {result.pageFrom}</span>
                      <span className="block leading-7" dir="auto">
                        {result.snippet}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold">بيانات الكتاب</h3>
          <button
            type="button"
            className="btn btn-ghost min-h-8 px-2.5 text-[11px]"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? 'إلغاء' : 'تعديل'}
          </button>
        </div>

        {editing ? (
          <div className="space-y-3">
            <Field label="اسم الكتاب" htmlFor="editTitle">
              <input
                id="editTitle"
                className="input"
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="المادة" htmlFor="editSubject">
                <select
                  id="editSubject"
                  className="input"
                  value={form.subjectId}
                  onChange={(event) => setForm((current) => ({ ...current, subjectId: event.target.value }))}
                >
                  <option value="">— بدون تغيير —</option>
                  {curriculum?.subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="الصف" htmlFor="editGrade">
                <select
                  id="editGrade"
                  className="input"
                  value={form.gradeLevelId}
                  onChange={(event) => setForm((current) => ({ ...current, gradeLevelId: event.target.value }))}
                >
                  <option value="">— بدون تغيير —</option>
                  {curriculum?.grades.map((grade) => (
                    <option key={grade.id} value={grade.id}>
                      {grade.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="الفصل" htmlFor="editSemester">
                <select
                  id="editSemester"
                  className="input"
                  value={form.semesterId}
                  onChange={(event) => setForm((current) => ({ ...current, semesterId: event.target.value }))}
                >
                  <option value="">— بدون تغيير —</option>
                  {curriculum?.semesters.map((semester) => (
                    <option key={semester.id} value={semester.id}>
                      {semester.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="الوحدة أو الفصل" htmlFor="editUnit">
              <input
                id="editUnit"
                className="input"
                value={form.unitName}
                onChange={(event) => setForm((current) => ({ ...current, unitName: event.target.value }))}
              />
            </Field>
            <button type="button" className="btn btn-primary sm:w-40" onClick={() => void saveMeta()} disabled={busy}>
              حفظ التعديل
            </button>
            <p className="muted text-xs">تعديل البيانات لا يعيد معالجة الكتاب أو استخراج النص.</p>
          </div>
        ) : (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2 rounded-[12px_9px_13px_8px] border-2 border-[var(--line-soft)] px-3 py-2">
              <dt className="muted">الوحدة</dt>
              <dd>{book.unitName ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-2 rounded-[12px_9px_13px_8px] border-2 border-[var(--line-soft)] px-3 py-2">
              <dt className="muted">نوع الملف</dt>
              <dd>{book.fileType === 'pdf' ? 'PDF' : 'صور صفحات'}</dd>
            </div>
            <div className="flex justify-between gap-2 rounded-[12px_9px_13px_8px] border-2 border-[var(--line-soft)] px-3 py-2">
              <dt className="muted">آخر تحديث</dt>
              <dd>{formatDate(book.updatedAt)}</dd>
            </div>
            <div className="flex justify-between gap-2 rounded-[12px_9px_13px_8px] border-2 border-[var(--line-soft)] px-3 py-2">
              <dt className="muted">عدد الصفحات المعالجة</dt>
              <dd>
                {book.processedPages}/{book.pagesCount}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="font-semibold">إعادة المعالجة أو الحذف</p>
          <p className="muted text-xs">
            إعادة المعالجة تحذف النص والمقاطع السابقة وتستخرجها من جديد من نفس الملفات.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-ghost min-h-9 px-3 text-xs"
            onClick={() => void reprocess()}
            disabled={busy || processing}
          >
            <RefreshCcw size={13} />
            إعادة المعالجة
          </button>
          <button
            type="button"
            className="btn btn-ghost min-h-9 px-3 text-xs"
            style={{ color: 'var(--color-bad)' }}
            onClick={() => void remove()}
            disabled={busy}
          >
            <Trash2 size={13} />
            حذف الكتاب
          </button>
        </div>
      </section>
    </AppShell>
  );
}
