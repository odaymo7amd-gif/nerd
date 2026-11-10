import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Clock, FileText, Play, Timer, Trash2 } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, FullPageLoader, PageHeader, StatTile } from '../components/ui.tsx';
import { api, ApiError, formatDateTime } from '../lib/api.ts';
import {
  formatDuration,
  type StartAttemptResponse,
  type TestDetail,
} from '../lib/testTypes.ts';

export default function TestViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const creationWarning = (location.state as { warning?: string | null } | null)?.warning ?? null;
  const [test, setTest] = useState<TestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<{ test: TestDetail }>(`/tests/${id}`);
      setTest(data.test);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الاختبار.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function start() {
    if (!id || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<StartAttemptResponse>(`/tests/${id}/attempts`);
      if (!data.attempt) throw new ApiError(500, 'تعذّر بدء المحاولة.');
      navigate(`/tests/${id}/take`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر بدء الاختبار.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id || !test) return;
    if (!window.confirm(`حذف اختبار «${test.title}» وكل محاولاته؟ لا يمكن التراجع.`)) return;
    try {
      await api.del(`/tests/${id}`);
      navigate('/tests', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حذف الاختبار.');
    }
  }

  if (!test) {
    return (
      <AppShell>
        {error ? <Alert>{error}</Alert> : <FullPageLoader label="جار تحميل الاختبار…" />}
      </AppShell>
    );
  }

  const best = test.attempts.reduce<number | null>(
    (current, attempt) => (attempt.score == null ? current : Math.max(current ?? 0, attempt.score)),
    null,
  );

  return (
    <AppShell>
      <PageHeader
        eyebrow="اختبار"
        title={test.title}
        subtitle={`${test.questionsCount} سؤالًا · ${test.durationMinutes ?? '—'} دقيقة · ${test.bookTitle ?? 'بدون كتاب'}`}
        actions={
          <div className="flex items-center gap-2">
            <Link to="/tests" className="btn btn-ghost min-h-9 px-3 text-xs">
              <ArrowRight size={15} />
              كل الاختبارات
            </Link>
            <button
              type="button"
              onClick={() => void remove()}
              className="icon-btn is-sm text-[var(--color-bad)]"
              aria-label="حذف الاختبار"
            >
              <Trash2 size={16} />
            </button>
          </div>
        }
      />

      {error && <Alert>{error}</Alert>}
      {creationWarning && <Alert tone="info">{creationWarning}</Alert>}

      <div className="card p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="badge badge-blue">
            <Clock size={13} /> {test.durationMinutes ?? '—'} دقيقة
          </span>
          <span className="badge badge-lavender">
            <FileText size={13} /> {test.questionsCount} سؤالًا
          </span>
          {test.bookId && (
            <Link to={`/books/${test.bookId}`} className="badge badge-mint">
              فتح الكتاب
            </Link>
          )}
          {best != null && <span className="badge">أفضل نتيجة {best}%</span>}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <StatTile label="الأسئلة" value={test.questionsCount} tint="lavender" />
          <StatTile label="المدة" value={`${test.durationMinutes ?? '—'} د`} tint="blue" />
          <StatTile label="أفضل نتيجة" value={best == null ? '—' : `${best}%`} tint="mint" />
        </div>

        <p className="muted mt-3 text-xs leading-6">
          المؤقت يبدأ من الخادم عند الضغط على «ابدأ»، ولا يمكن إيقافه. الإجابات تُصحَّح على الخادم،
          والإجابات الصحيحة لا تظهر إلا بعد التسليم. إذا أعدت تحميل الصفحة أثناء الاختبار فالمؤقت يستمر،
          لذلك سلّم إجاباتك قبل إغلاق الصفحة.
        </p>

        {test.activeAttempt ? (
          <div className="mt-4 rounded-[15px_11px_17px_10px] border-2 border-[var(--line)] bg-[color-mix(in_srgb,var(--blue)_20%,var(--surface))] p-3.5 shadow-[var(--shadow-xs)]">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <span className="size-2 rounded-full bg-[var(--accent)]" />
              لديك محاولة قيد التنفيذ بدأت {formatDateTime(test.activeAttempt.startedAt)}
            </p>
            <p className="muted mt-1 text-xs">
              الوقت محسوب من بداية المحاولة. المتبقي يظهر داخل صفحة الاختبار.
            </p>
            <Link to={`/tests/${test.id}/take`} className="btn btn-primary mt-3 min-h-10 px-4 text-sm">
              <Play size={16} />
              متابعة الاختبار
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className="btn btn-primary mt-4 min-h-11 w-full px-5 sm:w-auto"
          >
            <Play size={17} />
            {busy ? 'جار البدء…' : 'ابدأ الاختبار'}
          </button>
        )}
      </div>

      <section>
        <h2 className="mb-2 flex items-center gap-2 font-bold">
          <Timer size={16} className="text-[var(--accent)]" />
          محتوى الاختبار
        </h2>
        <ol className="space-y-2">
          {test.questions.map((question, index) => (
            <li key={question.id} className="card p-3">
              <div className="flex items-start gap-3">
                <span className="option-index is-sm mt-0.5 shrink-0">{index + 1}</span>
                <div className="min-w-0">
                  <p className="text-sm leading-7">{question.text}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="badge badge-blue text-[10px]">{question.typeLabel}</span>
                    {question.page != null && test.bookId && (
                      <Link
                        to={`/books/${test.bookId}?page=${question.page}`}
                        className="muted text-[11px] underline"
                      >
                        ص {question.page}
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="mb-2 font-bold">محاولاتي</h2>
        {test.attempts.length === 0 ? (
          <p className="muted text-sm">لم تجرّب هذا الاختبار بعد.</p>
        ) : (
          <ul className="space-y-2">
            {test.attempts.map((attempt) => (
              <li key={attempt.id} className="card card-hover flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`grid size-11 shrink-0 place-items-center rounded-full border-2 border-[var(--line)] font-display text-sm font-extrabold shadow-[var(--shadow-xs)] ${
                      (attempt.score ?? 0) >= 60
                        ? 'bg-[color-mix(in_srgb,var(--mint)_55%,var(--surface))]'
                        : 'bg-[color-mix(in_srgb,var(--pink)_50%,var(--surface))]'
                    }`}
                  >
                    {attempt.score ?? 0}%
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{attempt.total} سؤالًا</p>
                    <p className="muted mt-0.5 text-[11px]">
                      {formatDateTime(attempt.finishedAt)} · {formatDuration(attempt.timeSpentSeconds)}
                    </p>
                  </div>
                </div>
                <Link
                  to={`/tests/${test.id}/results/${attempt.id}`}
                  className="btn btn-ghost min-h-8 px-3 text-xs"
                >
                  مراجعة الإجابات
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
