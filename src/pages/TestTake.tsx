import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Send, Sparkles } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { MarkdownText } from '../components/MarkdownText.tsx';
import { Alert, FullPageLoader, Progress } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import {
  difficultyLabels,
  formatClock,
  isTextQuestion,
  type AttemptSummary,
  type CheckAnswerResponse,
  type StartAttemptResponse,
  type TestDetail,
  type TestResultResponse,
} from '../lib/testTypes.ts';

interface AnswerDraft {
  optionId?: number;
  text?: string;
}

function elapsedSince(startedAt: string): number {
  const normalized = startedAt.includes('T') ? startedAt : `${startedAt.replace(' ', 'T')}Z`;
  const started = new Date(normalized).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.round((Date.now() - started) / 1000));
}

export default function TestTakePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [test, setTest] = useState<TestDetail | null>(null);
  const [attempt, setAttempt] = useState<AttemptSummary | null>(null);
  const [answers, setAnswers] = useState<Record<number, AnswerDraft>>({});
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checked, setChecked] = useState<Record<number, CheckAnswerResponse>>({});
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const submittedRef = useRef(false);
  const answersRef = useRef<Record<number, AnswerDraft>>({});
  const attemptRef = useRef<AttemptSummary | null>(null);

  answersRef.current = answers;
  attemptRef.current = attempt;

  const questions = test?.questions ?? [];
  const current = questions[index];

  const submit = useCallback(
    async (auto: boolean, force = false) => {
      const currentAttempt = attemptRef.current;
      if (!id || !currentAttempt || submittedRef.current) return;
      const draft = answersRef.current;
      const unanswered = (test?.questions ?? []).filter((question) => {
        const answer = draft[question.id];
        if (!answer) return true;
        return isTextQuestion(question.type) ? !answer.text?.trim() : !answer.optionId;
      }).length;

      if (!auto && !force && unanswered > 0) {
        setFinishOpen(true);
        return;
      }

      submittedRef.current = true;
      setSubmitting(true);
      setError(null);
      try {
        const payloadAnswers: Array<{ questionId: number; optionId?: number; text?: string }> = [];
        for (const question of test?.questions ?? []) {
          const answer = draft[question.id];
          if (!answer) continue;
          if (isTextQuestion(question.type)) {
            if (answer.text?.trim()) payloadAnswers.push({ questionId: question.id, text: answer.text.trim() });
          } else if (answer.optionId) {
            payloadAnswers.push({ questionId: question.id, optionId: answer.optionId });
          }
        }
        const result = await api.post<TestResultResponse>(`/tests/${id}/attempts/${currentAttempt.id}/submit`, {
          answers: payloadAnswers,
        });
        navigate(`/tests/${id}/results/${result.attempt.id}`, { replace: true });
      } catch (caught) {
        submittedRef.current = false;
        setError(caught instanceof ApiError ? caught.message : 'تعذّر تسليم الاختبار.');
      } finally {
        setSubmitting(false);
      }
    },
    [id, navigate, test],
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .post<StartAttemptResponse>(`/tests/${id}/attempts`)
      .then((data) => {
        if (cancelled) return;
        setTest(data.test);
        setAttempt(data.attempt);
        if (!data.attempt) {
          setError('تعذّر بدء المحاولة. أعد المحاولة من صفحة الاختبار.');
          return;
        }
        const limit = (data.test.durationMinutes ?? 0) * 60;
        setRemaining(limit > 0 ? Math.max(0, limit - elapsedSince(data.attempt.startedAt)) : null);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'تعذّر بدء الاختبار.');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (remaining == null || submittedRef.current) return;
    if (remaining <= 0) {
      void submit(true);
      return;
    }
    const timer = window.setTimeout(() => {
      const currentAttempt = attemptRef.current;
      if (!currentAttempt) return;
      const limit = (test?.durationMinutes ?? 0) * 60;
      setRemaining(limit > 0 ? Math.max(0, limit - elapsedSince(currentAttempt.startedAt)) : null);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [remaining, submit, test?.durationMinutes]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (submittedRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const answeredCount = useMemo(
    () =>
      questions.filter((question) => {
        const answer = answers[question.id];
        if (!answer) return false;
        return isTextQuestion(question.type) ? Boolean(answer.text?.trim()) : Boolean(answer.optionId);
      }).length,
    [answers, questions],
  );

  function reviewUnanswered() {
    const first = questions.findIndex((question) => {
      const answer = answers[question.id];
      if (!answer) return true;
      return isTextQuestion(question.type) ? !answer.text?.trim() : !answer.optionId;
    });
    setFinishOpen(false);
    if (first >= 0) setIndex(first);
  }

  async function checkCurrent() {
    if (!id || !attempt || !current || checkingId) return;
    const answer = answers[current.id];
    if (!answer) return;
    setCheckingId(current.id);
    setError(null);
    try {
      const result = await api.post<CheckAnswerResponse>(
        `/tests/${id}/attempts/${attempt.id}/check`,
        {
          questionId: current.id,
          optionId: answer.optionId ?? null,
          text: answer.text?.trim() || null,
        },
      );
      setChecked((value) => ({ ...value, [current.id]: result }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر التحقق من الإجابة.');
    } finally {
      setCheckingId(null);
    }
  }

  if (!test || !attempt) {
    return (
      <AppShell>
        {error ? <Alert>{error}</Alert> : <FullPageLoader label="جار تجهيز الاختبار…" />}
      </AppShell>
    );
  }

  if (questions.length === 0) {
    return (
      <AppShell>
        <Alert>هذا الاختبار لا يحتوي أسئلة. ارجع إلى صفحة الاختبارات وأنشئ اختبارًا جديدًا.</Alert>
        <Link to={`/tests/${test.id}`} className="btn btn-ghost mt-3 min-h-9 px-3 text-xs">
          رجوع
        </Link>
      </AppShell>
    );
  }

  const answeredCurrent = answers[current.id];
  const lowTime = remaining != null && remaining <= 60;

  return (
    <AppShell>
      {error && <Alert>{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="eyebrow mb-0.5">جلسة اختبار</p>
          <h1 className="truncate font-display text-lg font-extrabold sm:text-xl">{test.title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="badge badge-yellow">{difficultyLabels[test.difficulty as keyof typeof difficultyLabels] ?? 'متوسط'}</span>
          <div className={`timer-pill shrink-0 ${lowTime ? 'is-low' : ''}`} role="timer" aria-live="polite">
            <Clock size={15} />
            {remaining == null ? 'بلا مؤقت' : formatClock(remaining)}
          </div>
        </div>
      </div>

      <Progress value={index + 1} max={questions.length} tone={lowTime ? 'danger' : 'accent'} />

      <div className="flex items-center justify-between text-[11px]">
        <span className="muted">
          السؤال {index + 1} من {questions.length} · {current.typeLabel}
        </span>
        <span className="badge badge-mint py-0 text-[10px]">أجبت عن {answeredCount}</span>
      </div>

      <section className="exam-palette" aria-label="التنقل بين الأسئلة">
        <div className="exam-palette-head">
          <p>الأسئلة</p>
          <span>أجبت عن {answeredCount} من {questions.length}</span>
        </div>
        <div className="exam-palette-grid">
          {questions.map((question, questionIndex) => {
            const answer = answers[question.id];
            const answered = answer
              ? isTextQuestion(question.type)
                ? Boolean(answer.text?.trim())
                : Boolean(answer.optionId)
              : false;
            const active = questionIndex === index;
            return (
              <button
                key={question.id}
                type="button"
                onClick={() => setIndex(questionIndex)}
                aria-current={active ? 'step' : undefined}
                aria-label={`السؤال ${questionIndex + 1}`}
                className={`exam-palette-item ${active ? 'is-active' : ''} ${answered ? 'is-answered' : ''}`}
              >
                {questionIndex + 1}
              </button>
            );
          })}
        </div>
      </section>

      <section className="exam-question card p-4">
        <p className="text-base font-semibold leading-8">{current.text}</p>

        <div className="mt-4 space-y-2">
          {isTextQuestion(current.type) ? (
            current.type === 'short' ? (
              <input
                className="input"
                placeholder="اكتب إجابتك القصيرة هنا"
                value={answeredCurrent?.text ?? ''}
                onChange={(event) => {
                  setChecked((value) => {
                    const next = { ...value };
                    delete next[current.id];
                    return next;
                  });
                  setAnswers((currentAnswers) => ({
                    ...currentAnswers,
                    [current.id]: { text: event.target.value },
                  }));
                }}
              />
            ) : (
              <textarea
                className="input min-h-28 resize-y"
                placeholder={
                  current.type === 'math'
                    ? 'اكتب خطوات الحل والنتيجة هنا'
                    : current.type === 'compare'
                      ? 'اذكر أوجه الشبه والاختلاف'
                      : 'اكتب إجابتك هنا'
                }
                value={answeredCurrent?.text ?? ''}
                onChange={(event) => {
                  setChecked((value) => {
                    const next = { ...value };
                    delete next[current.id];
                    return next;
                  });
                  setAnswers((currentAnswers) => ({
                    ...currentAnswers,
                    [current.id]: { text: event.target.value },
                  }));
                }}
              />
            )
          ) : (
            current.options.map((option, optionIndex) => {
              const selected = answeredCurrent?.optionId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setChecked((value) => {
                      const next = { ...value };
                      delete next[current.id];
                      return next;
                    });
                    setAnswers((currentAnswers) => ({
                      ...currentAnswers,
                      [current.id]: { optionId: option.id },
                    }));
                  }}
                  className={`option ${selected ? 'is-selected' : ''}`}
                  aria-pressed={selected}
                >
                  <span className="option-index">{optionIndex + 1}</span>
                  <span className="leading-7">{option.text}</span>
                </button>
              );
            })
          )}
        </div>

        {test.showAnswers === 'after_each' && (
          <div className="mt-3 border-t-2 border-dashed border-[var(--line-soft)] pt-3">
            {checked[current.id] ? (
              <div
                className="rounded-[10px_8px_11px_7px] border-2 border-[var(--line)] p-3 text-xs leading-6"
                style={{
                  background: checked[current.id].isCorrect
                    ? 'color-mix(in srgb, var(--mint) 35%, var(--surface))'
                    : 'color-mix(in srgb, var(--pink) 32%, var(--surface))',
                }}
              >
                <p className="flex items-center gap-1.5 font-bold">
                  <CheckCircle2 size={14} />
                  {checked[current.id].isCorrect ? 'إجابة صحيحة' : 'ليست صحيحة بعد'}
                </p>
                {!checked[current.id].isCorrect && checked[current.id].correctAnswer && (
                  <div className="mt-1">
                    <span className="muted">الإجابة النموذجية: </span>
                    <MarkdownText content={checked[current.id].correctAnswer ?? ''} compact />
                  </div>
                )}
                {checked[current.id].explanation && (
                  <div className="muted mt-1">
                    <MarkdownText content={checked[current.id].explanation ?? ''} compact />
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-ghost min-h-9 px-3 text-xs"
                onClick={() => void checkCurrent()}
                disabled={checkingId === current.id || !answeredCurrent}
              >
                <Sparkles size={14} />
                {checkingId === current.id ? 'جار التحقق…' : 'تحقق من إجابتي'}
              </button>
            )}
          </div>
        )}

        {current.page != null && test.bookId && (
          <p className="muted mt-3 text-[11px]">
            السؤال من الصفحة {current.page} من {test.contentId ? 'محتواك' : 'الكتاب'} (يمكنك مراجعتها بعد التسليم).
          </p>
        )}
      </section>

      <div className="exam-actions">
        <button
          type="button"
          className="btn btn-ghost min-h-10 px-3 text-sm"
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          disabled={index === 0}
        >
          <ChevronRight size={16} />
          السابق
        </button>

        {index < questions.length - 1 && (
          <button
            type="button"
            className="btn btn-primary min-h-10 px-4 text-sm"
            onClick={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}
          >
            التالي
            <ChevronLeft size={16} />
          </button>
        )}

        <button
          type="button"
          className="btn exam-finish-btn min-h-10 px-4 text-sm"
          onClick={() => void submit(false)}
          disabled={submitting || submittedRef.current}
        >
          <Send size={16} />
          {submitting ? 'جار التسليم…' : 'إنهاء الامتحان'}
        </button>
      </div>

      <p className="muted flex items-center gap-1 text-[11px]">
        <AlertTriangle size={13} />
        لا تُغلق الصفحة قبل التسليم: المؤقت يعمل على الخادم، والإجابات المُدخلة لا تُحفظ قبل الضغط على
        «سلّم».
      </p>

      {finishOpen && (
        <div className="exam-modal-backdrop" role="presentation">
          <div className="exam-modal" role="dialog" aria-modal="true" aria-labelledby="test-finish-title">
            <span className="exam-modal-icon" aria-hidden="true">
              <AlertCircle size={26} />
            </span>
            <h2 id="test-finish-title">لسه ما خلصت كل الأسئلة!</h2>
            <p>
              أجبت عن {answeredCount} من {questions.length} أسئلة، وبقيت {questions.length - answeredCount}{' '}
              أسئلة بدون إجابة.
            </p>
            <div className="exam-modal-actions">
              <button type="button" className="btn btn-soft min-h-10" onClick={reviewUnanswered}>
                مراجعة الأسئلة
              </button>
              <button
                type="button"
                className="btn exam-finish-btn min-h-10"
                onClick={() => void submit(false, true)}
              >
                إنهاء الامتحان
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
