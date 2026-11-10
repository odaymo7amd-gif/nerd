import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  Loader2,
  ListChecks,
  PenLine,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { StudySourcePicker } from '../components/StudySourcePicker.tsx';
import { Alert, EmptyState, Field, PageHeader, StatTile } from '../components/ui.tsx';
import { api, ApiError, formatDateTime } from '../lib/api.ts';
import { aiApi, isKeyProblem } from '../lib/aiApi.ts';
import { useAiAccess } from '../components/AiAccess.tsx';
import type { Book } from '../lib/bookTypes.ts';
import type { ContentListItem, ContentListResponse } from '../lib/contentTypes.ts';
import type { AiStatus } from '../lib/aiTypes.ts';
import {
  difficultyLabels,
  isTextQuestion,
  typeLabels,
  type CreateTestResponse,
  type QuestionType,
  type TestDifficulty,
  type TestListResponse,
} from '../lib/testTypes.ts';

interface ManualDraft {
  key: number;
  type: QuestionType;
  text: string;
  options: string[];
  correctIndex: number;
  answer: string;
  explanation: string;
}

function emptyManualQuestion(key: number): ManualDraft {
  return { key, type: 'mcq', text: '', options: ['', '', ''], correctIndex: 0, answer: '', explanation: '' };
}

const counts = [5, 10, 15, 20, 25];
const difficulties: TestDifficulty[] = ['easy', 'medium', 'hard', 'advanced'];
const difficultyHints: Record<'easy' | 'medium' | 'hard' | 'advanced', string> = {
  easy: 'أسئلة مباشرة من النص، وخيارات واضحة.',
  medium: 'فهم وتطبيق في سياقات متنوعة.',
  hard: 'تحليل واستنتاج وربط بين أكثر من موضع.',
  advanced: 'قدرات عليا على النمط الوزاري: تحليل واستنتاج وخيارات متقاربة.',
};
const allTypes: QuestionType[] = [
  'mcq',
  'true_false',
  'short',
  'fill_blank',
  'explain',
  'compare',
  'essay',
  'math',
];

export default function TestsPage() {
  const navigate = useNavigate();
  const { hasKey, requireKey, openActivation } = useAiAccess();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [contents, setContents] = useState<ContentListItem[]>([]);
  const [data, setData] = useState<TestListResponse | null>(null);
  const [contentId, setContentId] = useState('');
  const [bookId, setBookId] = useState('');
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<TestDifficulty>('medium');
  const [types, setTypes] = useState<QuestionType[]>(['mcq']);
  const [focus, setFocus] = useState('');
  const [pageFrom, setPageFrom] = useState('');
  const [pageTo, setPageTo] = useState('');
  const [duration, setDuration] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [manualTitle, setManualTitle] = useState('');
  const [manualQuestions, setManualQuestions] = useState<ManualDraft[]>(() => [emptyManualQuestion(1)]);
  const [manualBusy, setManualBusy] = useState(false);
  const nextKey = useRef(2);
  const initializedSource = useRef(false);

  const readyBooks = useMemo(
    () => books.filter((book) => book.status === 'ready' && book.chunksCount > 0),
    [books],
  );
  const readyContents = useMemo(
    () => contents.filter((item) => item.status === 'ready' || item.status === 'needs_review'),
    [contents],
  );
  const selectedContent = readyContents.find((item) => String(item.id) === contentId);
  const selectedBook = readyBooks.find((book) => String(book.id) === bookId);
  const selected = selectedContent ?? selectedBook;

  const loadAll = useCallback(async () => {
    try {
      const [statusData, booksData, contentsData, testsData] = await Promise.all([
        api.get<AiStatus>('/ai/status'),
        api.get<{ books: Book[] }>('/books'),
        api.get<ContentListResponse>('/contents'),
        api.get<TestListResponse>('/tests'),
      ]);
      setStatus(statusData);
      setBooks(booksData.books);
      setContents(contentsData.contents);
      setData(testsData);
      if (!initializedSource.current) {
        const firstContent = contentsData.contents.find(
          (item) => item.status === 'ready' || item.status === 'needs_review',
        );
        const firstBook = booksData.books.find(
          (book) => book.status === 'ready' && book.chunksCount > 0,
        );
        setContentId(firstContent ? String(firstContent.id) : '');
        setBookId(firstContent ? '' : String(firstBook?.id ?? ''));
        initializedSource.current = true;
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل صفحة الاختبارات.');
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function toggleType(type: QuestionType) {
    setTypes((current) =>
      current.includes(type)
        ? current.length === 1
          ? current
          : current.filter((value) => value !== type)
        : [...current, type],
    );
  }

  async function create() {
    if (loading || (!bookId && !contentId)) return;
    if (!requireKey()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await aiApi.post<CreateTestResponse>('/tests', {
        contentId: contentId ? Number(contentId) : null,
        bookId: bookId ? Number(bookId) : null,
        count,
        difficulty,
        types,
        focus: focus.trim() || null,
        pageFrom: pageFrom ? Number(pageFrom) : null,
        pageTo: pageTo ? Number(pageTo) : null,
        durationMinutes: duration ? Number(duration) : null,
      });
      navigate(`/tests/${result.test.id}`, { state: { warning: result.warning } });
    } catch (caught) {
      if (isKeyProblem(caught)) openActivation('activate');
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إنشاء الاختبار.');
    } finally {
      setLoading(false);
    }
  }

  function addManualQuestion() {
    setManualQuestions((current) =>
      current.length >= 50 ? current : [...current, emptyManualQuestion(nextKey.current++)],
    );
  }

  function updateManual(key: number, patch: Partial<ManualDraft>) {
    setManualQuestions((current) =>
      current.map((question) => (question.key === key ? { ...question, ...patch } : question)),
    );
  }

  function removeManual(key: number) {
    setManualQuestions((current) =>
      current.length === 1 ? current : current.filter((question) => question.key !== key),
    );
  }

  function changeManualType(key: number, type: QuestionType) {
    updateManual(key, { type, correctIndex: 0 });
  }

  function patchOption(key: number, index: number, value: string) {
    setManualQuestions((current) =>
      current.map((question) =>
        question.key === key
          ? {
              ...question,
              options: question.options.map((option, optionIndex) =>
                optionIndex === index ? value : option,
              ),
            }
          : question,
      ),
    );
  }

  function addOption(key: number) {
    setManualQuestions((current) =>
      current.map((question) =>
        question.key === key && question.options.length < 5
          ? { ...question, options: [...question.options, ''] }
          : question,
      ),
    );
  }

  function removeOption(key: number, index: number) {
    setManualQuestions((current) =>
      current.map((question) => {
        if (question.key !== key || question.options.length <= 3) return question;
        const options = question.options.filter((_, optionIndex) => optionIndex !== index);
        const correctIndex =
          question.correctIndex === index
            ? 0
            : question.correctIndex > index
              ? question.correctIndex - 1
              : question.correctIndex;
        return { ...question, options, correctIndex };
      }),
    );
  }

  async function createManual() {
    if (manualBusy) return;
    setError(null);

    for (const [index, question] of manualQuestions.entries()) {
      const position = index + 1;
      if (question.text.trim().length < 8) {
        setError(`السؤال ${position}: اكتب نصًا لا يقل عن 8 أحرف.`);
        return;
      }
      if (question.type === 'mcq') {
        if (question.options.some((option) => !option.trim())) {
          setError(`السؤال ${position}: املأ كل الخيارات أو احذف الفارغ منها.`);
          return;
        }
        if (!question.options[question.correctIndex]?.trim()) {
          setError(`السؤال ${position}: حدّد الإجابة الصحيحة.`);
          return;
        }
      }
      if (question.type === 'short' && !question.answer.trim()) {
        setError(`السؤال ${position}: اكتب الإجابة النموذجية للسؤال القصير.`);
        return;
      }
    }

    setManualBusy(true);
    try {
      const result = await api.post<CreateTestResponse>('/tests/manual', {
        title: manualTitle.trim() || undefined,
        difficulty,
        durationMinutes: duration ? Number(duration) : null,
        questions: manualQuestions.map((question) => ({
          type: question.type,
          text: question.text.trim(),
          options:
            question.type === 'mcq'
              ? question.options.map((option) => option.trim())
              : question.type === 'true_false'
                ? ['صح', 'خطأ']
                : [],
          correctIndex: question.type === 'short' ? null : question.correctIndex,
          answer: question.type === 'short' ? question.answer.trim() : null,
          explanation: question.explanation.trim() || null,
        })),
      });
      navigate(`/tests/${result.test.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إنشاء الاختبار اليدوي.');
    } finally {
      setManualBusy(false);
    }
  }

  async function remove(id: number, title: string) {
    if (!window.confirm(`حذف اختبار «${title}» وكل محاولاته؟ لا يمكن التراجع.`)) return;
    try {
      await api.del(`/tests/${id}`);
      setData((current) =>
        current
          ? {
              ...current,
              tests: current.tests.filter((test) => test.id !== id),
              stats: { ...current.stats, testsCreated: Math.max(0, current.stats.testsCreated - 1) },
            }
          : current,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حذف الاختبار.');
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="الاختبارات"
        subtitle="اختبار بمؤقت وتصحيح آلي ومراجعة — أسئلة يولّدها الذكاء الاصطناعي من صورتك أو فيديوك أو PDF أو نصك، أو تكتبها بنفسك بلا مفتاح."
      />

      {error && <Alert>{error}</Alert>}

      {!hasKey && (
        <Alert tone="info">
          <span className="inline-flex flex-wrap items-center gap-2">
            توليد الأسئلة من مصدرك يحتاج مفتاح Groq API الخاص بك؛ أضفه مرة واحدة على هذا الجهاز.
            وتبويب «كتابة يدوية» يعمل الآن بلا أي مفتاح، ولن تُعرض أسئلة وهمية في الحالتين.
            <button type="button" className="btn btn-soft px-2 py-1 text-xs" onClick={() => openActivation('activate')}>
              تفعيل الذكاء الاصطناعي
            </button>
          </span>
        </Alert>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile
            icon={<ClipboardList size={15} />}
            tint="blue"
            label="اختبارات أنشأتها"
            value={String(data.stats.testsCreated)}
          />
          <StatTile
            icon={<Target size={15} />}
            tint="mint"
            label="اختبارات مكتملة"
            value={String(data.stats.testsCompleted)}
          />
          <StatTile
            icon={<ListChecks size={15} />}
            tint="lavender"
            label="أسئلة أجبت عنها"
            value={String(data.stats.questionsAnswered)}
          />
          <StatTile
            icon={<Trophy size={15} />}
            tint="yellow"
            label="متوسط النتائج"
            value={data.stats.averageScore == null ? '—' : `${data.stats.averageScore}%`}
          />
        </div>
      )}

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold">
            <Sparkles size={17} className="text-[var(--accent)]" />
            اختبار جديد
          </h2>
          <div className="segment" role="group" aria-label="طريقة إنشاء الاختبار">
            <button
              type="button"
              onClick={() => setMode('ai')}
              aria-pressed={mode === 'ai'}
              className="segment-btn"
            >
              <Sparkles size={13} /> توليد ذكي
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              aria-pressed={mode === 'manual'}
              className="segment-btn"
            >
              <PenLine size={13} /> كتابة يدوية
            </button>
          </div>
        </div>

        {mode === 'ai' && (
          <>
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
              <h3>نطاق الأسئلة</h3>
              <p>حدّد جزءًا معينًا أو اترك الاختبار يغطي المصدر كله.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="موضوع أو جزء محدد (اختياري)" htmlFor="testFocus" hint="اتركه فارغًا ليأخذ النظام من النطاق كله.">
              <input
                id="testFocus"
                className="input"
                placeholder="مثال: الوحدة الثانية — الكسور"
                value={focus}
                onChange={(event) => setFocus(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="من صفحة" htmlFor="testFrom">
                <input
                  id="testFrom"
                  type="number"
                  min={1}
                  max={selected?.pagesCount ?? undefined}
                  className="input"
                  value={pageFrom}
                  onChange={(event) => setPageFrom(event.target.value)}
                />
              </Field>
              <Field label="إلى صفحة" htmlFor="testTo">
                <input
                  id="testTo"
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

        <div className="form-section">
          <div className="form-section-head">
            <span className="step-badge">3</span>
            <div>
              <h3>إعداد الاختبار</h3>
              <p>اختر العدد والمدة والصعوبة وشكل الأسئلة.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="عدد الأسئلة" htmlFor="testCount">
              <select
                id="testCount"
                className="input"
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
              >
                {counts.map((value) => (
                  <option key={value} value={value}>
                    {value} أسئلة
                  </option>
                ))}
              </select>
            </Field>

            <Field label="مدة الاختبار بالدقائق" htmlFor="testDuration" hint="اتركه فارغًا لمدة تلقائية (دقيقة وربع للسؤال).">
              <input
                id="testDuration"
                type="number"
                min={3}
                max={180}
                className="input"
                placeholder="تلقائي"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </Field>
          </div>

          <div className="mt-3">
            <p className="muted mb-1 text-xs">مستوى الصعوبة</p>
            <div className="flex flex-wrap gap-2">
              {difficulties.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDifficulty(value)}
                  aria-pressed={difficulty === value}
                  className="chip"
                >
                  {difficultyLabels[value]}
                </button>
              ))}
            </div>
            {difficulty !== 'mixed' && (
              <p className="muted mt-1 text-[11px]">{difficultyHints[difficulty]}</p>
            )}
          </div>

          <div className="mt-3">
            <p className="muted mb-1 text-xs">أنواع الأسئلة</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTypes(['mcq', 'true_false', 'short'])}
                aria-pressed={
                  types.length === 3 &&
                  ['mcq', 'true_false', 'short'].every((value) => types.includes(value as QuestionType))
                }
                className="chip"
              >
                متنوّع
              </button>
              {allTypes.map((value) => {
                const active = types.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleType(value)}
                    aria-pressed={active}
                    className="chip"
                  >
                    {typeLabels[value]}
                  </button>
                );
              })}
            </div>
            {types.some(isTextQuestion) && (
              <p className="muted mt-1 text-[11px]">
                الأسئلة النصية تُصحَّح بمطابقة نصية مع الإجابة النموذجية (بعد تجاهل التشكيل وعلامات الترقيم)،
                وتظهر لك الإجابة النموذجية في المراجعة مع أي صيغ بديلة.
              </p>
            )}
          </div>
        </div>

        <div className="form-actions mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary sm:w-52"
            onClick={() => void create()}
            disabled={loading || (!bookId && !contentId) || !status?.configured || (status?.remaining ?? 0) <= 0}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? 'جار توليد الأسئلة…' : 'أنشئ الاختبار'}
          </button>
          {!contentId && !bookId && (
            <span className="muted text-xs">ارفع مصدرًا أو اختر محتوى جاهزًا أولًا.</span>
          )}
          {status?.configured && (
            <span className="muted text-[11px]">
              المتبقي اليوم: {status.remaining} من {status.dailyLimit} طلبًا — توليد الاختبار يستهلك طلبًا واحدًا.
            </span>
          )}
        </div>

        {loading && (
          <div className="study-processing mt-4" role="status" aria-live="polite">
            <Loader2 size={18} className="animate-spin" />
            <div>
              <p className="text-sm font-bold">جار اختيار المقاطع وتوليد الأسئلة…</p>
              <p className="muted mt-0.5 text-[11px] leading-6">
                الأسئلة ستُبنى من المصدر المحدد فقط. قد يستغرق حتى دقيقة؛ لا تُغلق الصفحة.
              </p>
            </div>
          </div>
        )}
          </>
        )}

        {mode === 'manual' && (
          <div>
            <p className="muted mb-3 text-xs">
              اكتب أسئلتك بنفسك — هذا الوضع يعمل بلا مزوّد ذكاء اصطناعي ولا يستهلك الحد اليومي للـ AI. حدّد
              الإجابة الصحيحة لكل سؤال؛ ستُحفظ على الخادم ولا تُرسل إلى المتصفح قبل التسليم.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="عنوان الاختبار (اختياري)" htmlFor="manualTitle">
                <input
                  id="manualTitle"
                  className="input"
                  placeholder="مثال: مراجعة الفصل الثالث"
                  value={manualTitle}
                  onChange={(event) => setManualTitle(event.target.value)}
                />
              </Field>
              <Field label="مدة الاختبار بالدقائق" htmlFor="manualDuration" hint="اتركه فارغًا لمدة تلقائية (دقيقة وربع للسؤال).">
                <input
                  id="manualDuration"
                  type="number"
                  min={3}
                  max={180}
                  className="input"
                  placeholder="تلقائي"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                />
              </Field>
            </div>

            <div className="mt-3 space-y-3">
              {manualQuestions.map((question, index) => (
                <div key={question.key} className="paper-note p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="step-badge is-sm">{index + 1}</span>
                      <span className="text-xs font-bold">السؤال {index + 1}</span>
                    </span>
                    <div className="flex items-center gap-1">
                      <select
                        className="input min-h-8 w-auto py-1 text-xs"
                        value={question.type}
                        onChange={(event) => changeManualType(question.key, event.target.value as QuestionType)}
                        aria-label={`نوع السؤال ${index + 1}`}
                      >
                        <option value="mcq">اختيار من متعدد</option>
                        <option value="true_false">صح / خطأ</option>
                        <option value="short">إجابة قصيرة</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeManual(question.key)}
                        disabled={manualQuestions.length === 1}
                        className="icon-btn is-sm text-[var(--color-bad)] disabled:opacity-40"
                        aria-label={`حذف السؤال ${index + 1}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  <input
                    className="input"
                    placeholder="نص السؤال"
                    value={question.text}
                    onChange={(event) => updateManual(question.key, { text: event.target.value })}
                    aria-label={`نص السؤال ${index + 1}`}
                  />

                  {question.type === 'mcq' && (
                    <div className="mt-2 space-y-1.5">
                      {question.options.map((option, optionIndex) => (
                        <div key={optionIndex} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`correct-${question.key}`}
                            checked={question.correctIndex === optionIndex}
                            onChange={() => updateManual(question.key, { correctIndex: optionIndex })}
                            aria-label={`الإجابة الصحيحة للسؤال ${index + 1} خيار ${optionIndex + 1}`}
                            className="size-4 shrink-0 accent-[var(--accent)]"
                          />
                          <input
                            className="input min-h-9 py-1 text-sm"
                            placeholder={`الخيار ${optionIndex + 1}`}
                            value={option}
                            onChange={(event) => patchOption(question.key, optionIndex, event.target.value)}
                          />
                          {question.options.length > 3 && (
                            <button
                              type="button"
                              onClick={() => removeOption(question.key, optionIndex)}
                              className="icon-btn is-sm shrink-0 text-[var(--color-bad)]"
                              aria-label={`حذف الخيار ${optionIndex + 1}`}
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                      {question.options.length < 5 && (
                        <button
                          type="button"
                          onClick={() => addOption(question.key)}
                          className="muted text-[11px] underline"
                        >
                          أضف خيارًا
                        </button>
                      )}
                    </div>
                  )}

                  {question.type === 'true_false' && (
                    <div className="mt-2 flex gap-2">
                      {['صح', 'خطأ'].map((label, value) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => updateManual(question.key, { correctIndex: value })}
                          aria-pressed={question.correctIndex === value}
                          className="chip"
                        >
                          الإجابة الصحيحة: {label}
                        </button>
                      ))}
                    </div>
                  )}

                  {question.type === 'short' && (
                    <input
                      className="input mt-2"
                      placeholder="الإجابة النموذجية (تُقارن نصيًا بعد تطبيع عربي)"
                      value={question.answer}
                      onChange={(event) => updateManual(question.key, { answer: event.target.value })}
                      aria-label={`الإجابة النموذجية للسؤال ${index + 1}`}
                    />
                  )}

                  <input
                    className="input mt-2"
                    placeholder="شرح الإجابة (اختياري)"
                    value={question.explanation}
                    onChange={(event) => updateManual(question.key, { explanation: event.target.value })}
                    aria-label={`شرح السؤال ${index + 1}`}
                  />
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" onClick={addManualQuestion}>
                <Plus size={14} /> أضف سؤالًا
              </button>
              <span className="muted text-[11px]">{manualQuestions.length} سؤالًا</span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-primary sm:w-52"
                onClick={() => void createManual()}
                disabled={manualBusy}
              >
                {manualBusy ? <Loader2 size={16} className="animate-spin" /> : <PenLine size={16} />}
                {manualBusy ? 'جار الحفظ…' : 'أنشئ الاختبار'}
              </button>
              <span className="muted text-[11px] text-[var(--color-ok)]">لا يحتاج مفتاح API</span>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-bold">اختباراتي</h2>
        {!data ? (
          <div className="space-y-2" aria-hidden="true">
            <div className="skeleton h-16" />
            <div className="skeleton h-16" />
            <div className="skeleton h-16" />
          </div>
        ) : data.tests.length === 0 ? (
          <EmptyState
            title="لا توجد اختبارات بعد"
            body="أنشئ أول اختبار من كتاب جاهز، وستُحفظ نتائجه هنا مع أفضل نتيجة لكل محاولة."
            icon={<ClipboardList size={26} />}
          />
        ) : (
          <ul className="space-y-2">
            {data.tests.map((test) => (
              <li key={test.id} className="card card-hover p-3">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/tests/${test.id}`} className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{test.title}</p>
                    <p className="muted mt-1 text-[11px]">
                      {test.questionsCount} سؤالًا · {test.durationMinutes ?? '—'} دقيقة ·{' '}
                      {test.attemptsCount > 0 ? `${test.attemptsCount} محاولة` : 'لم تجرّبه بعد'} ·{' '}
                      {formatDateTime(test.createdAt)}
                    </p>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    {test.bestScore != null && (
                      <span className="badge badge-mint">أفضل نتيجة {test.bestScore}%</span>
                    )}
                    <button
                      type="button"
                      className="icon-btn is-sm text-[var(--color-bad)]"
                      aria-label={`حذف ${test.title}`}
                      onClick={() => void remove(test.id, test.title)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="muted text-[11px]">
        الأسئلة تُبنى من المقاطع المستخرجة من كتابك فقط. الإجابات الصحيحة تُحفظ على الخادم ولا تُرسل إلى
        المتصفح قبل التسليم.
      </p>
    </AppShell>
  );
}
