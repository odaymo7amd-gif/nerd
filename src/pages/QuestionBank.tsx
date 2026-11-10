import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  Library,
  Loader2,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { MarkdownText } from '../components/MarkdownText.tsx';
import { Alert, EmptyState, PageHeader, Spinner, StatTile } from '../components/ui.tsx';
import { api, ApiError, formatDateTime } from '../lib/api.ts';
import type { BankQuestion, BankResponse, BankTestResponse } from '../lib/bankTypes.ts';

const PAGE_SIZE = 20;

function QuestionCard({
  question,
  selected,
  onToggle,
  onDelete,
  deleting,
}: {
  question: BankQuestion;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <article
      className={`card p-3 transition ${
        selected ? 'ring-2 ring-[var(--color-brand-500)]' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          aria-label={selected ? 'إلغاء اختيار السؤال' : 'اختيار السؤال'}
          className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-2 border-[var(--line)] text-[#25251f] transition ${
            selected
              ? 'bg-[var(--blue)]'
              : 'border-[var(--border)] bg-transparent'
          }`}
        >
          {selected && <Check size={14} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="badge">{question.typeLabel}</span>
            <span className="badge">{question.difficultyLabel}</span>
            {question.bookTitle && <span className="badge">{question.bookTitle}</span>}
            {question.page != null && <span className="badge">صفحة {question.page}</span>}
            {question.testsCount > 0 && <span className="badge">في {question.testsCount} اختبار</span>}
            {question.bestScore != null && (
              <span className="badge">
                أفضل نتيجة {Math.round(question.bestScore)}%
              </span>
            )}
          </div>

          <p className="text-sm font-semibold leading-6">{question.text}</p>

          {question.options.length > 0 && (
            <ul className="mt-2 space-y-1">
              {question.options.map((option) => (
                <li
                  key={option.id}
                  className={`rounded-[10px_8px_11px_7px] border-2 px-2 py-1 text-[13px] ${
                    option.isCorrect
                      ? 'border-[var(--line)] bg-[color-mix(in_srgb,var(--mint)_42%,var(--surface))] font-semibold'
                      : 'border-[var(--line-soft)]'
                  }`}
                >
                  {option.isCorrect ? (
                    <Check size={13} className="me-1 inline text-[var(--color-ok)]" />
                  ) : (
                    <span className="me-2 inline-block size-1.5 rounded-full bg-[var(--line-soft)] align-middle" />
                  )}
                  {option.text}
                </li>
              ))}
            </ul>
          )}

          {question.answer && (
            <p className="mt-2 rounded-[10px_8px_11px_7px] border-2 border-[var(--line)] bg-[color-mix(in_srgb,var(--mint)_42%,var(--surface))] px-2 py-1 text-[13px] font-semibold">
              الإجابة النموذجية: {question.answer}
            </p>
          )}

          {question.explanation && (
            <div className="muted mt-2 text-[12px] leading-5">
              <span>الشرح: </span>
              <MarkdownText content={question.explanation} compact />
            </div>
          )}

          <div className="muted mt-2 flex flex-wrap items-center gap-3 text-[11px]">
            <span>أُضيف {formatDateTime(question.createdAt)}</span>
            {question.attemptsCount > 0 && <span>ظهر في {question.attemptsCount} محاولة مُسلَّمة</span>}
          </div>
        </div>

        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="btn btn-ghost shrink-0 px-2 py-1 text-[var(--danger,#ef4444)]"
          aria-label="حذف السؤال من البنك"
        >
          {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
        </button>
      </div>
    </article>
  );
}

export default function QuestionBankPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<BankResponse | null>(null);
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [type, setType] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [bookId, setBookId] = useState('');

  const [selected, setSelected] = useState<number[]>([]);
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (type) params.set('type', type);
    if (difficulty) params.set('difficulty', difficulty);
    if (bookId) params.set('bookId', bookId);
    return params;
  }, [debouncedSearch, type, difficulty, bookId]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams(query);
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', '0');
        const result = await api.get<BankResponse>(`/bank?${params.toString()}`, signal);
        setData(result);
        setQuestions(result.questions);
      } catch (caught) {
        if ((caught as Error).name === 'AbortError') return;
        setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل بنك الأسئلة.');
      } finally {
        setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // نُبقي الاختيار فقط للأسئلة الظاهرة، حتى لا يُنشأ اختبار من أسئلة لم تعد على الشاشة
  useEffect(() => {
    const visible = new Set(questions.map((question) => question.id));
    setSelected((current) => current.filter((id) => visible.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions]);

  const loadMore = async () => {
    if (!data || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const params = new URLSearchParams(query);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(questions.length));
      const result = await api.get<BankResponse>(`/bank?${params.toString()}`);
      setQuestions((current) => {
        const seen = new Set(current.map((question) => question.id));
        return [...current, ...result.questions.filter((question) => !seen.has(question.id))];
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل المزيد من الأسئلة.');
    } finally {
      setLoadingMore(false);
    }
  };

  const toggle = (id: number) => {
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const removeQuestion = async (question: BankQuestion) => {
    if (!window.confirm('حذف هذا السؤال من بنك الأسئلة؟ لا يمكن التراجع.')) return;
    setDeletingId(question.id);
    setError(null);
    setNotice(null);
    try {
      await api.del(`/bank/questions/${question.id}`);
      setQuestions((current) => current.filter((item) => item.id !== question.id));
      setSelected((current) => current.filter((id) => id !== question.id));
      setNotice('حُذف السؤال من البنك.');
      void load();
    } catch (caught) {
      // الحذف قد يُرفض إن كان السؤال داخل اختبار محفوظ — نُظهر السبب كما هو
      if (caught instanceof ApiError && caught.status === 409) {
        window.alert(caught.message);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'تعذّر حذف السؤال.');
      }
    } finally {
      setDeletingId(null);
    }
  };

  const createTest = async () => {
    if (selected.length === 0) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<BankTestResponse>('/bank/tests', {
        questionIds: selected,
        title: title.trim() || null,
        durationMinutes: duration ? Number(duration) : null,
      });
      navigate(`/tests/${result.test.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إنشاء الاختبار من البنك.');
    } finally {
      setCreating(false);
    }
  };

  const summary = data?.summary;
  const allLoaded = data ? questions.length >= data.total : false;

  return (
    <AppShell>
      <PageHeader
        eyebrow="أرشيفك"
        title="بنك الأسئلة"
        subtitle="كل سؤال حُفظ من اختباراتك أو كتبته يدويًا — صفِّ، راجع الإجابة، وأنشئ اختبارًا جديدًا باختيار الأسئلة."
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile tint="yellow" label="إجمالي الأسئلة" value={summary ? String(summary.total) : '…'} />
        <StatTile tint="blue" label="اختيار من متعدد" value={summary ? String(summary.byType.mcq) : '…'} />
        <StatTile tint="mint" label="صح أو خطأ" value={summary ? String(summary.byType.true_false) : '…'} />
        <StatTile tint="pink" label="إجابة قصيرة" value={summary ? String(summary.byType.short) : '…'} />
      </div>

      <div className="card mt-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative block">
          <span className="label">بحث في النص</span>
          <Search size={16} className="pointer-events-none absolute start-3 top-[38px] text-[var(--muted)]" />
          <input
            className="input ps-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="كلمة من السؤال أو شرحه"
          />
        </label>

        <label className="block">
          <span className="label">النوع</span>
          <select className="input" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">كل الأنواع</option>
            {(data?.types ?? []).map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">الصعوبة</span>
          <select className="input" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
            <option value="">كل المستويات</option>
            {(data?.difficulties ?? []).map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">الكتاب</span>
          <select className="input" value={bookId} onChange={(event) => setBookId(event.target.value)}>
            <option value="">كل الكتب</option>
            {(data?.books ?? []).map((book) => (
              <option key={book.id} value={String(book.id)}>
                {book.title} ({book.count})
              </option>
            ))}
          </select>
        </label>
      </div>

      {selected.length > 0 && (
        <div className="card mt-4 flex flex-col gap-2 p-3 sm:flex-row sm:items-end">
          <p className="text-sm font-semibold sm:me-auto">
            اخترت {selected.length} سؤالًا
            <button
              type="button"
              className="muted ms-2 text-xs underline"
              onClick={() => setSelected([])}
            >
              إلغاء الاختيار
            </button>
          </p>
          <label className="block sm:w-56">
            <span className="label">عنوان الاختبار (اختياري)</span>
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="اختبار من بنك الأسئلة"
            />
          </label>
          <label className="block sm:w-36">
            <span className="label">المدة (دقيقة)</span>
            <input
              className="input"
              type="number"
              min={3}
              max={180}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              placeholder="تلقائي"
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={createTest} disabled={creating}>
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            أنشئ اختبارًا
          </button>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {loading && questions.length === 0 ? (
          <div className="py-10">
            <Spinner />
          </div>
        ) : questions.length === 0 ? (
          <EmptyState
            icon={<Library size={28} />}
            title={summary && summary.total > 0 ? 'لا أسئلة مطابقة لهذه التصفية' : 'بنك الأسئلة فارغ'}
            body={
              summary && summary.total > 0
                ? 'جرّب كلمة بحث أوسع، أو أزل أحد الفلاتر.'
                : 'أنشئ اختبارًا من كتابك أو اكتب أسئلة يدويًا، وستُحفظ كل أسئلتها هنا تلقائيًا لإعادة استخدامها.'
            }
          />
        ) : (
          questions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              selected={selected.includes(question.id)}
              onToggle={() => toggle(question.id)}
              onDelete={() => void removeQuestion(question)}
              deleting={deletingId === question.id}
            />
          ))
        )}

        {!loading && questions.length > 0 && !allLoaded && (
          <button type="button" className="btn btn-soft w-full" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 size={16} className="animate-spin" /> : <ChevronDown size={16} />}
            تحميل المزيد ({questions.length} من {data?.total ?? 0})
          </button>
        )}
      </div>
    </AppShell>
  );
}
