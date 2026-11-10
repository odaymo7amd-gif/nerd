import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Layers,
  ListChecks,
  Loader2,
  Map,
  Share2,
  Sparkles,
  Trash2,
  Languages,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, FullPageLoader, Progress } from '../components/ui.tsx';
import {
  DefinitionsView,
  FlashcardReview,
  KeyPointsView,
  QuizReview,
  StudyExtras,
  StudyTabs,
  VisualMapView,
} from '../components/StudyKit.tsx';
import { api, ApiError, formatDateTime } from '../lib/api.ts';
import { aiApi, isKeyProblem } from '../lib/aiApi.ts';
import { useAiAccess } from '../components/AiAccess.tsx';
import type {
  SummaryCardStatus,
  SummaryListItem,
  SummaryReviewState,
} from '../lib/aiTypes.ts';
import { PageLinks, SummaryBody } from './Summary.tsx';

type TabId = 'summary' | 'cards' | 'points' | 'terms' | 'quiz' | 'map';

const emptyReviewState: SummaryReviewState = { cards: {}, quiz: {}, updatedAt: '' };

export default function SummaryViewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasKey, requireKey, openActivation } = useAiAccess();
  const [summary, setSummary] = useState<SummaryListItem | null>(null);
  const [reviewState, setReviewState] = useState<SummaryReviewState>(emptyReviewState);
  const [tab, setTab] = useState<TabId>('summary');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kitBusy, setKitBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ summary: SummaryListItem }>(`/summaries/${id}`);
      setSummary(data.summary);
      setReviewState({ ...emptyReviewState, ...(data.summary.reviewState ?? {}) });
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الملخص.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const kit = summary?.studyKit ?? null;
  const stats = useMemo(() => {
    if (!kit) return { known: 0, reviewed: 0, total: 0, percent: 0, quizCorrect: 0 };
    const known = kit.flashcards.filter((card) => reviewState.cards[card.id] === 'known').length;
    const reviewedCards = kit.flashcards.filter((card) => Boolean(reviewState.cards[card.id])).length;
    const quizAnswered = kit.quiz.filter((question) => Boolean(reviewState.quiz[question.id])).length;
    const quizCorrect = kit.quiz.filter((question) => reviewState.quiz[question.id]?.correct).length;
    const total = kit.flashcards.length + kit.quiz.length;
    return {
      known,
      reviewed: reviewedCards + quizAnswered,
      total,
      percent: total ? Math.round(((reviewedCards + quizAnswered) / total) * 100) : 0,
      quizCorrect,
    };
  }, [kit, reviewState]);

  async function generateKit() {
    if (!summary || kitBusy) return;
    if (!requireKey()) return;
    setKitBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await aiApi.post<{ summary: SummaryListItem }>(`/summaries/${summary.id}/study-kit`);
      setSummary(data.summary);
      setReviewState({ ...emptyReviewState, ...(data.summary.reviewState ?? {}) });
      setTab('cards');
      setNotice('أصبحت حزمة المراجعة جاهزة ومحفوظة مع الملخص.');
    } catch (caught) {
      if (isKeyProblem(caught)) openActivation('activate');
      setError(caught instanceof ApiError ? caught.message : 'تعذّر بناء حزمة المراجعة.');
    } finally {
      setKitBusy(false);
    }
  }

  async function saveReview(patch: {
    cards?: Record<string, SummaryCardStatus>;
    quiz?: Record<string, { correct: boolean; answer: string }>;
    resetQuiz?: boolean;
  }) {
    if (!summary) return;
    setReviewState((current) => ({
      cards: { ...current.cards, ...(patch.cards ?? {}) },
      quiz: patch.resetQuiz
        ? { ...(patch.quiz ?? {}) }
        : { ...current.quiz, ...(patch.quiz ?? {}) },
      updatedAt: new Date().toISOString(),
    }));
    setSaving(true);
    try {
      const data = await api.patch<{ reviewState: SummaryReviewState }>(`/summaries/${summary.id}/review`, patch);
      setReviewState(data.reviewState);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حفظ تقدم المراجعة. حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (busy || !summary) return;
    if (!window.confirm('حذف هذا الملخص وحزمة المراجعة المرتبطة به نهائيًا؟')) return;
    setBusy(true);
    try {
      await api.del(`/summaries/${summary.id}`);
      navigate('/summary', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حذف الملخص.');
      setBusy(false);
    }
  }

  async function share() {
    if (!summary) return;
    const shareData = {
      title: summary.title,
      text: `ملخص من نيرد: ${summary.title}`,
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setNotice('تم نسخ رابط الملخص.');
      }
    } catch {
      setNotice('يمكنك نسخ رابط الصفحة من شريط المتصفح.');
    }
  }

  if (!summary) {
    return (
      <AppShell>
        {error ? <Alert>{error}</Alert> : <FullPageLoader label="جار تحميل الملخص…" />}
      </AppShell>
    );
  }

  const tabs: Array<{ id: TabId; label: string; icon: typeof FileText; count?: number }> = [
    { id: 'summary', label: 'الملخص', icon: FileText },
    ...(kit
      ? [
          { id: 'cards' as const, label: 'بطاقات الفلاش', icon: Layers, count: kit.flashcards.length },
          { id: 'points' as const, label: 'أهم النقاط', icon: ListChecks },
          { id: 'terms' as const, label: 'المصطلحات', icon: Languages },
          { id: 'quiz' as const, label: 'اختبر حالك', icon: ClipboardCheck, count: kit.quiz.length },
          ...(kit.visual && kit.visual.branches.length > 0 ? [{ id: 'map' as const, label: 'المخطط', icon: Map }] : []),
        ]
      : []),
  ];

  return (
    <AppShell>
      <Link to="/summary" className="inline-flex w-fit items-center gap-1 text-xs font-bold text-[var(--muted)] transition hover:text-[var(--accent)]">
        <ArrowRight size={15} /> كل الملخصات
      </Link>

      <section className="study-hero">
        <div className="study-hero-main">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <span className="badge badge-lavender">{summary.detailLevelLabel}</span>
              {summary.contentId ? <span className="badge badge-mint">محتوى مرفوع</span> : <span className="badge badge-blue">كتاب</span>}
              <span className="badge badge-yellow">محفوظ تلقائيًا</span>
            </div>
            <h1>{summary.title}</h1>
            <p>
              {[summary.bookTitle, summary.rangeLabel, `${summary.pagesCount} صفحة مصدر`, formatDateTime(summary.createdAt)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="study-hero-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void share()}>
              <Share2 size={14} /> مشاركة
            </button>
            {(summary.contentId || summary.bookId) && (
              <Link
                to={summary.contentId ? `/content/${summary.contentId}` : `/books/${summary.bookId}`}
                className="btn btn-ghost btn-sm"
              >
                <BookOpen size={14} /> المصدر
              </Link>
            )}
            <button type="button" className="btn btn-ghost btn-sm text-[var(--color-bad)]" onClick={() => void remove()} disabled={busy}>
              <Trash2 size={14} /> حذف
            </button>
          </div>
        </div>

        <div className="study-progress-panel">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-bold">تقدمك في المراجعة</span>
            <span className="text-[var(--muted)]">{saving ? 'جار حفظ التقدم…' : `${stats.percent}%`}</span>
          </div>
          <Progress value={stats.percent} max={100} />
          {kit ? (
            <div className="study-progress-meta">
              <span><Layers size={13} /> {stats.known} بطاقة محفوظة من {kit.flashcards.length}</span>
              <span><ClipboardCheck size={13} /> {stats.quizCorrect} إجابة صحيحة من {kit.quiz.length}</span>
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              تبدأ المراجعة بعد إنشاء البطاقات والأسئلة من هذا الملخص.
            </p>
          )}
        </div>
      </section>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {kitBusy && (
        <div className="study-processing" role="status" aria-live="polite">
          <Loader2 size={19} className="animate-spin" />
          <div>
            <p className="text-sm font-bold">جار استخراج بطاقات المراجعة والأسئلة…</p>
            <p className="mt-0.5 text-[11px] leading-6 text-[var(--muted)]">
              نقرأ الملخص المحفوظ فقط، ثم نبني البطاقات والنقاط والمصطلحات. ستُحفظ النتيجة ولن تحتاج إلى إعادة التوليد عند فتح الملخص لاحقًا.
            </p>
          </div>
        </div>
      )}

      {!kit && !kitBusy && (
        <section className="study-kit-invite">
          <div className="study-kit-invite-icon"><Sparkles size={24} /></div>
          <div className="min-w-0 flex-1">
            <h2>حوّل الملخص إلى جلسة مراجعة</h2>
            <p>بطاقات فلاش، أهم النقاط، المصطلحات، مخطط بصري، واختبار قصير — كلها مستخرجة من هذا الملخص ومحفوظة معه.</p>
            {!hasKey && <p className="mt-1 text-[11px] font-bold text-[var(--accent)]">تحتاج تفعيل مفتاح Groq مرة واحدة لإنشاء الحزمة.</p>}
          </div>
          <button type="button" className="btn btn-primary shrink-0" onClick={() => void generateKit()}>
            <Sparkles size={16} /> أنشئ حزمة المراجعة
          </button>
        </section>
      )}

      {kit && (
        <>
          <StudyTabs tabs={tabs} active={tab} onChange={(value) => setTab(value as TabId)} />

          {tab === 'summary' && (
            <div className="study-content-grid">
              <section className="summary-paper">
                <div className="summary-paper-head">
                  <span>ملخص الدرس</span>
                  <span>{summary.pagesCount} صفحة مصدر</span>
                </div>
                <SummaryBody content={summary.content} />
                <PageLinks bookId={summary.bookId} contentId={summary.contentId} pages={summary.pages} />
              </section>

              <aside className="study-side">
                {kit.overview && (
                  <div className="study-overview">
                    <span className="study-overview-label">الفكرة العامة</span>
                    <p>{kit.overview}</p>
                  </div>
                )}
                <button type="button" className="study-start-card" onClick={() => setTab('cards')}>
                  <span className="study-start-icon"><Layers size={20} /></span>
                  <span>
                    <strong>ابدأ ببطاقات الفلاش</strong>
                    <small>{kit.flashcards.length} بطاقة · راجع ثم اختبر نفسك</small>
                  </span>
                  <ArrowRight size={16} className="rotate-180" />
                </button>
                <div className="study-mini-stats">
                  <div><strong>{kit.keyPoints.length}</strong><span>أهم نقطة</span></div>
                  <div><strong>{kit.definitions.length}</strong><span>مصطلح</span></div>
                  <div><strong>{kit.quiz.length}</strong><span>سؤال</span></div>
                </div>
                <button type="button" className="btn btn-soft w-full" onClick={() => setTab('quiz')}>
                  <ClipboardCheck size={15} /> اختبر حالك
                </button>
              </aside>
            </div>
          )}

          {tab === 'cards' && (
            <FlashcardReview
              kit={kit}
              state={reviewState}
              onRate={(cardId, status) => void saveReview({ cards: { [cardId]: status } })}
            />
          )}

          {tab === 'points' && (
            <div className="study-tab-page">
              <KeyPointsView kit={kit} />
              <StudyExtras kit={kit} />
            </div>
          )}

          {tab === 'terms' && (
            <div className="study-tab-page">
              <DefinitionsView kit={kit} />
            </div>
          )}

          {tab === 'quiz' && (
            <QuizReview
              kit={kit}
              state={reviewState}
              onAnswer={(questionId, correct, answer) =>
                void saveReview({ quiz: { [questionId]: { correct, answer } } })
              }
              onReset={() => void saveReview({ resetQuiz: true, quiz: {} })}
            />
          )}

          {tab === 'map' && (
            <div className="study-tab-page">
              <VisualMapView kit={kit} />
            </div>
          )}
        </>
      )}

      {!kit && (
        <section className="summary-paper">
          <div className="summary-paper-head">
            <span>ملخص الدرس</span>
            <span>{summary.pagesCount} صفحة مصدر</span>
          </div>
          <SummaryBody content={summary.content} />
          <PageLinks bookId={summary.bookId} contentId={summary.contentId} pages={summary.pages} />
        </section>
      )}

      {kit && tab === 'summary' && <StudyExtras kit={kit} />}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
        <p className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
          <CheckCircle2 size={13} /> {summary.pages.length} صفحة موثّقة من مصدرك
        </p>
        {kit && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void generateKit()} disabled={kitBusy}>
            <Sparkles size={14} /> أعد بناء حزمة المراجعة
          </button>
        )}
      </div>
    </AppShell>
  );
}
