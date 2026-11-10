import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, RotateCcw, Timer, XCircle } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { MarkdownText } from '../components/MarkdownText.tsx';
import { Alert, FullPageLoader, PageHeader } from '../components/ui.tsx';
import { api, ApiError, formatDateTime } from '../lib/api.ts';
import {
  difficultyLabels,
  formatDuration,
  isTextQuestion,
  type StartAttemptResponse,
  type TestResultResponse,
} from '../lib/testTypes.ts';

export default function TestResultPage() {
  const { id, attemptId } = useParams<{ id: string; attemptId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<TestResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id || !attemptId) return;
    let cancelled = false;
    api
      .get<TestResultResponse>(`/tests/${id}/attempts/${attemptId}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل النتيجة.');
      });
    return () => {
      cancelled = true;
    };
  }, [id, attemptId]);

  async function retake() {
    if (!id || busy) return;
    setBusy(true);
    try {
      const result = await api.post<StartAttemptResponse>(`/tests/${id}/attempts`);
      if (!result.attempt) throw new ApiError(500, 'تعذّر بدء محاولة جديدة.');
      navigate(`/tests/${id}/take`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر بدء محاولة جديدة.');
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <AppShell>
        {error ? <Alert>{error}</Alert> : <FullPageLoader label="جار تحميل النتيجة…" />}
      </AppShell>
    );
  }

  const { summary } = data;
  const passed = summary.score >= 50;

  return (
    <AppShell>
      <PageHeader
        title={data.test.title}
        subtitle={`محاولة ${formatDateTime(data.attempt.finishedAt)} · ${formatDuration(data.attempt.timeSpentSeconds)}`}
        actions={
          <Link to={`/tests/${data.test.id}`} className="btn btn-ghost min-h-9 px-3 text-xs">
            <ArrowRight size={15} />
            صفحة الاختبار
          </Link>
        }
      />

      {error && <Alert>{error}</Alert>}
      {summary.timedOut && (
        <Alert tone="info">
          سُلّم هذا الاختبار بعد انتهاء الوقت المحدد، لكن الإجابات صُحّحت كما هي. المؤقت يبدأ من الخادم ولا
          يتوقف عند إغلاق الصفحة.
        </Alert>
      )}

      <section className="card result-card p-5 text-center">
        <span className="badge badge-lavender">{passed ? 'أحسنت، نتيجة مميزة' : 'لا بأس، المحاولة القادمة أفضل'}</span>
        <p className="muted mt-2 text-xs">النتيجة</p>
        <p
          className="result-score mt-1 font-display text-6xl font-extrabold"
          style={{ color: passed ? 'var(--color-ok)' : 'var(--color-bad)' }}
        >
          {summary.score}%
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {data.test.difficulty && (
            <span className="badge badge-yellow">
              {difficultyLabels[data.test.difficulty as keyof typeof difficultyLabels] ?? data.test.difficulty}
            </span>
          )}
          <span className="badge badge-lavender">{summary.total} سؤالًا</span>
          <span className="badge">
            {Array.from(new Set(data.questions.map((question) => question.typeLabel))).join(' · ')}
          </span>
        </div>
        <p className="mt-2 text-sm">
          {summary.correctCount} إجابة صحيحة · {summary.wrongCount} خاطئة · {summary.unansweredCount}{' '}
          بدون إجابة
        </p>
        <p className="muted mt-1 flex items-center justify-center gap-1 text-[11px]">
          <Timer size={13} />
          الوقت المستغرق {formatDuration(data.attempt.timeSpentSeconds)}
          {data.test.durationMinutes ? ` من ${data.test.durationMinutes} دقيقة` : ''}
        </p>
        <div className="mx-auto mt-4 grid w-full max-w-xl grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => void retake()}
            disabled={busy}
            className="btn btn-primary min-h-10 px-3 text-xs"
          >
            <RotateCcw size={16} />
            {busy ? 'جار البدء…' : 'أعد الامتحان'}
          </button>
          <button
            type="button"
            className="btn btn-soft min-h-10 px-3 text-xs"
            onClick={() => document.getElementById('result-review')?.scrollIntoView({ behavior: 'smooth' })}
            disabled={summary.wrongCount + summary.unansweredCount === 0}
          >
            <XCircle size={15} />
            راجع الأخطاء
          </button>
          <Link to="/tests" className="btn btn-ghost min-h-10 px-3 text-xs">
            إنشاء امتحان جديد
          </Link>
        </div>
      </section>

      <section id="result-review">
        <h2 className="mb-2 font-bold">مراجعة الإجابات</h2>
        <ol className="space-y-2">
          {data.questions.map((question, index) => {
            return (
              <li key={question.id} className="card p-3">
                <div className="flex items-start gap-2">
                  <span
                    className="mt-0.5 shrink-0"
                    style={{ color: question.isCorrect ? 'var(--color-ok)' : 'var(--color-bad)' }}
                  >
                    {question.isCorrect ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-7">
                      {index + 1}. {question.text}
                    </p>
                    {!question.answered && (
                      <span className="badge badge-pink mt-1 inline-flex py-0 text-[9px]">
                        لم تتم الإجابة عن هذا السؤال
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-2 space-y-1.5 ps-7">
                  {question.options.length > 0 &&
                    question.options.map((option) => {
                      const isSelected = option.id === question.selectedOptionId;
                      return (
                        <div
                          key={option.id}
                          className={`flex items-center gap-2 rounded-[10px_8px_11px_7px] border-2 px-2.5 py-1.5 text-xs ${
                            option.isCorrect
                              ? 'border-[var(--line)] bg-[color-mix(in_srgb,var(--mint)_42%,var(--surface))]'
                              : isSelected
                                ? 'border-[var(--line)] bg-[color-mix(in_srgb,var(--pink)_40%,var(--surface))]'
                                : 'border-[var(--line-soft)]'
                          }`}
                        >
                          <span className="flex-1 leading-6">{option.text}</span>
                          {option.isCorrect && <span className="badge badge-mint py-0 text-[9px]">الإجابة الصحيحة</span>}
                          {isSelected && !option.isCorrect && <span className="badge badge-pink py-0 text-[9px]">إجابتك</span>}
                        </div>
                      );
                    })}

                  {isTextQuestion(question.type) && (
                    <div className="space-y-1.5 text-xs">
                      <p>
                        <span className="muted">إجابتك: </span>
                        <span style={{ color: question.isCorrect ? 'var(--color-ok)' : 'var(--color-bad)' }}>
                          {question.answerText ?? 'لم تُجب'}
                        </span>
                      </p>
                      {question.correctAnswer && (
                        <div>
                          <span className="muted">الإجابة النموذجية: </span>
                          <MarkdownText content={question.correctAnswer} compact />
                        </div>
                      )}
                      {question.answerVariants.length > 1 && (
                        <p className="muted">
                          إجابات مقبولة أيضًا: {question.answerVariants.slice(1).join(' · ')}
                        </p>
                      )}
                    </div>
                  )}

                  {question.explanation && (
                    <div className="muted text-xs leading-6">
                      <MarkdownText content={question.explanation} compact />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge text-[10px]">{question.typeLabel}</span>
                    {question.page != null && data.test.bookId && (
                      <Link
                        to={data.test.contentId ? `/content/${data.test.contentId}` : `/books/${data.test.bookId}?page=${question.page}`}
                        className="muted text-[11px] underline"
                      >
                        ص {question.page} {data.test.contentId ? 'في محتواك' : 'في الكتاب'}
                      </Link>
                    )}
                    {!question.answered && <span className="muted text-[11px]">لم تُجب عن هذا السؤال</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {data.test.contentId ? (
        <Link to={`/content/${data.test.contentId}`} className="muted text-xs underline">
          ارجع إلى المحتوى الدراسي لمراجعة الصفحات
        </Link>
      ) : data.test.bookId ? (
        <Link to={`/books/${data.test.bookId}`} className="muted text-xs underline">
          ارجع إلى الكتاب لمراجعة الصفحات
        </Link>
      ) : null}
    </AppShell>
  );
}
