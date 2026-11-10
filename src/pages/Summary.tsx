import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  FileText,
  GitCompare,
  Layers,
  ListChecks,
  Loader2,
  PenLine,
  Shapes,
  Sparkles,
  Zap,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { MarkdownText } from '../components/MarkdownText.tsx';
import { StudySourcePicker } from '../components/StudySourcePicker.tsx';
import { Alert, Field, PageHeader } from '../components/ui.tsx';
import { api, ApiError, formatDateTime } from '../lib/api.ts';
import { aiApi, isKeyProblem } from '../lib/aiApi.ts';
import { useAiAccess } from '../components/AiAccess.tsx';
import type { AiStatus, DetailLevel, SummaryListItem, SummaryResponse } from '../lib/aiTypes.ts';
import type { Book } from '../lib/bookTypes.ts';
import type { ContentListItem, ContentListResponse } from '../lib/contentTypes.ts';

type SummaryStyleId = 'comprehensive' | 'quick' | 'visual' | 'flashcards' | 'comparison' | 'key_points' | 'custom';

const studyStyles: Array<{
  id: SummaryStyleId;
  label: string;
  hint: string;
  level: DetailLevel;
  focusKind: 'key_ideas' | 'definitions' | 'laws' | 'comparisons' | 'causes' | null;
  icon: typeof BookOpen;
}> = [
  { id: 'comprehensive', label: 'شامل', hint: 'شرح موسّع', level: 'detailed', focusKind: null, icon: BookOpen },
  { id: 'quick', label: 'سريع', hint: 'مراجعة مركزة', level: 'short', focusKind: null, icon: Zap },
  { id: 'visual', label: 'بصري', hint: 'علاقات ومخطط', level: 'medium', focusKind: 'causes', icon: Shapes },
  { id: 'flashcards', label: 'بطاقات فلاش', hint: 'سؤال وجواب', level: 'short', focusKind: 'key_ideas', icon: Layers },
  { id: 'comparison', label: 'مقارنة', hint: 'أوجه الشبه والاختلاف', level: 'medium', focusKind: 'comparisons', icon: GitCompare },
  { id: 'key_points', label: 'أهم النقاط', hint: 'أفكار ومصطلحات', level: 'medium', focusKind: 'key_ideas', icon: ListChecks },
  { id: 'custom', label: 'مخصص', hint: 'اكتب محورك', level: 'medium', focusKind: null, icon: PenLine },
];

export default function SummaryPage() {
  const [searchParams] = useSearchParams();
  const requestedBookId = useRef(searchParams.get('bookId') ?? '');
  const { hasKey, requireKey, openActivation } = useAiAccess();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [contents, setContents] = useState<ContentListItem[]>([]);
  const [summaries, setSummaries] = useState<SummaryListItem[]>([]);
  const [contentId, setContentId] = useState('');
  const [bookId, setBookId] = useState(searchParams.get('bookId') ?? '');
  const initializedSource = useRef(false);
  const [focus, setFocus] = useState('');
  const [styleId, setStyleId] = useState<SummaryStyleId>('comprehensive');
  const studyStyle = studyStyles.find((item) => item.id === styleId) ?? studyStyles[0];
  const [pageFrom, setPageFrom] = useState('');
  const [pageTo, setPageTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SummaryResponse | null>(null);

  const readyBooks = useMemo(() => books.filter((book) => book.status === 'ready' && book.chunksCount > 0), [books]);
  const readyContents = useMemo(
    () => contents.filter((item) => item.status === 'ready' || item.status === 'needs_review'),
    [contents],
  );
  const selectedContent = readyContents.find((item) => String(item.id) === contentId);
  const selectedBook = readyBooks.find((book) => String(book.id) === bookId);
  const selected = selectedContent ?? selectedBook;

  const loadAll = useCallback(async () => {
    try {
      const [statusData, booksData, contentsData, summariesData] = await Promise.all([
        api.get<AiStatus>('/ai/status'),
        api.get<{ books: Book[] }>('/books'),
        api.get<ContentListResponse>('/contents'),
        api.get<{ summaries: SummaryListItem[] }>('/summaries'),
      ]);
      setStatus(statusData);
      setBooks(booksData.books);
      setContents(contentsData.contents);
      setSummaries(summariesData.summaries);
      if (!initializedSource.current) {
        const requestedBook = requestedBookId.current;
        const firstContent = contentsData.contents.find(
          (item) => item.status === 'ready' || item.status === 'needs_review',
        );
        const firstBook = booksData.books.find(
          (book) => book.status === 'ready' && book.chunksCount > 0,
        );
        if (requestedBook && booksData.books.some((book) => String(book.id) === requestedBook)) {
          setBookId(requestedBook);
          setContentId('');
        } else if (firstContent || firstBook) {
          setContentId(firstContent ? String(firstContent.id) : '');
          setBookId(firstContent ? '' : String(firstBook?.id ?? ''));
        }
        initializedSource.current = true;
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل بيانات الأداة.');
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function generate() {
    if (loading || (!bookId && !contentId)) return;
    if (!requireKey()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await aiApi.post<SummaryResponse>('/summaries', {
        contentId: contentId ? Number(contentId) : null,
        bookId: bookId ? Number(bookId) : null,
        detailLevel: studyStyle.level,
        focusKind: studyStyle.focusKind,
        focus: focus.trim() || null,
        pageFrom: pageFrom ? Number(pageFrom) : null,
        pageTo: pageTo ? Number(pageTo) : null,
      });
      setResult(data);
      setSummaries((current) => [{ ...data.summary, content: data.summary.preview }, ...current]);
      if (status) setStatus({ ...status, usedToday: data.usage.requests + status.usedToday, remaining: data.usage.remainingToday });
    } catch (caught) {
      if (isKeyProblem(caught)) openActivation('activate');
      setError(caught instanceof ApiError ? caught.message : 'تعذّر توليد الملخص.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="تلخيص من مصدرك"
        title="الملخص الذكي"
        subtitle="ملخص من الصور أو الفيديو أو PDF أو النص أو الكتاب الذي تختاره، مع رقم الصفحة بعد كل معلومة — لا معلومات من خارج المصدر."
      />

      {error && <Alert>{error}</Alert>}

      {!hasKey && (
        <Alert tone="info">
          <span className="inline-flex flex-wrap items-center gap-2">
            توليد الملخص يحتاج مفتاح Groq API الخاص بك. أضفه مرة واحدة على هذا الجهاز، وسيُستخدم في
            كل ميزات الذكاء الاصطناعي.
            <button type="button" className="btn btn-soft px-2 py-1 text-xs" onClick={() => openActivation('activate')}>
              تفعيل الذكاء الاصطناعي
            </button>
          </span>
        </Alert>
      )}

      {status && (
        <p className="muted text-xs">
          المزوّد: {status.provider} · النموذج: {status.model}
          {status.baseUrlHost ? ` (${status.baseUrlHost})` : ''} · المتبقي اليوم: {status.remaining} من{' '}
          {status.dailyLimit} طلبًا
        </p>
      )}

      <div className="card p-4 sm:p-5">
        <StudySourcePicker
          contentId={contentId}
          bookId={bookId}
          contents={contents}
          books={books}
          onChange={(selection) => {
            setContentId(selection.contentId);
            setBookId(selection.bookId);
            setPageFrom('');
            setPageTo('');
          }}
          onLibraryChanged={loadAll}
          disabled={loading}
        />

        <div className="form-section">
          <div className="form-section-head">
            <span className="step-badge">2</span>
            <div>
              <h3>نوع الملخص</h3>
              <p>اختر الشكل المناسب لطريقة مراجعتك.</p>
            </div>
          </div>
          <div className="summary-style-grid">
            {studyStyles.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setStyleId(option.id)}
                  aria-pressed={styleId === option.id}
                  className="summary-style-card"
                >
                  <span className="summary-style-icon"><Icon size={17} /></span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-bold">{option.label}</span>
                    <span className="block text-[10px] leading-5 text-[var(--muted)]">{option.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-head">
            <span className="step-badge">3</span>
            <div>
              <h3>تفاصيل إضافية</h3>
              <p>اختياري: ركّز على موضوع أو نطاق صفحات محدد.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="موضوع أو جزء محدد (اختياري)" htmlFor="summaryFocus">
              <input
                id="summaryFocus"
                className="input"
                placeholder="مثال: خطة الدراسة والمراجعة"
                value={focus}
                onChange={(event) => setFocus(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="من صفحة" htmlFor="summaryFrom">
                <input
                  id="summaryFrom"
                  type="number"
                  min={1}
                  max={selected?.pagesCount ?? undefined}
                  className="input"
                  value={pageFrom}
                  onChange={(event) => setPageFrom(event.target.value)}
                />
              </Field>
              <Field label="إلى صفحة" htmlFor="summaryTo">
                <input
                  id="summaryTo"
                  type="number"
                  min={1}
                  max={selected?.pagesCount ?? undefined}
                  className="input"
                  value={pageTo}
                  onChange={(event) => setPageTo(event.target.value)}
                />
              </Field>
            </div>
          </div>
        </div>

        <div className="form-actions mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary sm:w-48"
            onClick={() => void generate()}
            disabled={loading || (!bookId && !contentId) || !status?.configured || status.remaining <= 0}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? 'جار التوليد…' : 'ولّد الملخص'}
          </button>
          {!contentId && !bookId && (
            <span className="muted text-xs">ارفع مصدرًا أو اختر محتوى جاهزًا أولًا.</span>
          )}
        </div>

        {loading && (
          <div className="study-processing mt-4" role="status" aria-live="polite">
            <Loader2 size={18} className="animate-spin" />
            <div>
              <p className="text-sm font-bold">جار تحليل المصدر وتوليد الملخص…</p>
              <p className="muted mt-0.5 text-[11px] leading-6">
                نختار المقاطع الأكثر صلة ثم نرتّب الملخص بعناوين ونقاط. قد يستغرق حتى دقيقة للكتب الكبيرة؛ لا تغلق الصفحة.
              </p>
            </div>
          </div>
        )}

        {!loading && focus.trim() && (contentId || bookId) && (
          <p className="muted mt-3 text-[11px]">
            عند كتابة موضوع أو جزء محدد سيستخرج النظام المقاطع الأكثر صلة به من المصدر (بحث BM25 محلي) ثم يلخّصها.
          </p>
        )}
      </div>

      {result && (
        <section className="card p-4 sm:p-5">
          <span className="tape" aria-hidden="true" />
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">{result.summary.title}</h3>
            <span className="badge">{result.summary.detailLevelLabel}</span>
          </div>
          <SummaryBody content={result.summary.content} />
          <PageLinks bookId={result.summary.bookId} contentId={result.summary.contentId} pages={result.summary.pages} />
          <p className="muted mt-3 text-[11px]">
            {result.summary.rangeLabel} · {result.usage.requests} طلب · {result.usage.tokensIn + result.usage.tokensOut} رمز
            {result.usage.costKnown ? ` · ${result.usage.costUsd.toFixed(4)}$` : ' · التكلفة تُحسب بعد ضبط أسعار النموذج'}
          </p>
          <Link to={`/summary/${result.summary.id}`} className="btn btn-primary btn-sm mt-3">
            افتح حزمة المراجعة
          </Link>
        </section>
      )}

      <section>
        <h3 className="mb-2 font-bold">ملخصاتي</h3>
        {summaries.length === 0 ? (
          <p className="muted text-sm">لا توجد ملخصات محفوظة بعد.</p>
        ) : (
          <ul className="space-y-2">
            {summaries.map((item) => (
              <li key={item.id} className="card card-hover p-3">
                <Link to={`/summary/${item.id}`} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{item.title}</p>
                    <span className="badge shrink-0">{item.detailLevelLabel}</span>
                  </div>
                  <p className="muted mt-1 line-clamp-2 text-xs leading-6">{item.preview}</p>
                  <p className="muted mt-2 text-[11px]">
                    {item.rangeLabel ?? '—'} · {item.pagesCount} صفحة مصدر · {formatDateTime(item.createdAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="muted flex items-center gap-1 text-[11px]">
        <FileText size={13} />
        كل ملخص يُنشأ من مقاطع مصدرك المحفوظة على الخادم فقط.
      </p>
    </AppShell>
  );
}

export function SummaryBody({ content }: { content: string }) {
  return <MarkdownText content={content} className="summary-body" ariaLabel="نص الملخص" />;
}

export function PageLinks({ bookId, contentId, pages }: { bookId: number | null; contentId?: number | null; pages: number[] }) {
  if (pages.length === 0) return null;
  const shown = pages.slice(0, 24);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="muted text-[11px]">المصادر:</span>
      {shown.map((page) => (
        <Link
          key={page}
          to={contentId ? `/content/${contentId}` : bookId ? `/books/${bookId}?page=${page}` : '/books'}
          className="badge badge-xs hover:bg-[var(--surface-hover)]"
        >
          ص {page}
        </Link>
      ))}
      {pages.length > shown.length && (
        <span className="muted text-[11px]">+{pages.length - shown.length} صفحة</span>
      )}
    </div>
  );
}
