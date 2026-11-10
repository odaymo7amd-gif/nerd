import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Clock3, Flame, ListChecks, Sparkles, Trophy } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, EmptyState, PageHeader, StatTile } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';

interface ChallengeTest {
  id: number;
  title: string;
  questionsCount: number;
  durationMinutes: number | null;
  status: string;
  attempts: number;
  bestScore: number | null;
  lastAttemptId: number | null;
  activeAttemptId: number | null;
}

interface ChallengeResponse {
  date: string;
  questionCount: number;
  bankCount: number;
  canStart: boolean;
  minimumQuestions: number;
  test: ChallengeTest | null;
}

export default function ChallengePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<ChallengeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get<ChallengeResponse>('/challenge'));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل التحدي اليومي.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ test: { id: number } }>('/challenge/start');
      navigate(`/tests/${result.test.id}/take`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر بدء التحدي.');
      setBusy(false);
    }
  }

  const test = data?.test;
  const plannedQuestions = test?.questionsCount ?? (data ? Math.min(data.questionCount, data.bankCount) : 0);

  return (
    <AppShell>
      <PageHeader
        eyebrow="تحدي يومي"
        title="تحدي اليوم"
        subtitle="خمسة أسئلة من بنك أسئلتك، بترتيب جديد كل يوم. لا يستهلك أي طلب ذكاء اصطناعي."
        actions={<span className="badge badge-yellow">{data?.date ?? '…'}</span>}
      />

      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile tint="yellow" label="أسئلة التحدي" value={data ? plannedQuestions : '…'} icon={<ListChecks size={17} />} />
        <StatTile tint="blue" label="في بنك أسئلتك" value={data?.bankCount ?? '…'} icon={<Sparkles size={17} />} />
        <StatTile
          tint="pink"
          label="أفضل نتيجة اليوم"
          value={test?.bestScore != null ? `${Math.round(test.bestScore)}%` : '—'}
          icon={<Trophy size={17} />}
        />
        <StatTile
          tint="mint"
          label="محاولات اليوم"
          value={test?.attempts ?? 0}
          icon={<Flame size={17} />}
        />
      </div>

      {!data ? (
        <div className="card p-6 text-center">
          <p className="muted text-sm">جار تحميل التحدي…</p>
        </div>
      ) : !data.canStart && !test ? (
        <EmptyState
          title="بنك أسئلتك لم يكتمل بعد"
          body={`تحتاج ${data.minimumQuestions} أسئلة على الأقل لبدء التحدي. أنشئ اختبارًا من محتواك أو اكتب أسئلة يدوية، وستُضاف تلقائيًا إلى بنك الأسئلة.`}
          icon={<Trophy className="w-12" />}
        />
      ) : (
        <section className="card p-5 sm:p-6">
          <span className="tape" aria-hidden="true" />
          <div className="flex flex-wrap items-start gap-4">
            <span className="grid size-16 shrink-0 place-items-center rounded-[20px_14px_22px_13px] border-[2.5px] border-[var(--line)] bg-[var(--yellow)] text-[#25251f] shadow-[3px_3px_0_var(--shadow-color)]">
              <Trophy size={30} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-xl font-extrabold">
                {test ? 'تحدي اليوم جاهز' : 'جاهز للتحدي؟'}
              </h2>
              <p className="muted mt-1 text-sm leading-7">
                {test
                  ? `أُعدّ لك ${test.questionsCount} أسئلة اليوم. يمكنك إعادة المحاولة لتحسين أفضل نتيجة.`
                  : `سنختار لك ${plannedQuestions} أسئلة من ${data.bankCount} سؤالًا في بنكك. المدة 10 دقائق.`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className="badge inline-flex items-center gap-1">
                  <Clock3 size={12} />
                  {test?.durationMinutes ?? 10} دقائق
                </span>
                <span className="badge">{plannedQuestions} أسئلة</span>
                {test?.activeAttemptId && <span className="badge badge-mint">لديك محاولة قيد التنفيذ</span>}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {test ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => navigate(`/tests/${test.id}/take`)}
                >
                  {test.activeAttemptId ? 'أكمل المحاولة' : test.attempts > 0 ? 'حاول مرة أخرى' : 'ابدأ التحدي'}
                </button>
                <Link to={`/tests/${test.id}`} className="btn btn-ghost">
                  عرض التحدي
                </Link>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={busy}>
                {busy ? 'جار تجهيز التحدي…' : 'ابدأ تحدي اليوم'}
              </button>
            )}
          </div>

          <p className="muted mt-4 border-t-2 border-dashed border-[var(--line-soft)] pt-3 text-[11px] leading-6">
            التحدي مبني من أسئلة سبق أن أنشأتها أو كتبتها، فلا يكلّفك أي طلب AI. النتيجة تُحفظ في سجل
            الاختبارات، ويمكنك مراجعة الإجابات بعد التسليم.
          </p>
        </section>
      )}

      <p className="muted text-[11px]">
        تريد أسئلة أكثر؟{' '}
        <Link to="/tests" className="underline">
          أنشئ اختبارًا من محتواك
        </Link>{' '}
        أو أضف أسئلة يدوية، وستدخل بنك الأسئلة تلقائيًا.
      </p>
    </AppShell>
  );
}
