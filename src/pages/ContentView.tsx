import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarDays,
  Check,
  Clock,
  FileText,
  FolderOpen,
  ImagePlus,
  Layers,
  ListChecks,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, EmptyState, Field, PageHeader, Progress, StatTile } from '../components/ui.tsx';
import { api, ApiError, formatDate, formatDateTime } from '../lib/api.ts';
import { aiApi, isKeyProblem } from '../lib/aiApi.ts';
import { getAiKey } from '../lib/aiKey.ts';
import { useAiAccess } from '../components/AiAccess.tsx';
import type {
  ContentDetailResponse,
  ContentListItem,
  ContentPage,
} from '../lib/contentTypes.ts';
import type { DetailLevel, SummaryResponse } from '../lib/aiTypes.ts';
import type { CreateTestResponse, QuestionType, TestDifficulty } from '../lib/testTypes.ts';
import type { MetaPayload } from '../lib/types.ts';

type Panel = 'exam' | 'summary' | 'teacher' | null;
type ExamType = QuestionType;

const levelOptions: Array<{ value: DetailLevel; label: string; hint: string }> = [
  { value: 'short', label: 'مختصر', hint: 'نقاط سريعة' },
  { value: 'medium', label: 'متوسط', hint: 'أفكار ومصطلحات' },
  { value: 'detailed', label: 'تفصيلي', hint: 'شرح موسّع' },
];

const summaryFocuses = [
  ['', 'عام'],
  ['key_ideas', 'أهم الأفكار'],
  ['definitions', 'التعريفات'],
  ['laws', 'القوانين'],
  ['comparisons', 'المقارنات'],
  ['causes', 'الأسباب والنتائج'],
] as const;

const questionTypes: Array<{ value: ExamType; label: string }> = [
  { value: 'mcq', label: 'اختيار من متعدد' },
  { value: 'true_false', label: 'صح وخطأ' },
  { value: 'fill_blank', label: 'أكمل الفراغ' },
  { value: 'explain', label: 'علّل' },
  { value: 'compare', label: 'قارن' },
  { value: 'essay', label: 'مقالي' },
  { value: 'math', label: 'مسائل حسابية' },
  { value: 'short', label: 'إجابة قصيرة' },
];

const difficulties: Array<{ value: TestDifficulty; label: string; hint: string }> = [
  { value: 'easy', label: 'سهل', hint: 'تطبيق مباشر وفهم أساسي.' },
  { value: 'medium', label: 'متوسط', hint: 'فهم وتطبيق في سياقات متنوعة.' },
  { value: 'hard', label: 'صعب', hint: 'تحليل وتفاصيل وحالات متشابهة.' },
  { value: 'advanced', label: 'قدرات عليا', hint: 'استنتاج متعدد الخطوات على النمط الوزاري.' },
];

const statusLabels: Record<string, string> = {
  draft: 'مسودة',
  pending: 'في الانتظار',
  extracting: 'قيد المعالجة',
  ready: 'جاهز',
  needs_review: 'يحتاج مراجعة',
  failed: 'تعذّرت المعالجة',
  done: 'مقروءة',
  empty: 'فارغة',
  review: 'تحتاج مراجعة',
};

function statusBadge(status: string): string {
  if (status === 'ready' || status === 'done') return 'badge badge-mint';
  if (status === 'failed') return 'badge badge-pink';
  if (status === 'needs_review' || status === 'review' || status === 'empty') return 'badge badge-yellow';
  if (status === 'pending' || status === 'extracting') return 'badge badge-blue';
  return 'badge';
}

function timeLabel(seconds: number | null): string | null {
  if (seconds == null) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function pageSourceLabel(page: ContentPage): string {
  if (page.sourceKind === 'video_frame') return 'إطار فيديو';
  if (page.sourceKind === 'transcript') return 'تفريغ صوتي';
  if (page.sourceKind === 'text') return 'نص';
  if (page.sourceKind === 'pdf') return 'PDF';
  return 'صورة';
}

export default function ContentViewPage() {
  const { id } = useParams();
  const contentId = Number(id);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { requireKey, hasKey, openActivation } = useAiAccess();
  const [data, setData] = useState<ContentDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(() => {
    const task = params.get('task');
    return task === 'exam' || task === 'summary' || task === 'teacher' ? task : null;
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [pageTexts, setPageTexts] = useState<Record<number, string>>({});
  const [textLoading, setTextLoading] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editGrade, setEditGrade] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [meta, setMeta] = useState<MetaPayload | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const [examCount, setExamCount] = useState(10);
  const [examDifficulty, setExamDifficulty] = useState<TestDifficulty>('medium');
  const [examTypes, setExamTypes] = useState<ExamType[]>(['mcq', 'true_false', 'short']);
  const [examTimed, setExamTimed] = useState(true);
  const [examMinutes, setExamMinutes] = useState('');
  const [examShowAnswers, setExamShowAnswers] = useState<'after_finish' | 'after_each'>('after_finish');
  const [examFocus, setExamFocus] = useState('');
  const [examBusy, setExamBusy] = useState(false);

  const [summaryLevel, setSummaryLevel] = useState<DetailLevel>('medium');
  const [summaryFocus, setSummaryFocus] = useState('');
  const [summaryTopic, setSummaryTopic] = useState('');
  const [summaryBusy, setSummaryBusy] = useState(false);

  const load = useCallback(
    async (quiet = false) => {
      if (!Number.isInteger(contentId) || contentId <= 0) {
        setError('محتوى غير صحيح.');
        return;
      }
      try {
        const response = await api.get<ContentDetailResponse>(`/contents/${contentId}`);
        setData(response);
        setEditTitle(response.content.title);
        setEditSubject(response.content.subjectId ? String(response.content.subjectId) : '');
        setEditGrade(response.content.gradeLevelId ? String(response.content.gradeLevelId) : '');
        if (!quiet) setError(null);
      } catch (caught) {
        if (!quiet) setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل المحتوى.');
      }
    },
    [contentId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<MetaPayload>('/meta')
      .then((value) => {
        if (!cancelled) setMeta(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const processing =
    data?.content.status === 'pending' ||
    data?.content.status === 'extracting' ||
    data?.pages.some((page) => page.status === 'pending');

  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => void load(true), 2600);
    return () => window.clearInterval(timer);
  }, [processing, load]);

  const content = data?.content;
  const curriculum = meta?.curricula[0] ?? null;
  const ready = content ? ['ready', 'needs_review'].includes(content.status) : false;
  const donePages = data?.pages.filter((page) => !['pending', 'extracting'].includes(page.status)).length ?? 0;
  const firstImage = data?.pages.find((page) => page.hasImage);
  const totalResults = (content?.counts.tests ?? 0) + (content?.counts.summaries ?? 0) + (content?.counts.conversations ?? 0);

  async function runAction(name: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تنفيذ العملية.');
    } finally {
      setBusy(null);
    }
  }

  async function saveMeta() {
    await runAction('edit', async () => {
      await api.patch<{ content: ContentListItem }>(`/contents/${contentId}`, {
        title: editTitle.trim(),
        subjectId: editSubject ? Number(editSubject) : null,
        gradeLevelId: editGrade ? Number(editGrade) : null,
      });
      setEditOpen(false);
      setNotice('تم تحديث بيانات الموضوع.');
      await load(true);
    });
  }

  async function suggestTitle() {
    if (suggesting) return;
    if (!requireKey()) return;
    setSuggesting(true);
    setError(null);
    try {
      const key = getAiKey();
      const response = await fetch(`/api/contents/${contentId}/suggest-title`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(key ? { 'X-AI-Key': key } : {}) },
        body: '{}',
      });
      const payload = (await response.json().catch(() => null)) as
        | { title?: string; error?: { message?: string } }
        | null;
      if (!response.ok || !payload?.title) {
        throw new ApiError(response.status, payload?.error?.message ?? 'تعذّر اقتراح عنوان.');
      }
      setEditTitle(payload.title);
    } catch (caught) {
      if (isKeyProblem(caught)) openActivation('activate');
      setError(caught instanceof ApiError ? caught.message : 'تعذّر اقتراح عنوان.');
    } finally {
      setSuggesting(false);
    }
  }

  async function reprocess() {
    if (!window.confirm('إعادة معالجة المحتوى كله؟ سيبقى المحتوى السابق والنتائج، لكن النص المستخرج سيُحدَّث.')) return;
    await runAction('reprocess', async () => {
      await api.post(`/contents/${contentId}/reprocess`);
      setNotice('بدأت إعادة المعالجة. ستُحدَّث الصفحات تلقائيًا.');
      await load(true);
    });
  }

  async function cancelProcessing() {
    await runAction('cancel', async () => {
      await api.post(`/contents/${contentId}/cancel`);
      setNotice('أُلغيت المعالجة. النص المستخرج حتى الآن محفوظ، ويمكنك استئناف المعالجة.');
      await load(true);
    });
  }

  async function resumeProcessing() {
    await runAction('resume', async () => {
      await api.post(`/contents/${contentId}/resume`);
      setNotice('استُؤنفت معالجة الفيديو من آخر جزء ناجح، دون إعادة استخراج ما اكتمل.');
      await load(true);
    });
  }

  async function removeContent() {
    if (!content) return;
    if (!window.confirm(`حذف «${content.title}» مع ملخصاته واختباراته ومحادثاته؟ لا يمكن التراجع.`)) return;
    await runAction('delete', async () => {
      await api.del(`/contents/${contentId}`);
      navigate('/content', { replace: true });
    });
  }

  async function addPages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const key = getAiKey();
    await runAction('add', async () => {
      const form = new FormData();
      Array.from(files).forEach((file) => form.append('files', file));
      const response = await fetch(`/api/contents/${contentId}/pages`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: key ? { 'X-AI-Key': key } : {},
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new ApiError(response.status, payload?.error?.message ?? 'تعذّرت إضافة الصفحات.');
      setNotice('أُضيفت الصفحات وبدأت قراءتها. النتائج القديمة باقية ومعلّمة بأنها من نسخة سابقة.');
      await load(true);
    });
  }

  async function movePage(index: number, direction: -1 | 1) {
    if (!data || busy) return;
    const target = index + direction;
    if (target < 0 || target >= data.pages.length) return;
    const reordered = [...data.pages];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setData({ ...data, pages: reordered });
    setBusy('order');
    setError(null);
    try {
      await api.patch(`/contents/${contentId}/pages/order`, { pageIds: reordered.map((page) => page.id) });
      setNotice('تم حفظ ترتيب الصفحات. النتائج السابقة أُنشئت من ترتيب سابق.');
      await load(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حفظ الترتيب.');
      await load(true);
    } finally {
      setBusy(null);
    }
  }

  async function removePage(page: ContentPage) {
    if (!window.confirm(`حذف الصفحة ${page.pageNumber}؟`)) return;
    await runAction(`page-${page.id}`, async () => {
      await api.del(`/contents/${contentId}/pages/${page.id}`);
      setNotice('حُذفت الصفحة وأُعيد بناء فهرس النص.');
      await load(true);
    });
  }

  async function reprocessPage(page: ContentPage) {
    await runAction(`page-${page.id}`, async () => {
      await api.post(`/contents/${contentId}/pages/${page.id}/reprocess`);
      setNotice('أُعيدت قراءة الصفحة.');
      await load(true);
    });
  }

  function toggleExamType(type: ExamType) {
    setExamTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  async function createExam(event: FormEvent) {
    event.preventDefault();
    if (examBusy) return;
    if (examTypes.length === 0) {
      setError('اختر نوع سؤال واحدًا على الأقل.');
      return;
    }
    if (!requireKey()) return;
    setExamBusy(true);
    setError(null);
    try {
      const result = await aiApi.post<CreateTestResponse>('/tests', {
        contentId,
        count: examCount,
        difficulty: examDifficulty,
        types: examTypes,
        focus: examFocus.trim() || null,
        timed: examTimed,
        durationMinutes: examTimed && examMinutes ? Number(examMinutes) : null,
        showAnswers: examShowAnswers,
      });
      navigate(`/tests/${result.test.id}`, { state: { warning: result.warning } });
    } catch (caught) {
      if (isKeyProblem(caught)) openActivation('activate');
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إنشاء الاختبار.');
    } finally {
      setExamBusy(false);
    }
  }

  async function createSummary(event: FormEvent) {
    event.preventDefault();
    if (summaryBusy) return;
    if (!requireKey()) return;
    setSummaryBusy(true);
    setError(null);
    try {
      const result = await aiApi.post<SummaryResponse>('/summaries', {
        contentId,
        detailLevel: summaryLevel,
        focusKind: summaryFocus || null,
        focus: summaryTopic.trim() || null,
      });
      navigate(`/summary/${result.summary.id}`);
    } catch (caught) {
      if (isKeyProblem(caught)) openActivation('activate');
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إنشاء الملخص.');
    } finally {
      setSummaryBusy(false);
    }
  }

  if (error && !data) {
    return (
      <AppShell>
        <Alert>{error}</Alert>
        <Link to="/content" className="btn btn-ghost mt-3">العودة إلى مكتبتي</Link>
      </AppShell>
    );
  }

  async function togglePageText(pageId: number) {
    if (pageTexts[pageId] != null) {
      setPageTexts((value) => {
        const next = { ...value };
        delete next[pageId];
        return next;
      });
      return;
    }
    if (!id || textLoading) return;
    setTextLoading(pageId);
    try {
      const result = await api.get<{ text: string }>(`/contents/${id}/pages/${pageId}/text`);
      setPageTexts((value) => ({ ...value, [pageId]: result.text || 'لا يوجد نص مستخرج لهذه الصفحة.' }));
    } catch {
      setPageTexts((value) => ({ ...value, [pageId]: 'تعذّر تحميل النص الكامل. حاول مرة أخرى.' }));
    } finally {
      setTextLoading(null);
    }
  }

  if (!data || !content) {
    return (
      <AppShell>
        <div className="card p-4">
          <div className="skeleton h-8 w-1/2 rounded" />
          <div className="skeleton mt-3 h-44 rounded-xl" />
          <div className="skeleton mt-3 h-4 w-2/3 rounded" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="محتوى دراسي"
        title={content.title}
        subtitle={[
          content.sourceTypeLabel,
          content.subjectName,
          content.gradeName,
          `${content.pagesCount} صفحة`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/content" className="btn btn-ghost">
              <ArrowLeft size={16} /> مكتبتي
            </Link>
            <button type="button" className="btn btn-soft" onClick={() => setEditOpen((value) => !value)}>
              <Pencil size={15} /> تعديل
            </button>
          </div>
        }
      />

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {content.status === 'needs_review' && (
        <div className="notice-card card flex items-start gap-3 border-[var(--line)] bg-[color-mix(in_srgb,var(--yellow)_22%,var(--surface))] p-3.5">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">بعض الصفحات تحتاج مراجعة</p>
            <p className="muted mt-0.5 text-xs leading-6">
              {content.errorMessage ?? 'النص مستخرج لكن بعض الصور غير واضحة. يمكنك إعادة تصويرها أو إعادة قراءة الصفحة.'}
            </p>
          </div>
        </div>
      )}

      {content.status === 'failed' && (
        <div className="notice-card card flex items-start gap-3 bg-[color-mix(in_srgb,var(--pink)_25%,var(--surface))] p-3.5">
          <X size={18} className="mt-0.5 shrink-0 text-[var(--danger)]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {content.processing?.stage === 'cancelled' ? 'أوقفت المعالجة' : 'لم تكتمل معالجة المحتوى'}
            </p>
            <p className="muted mt-0.5 text-xs leading-6">{content.errorMessage ?? 'حدّث الصفحات أو أعد المحاولة.'}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {content.sourceType === 'video' && (
                <button
                  type="button"
                  className="btn btn-primary min-h-8 px-3 text-xs"
                  onClick={() => void resumeProcessing()}
                  disabled={busy === 'resume'}
                >
                  {busy === 'resume' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  استئناف من آخر جزء
                </button>
              )}
              <button type="button" className="btn btn-soft min-h-8 px-3 text-xs" onClick={() => void reprocess()}>
                <RefreshCw size={14} /> إعادة المحاولة من البداية
              </button>
            </div>
          </div>
        </div>
      )}

      {(content.status === 'pending' || content.status === 'extracting') && (
        <section className="card p-4">
          <div className="flex items-center gap-2">
            <Loader2 size={18} className="animate-spin text-[var(--accent)]" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{content.processing?.label ?? 'جارٍ تجهيز المحتوى…'}</p>
              <p className="muted text-xs">يمكنك ترك الصفحة؛ المعالجة تكمل في الخادم، والنص يُحفظ أولًا بأول.</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm shrink-0"
              onClick={() => void cancelProcessing()}
              disabled={busy === 'cancel'}
            >
              <X size={14} /> {busy === 'cancel' ? 'جارٍ الإلغاء…' : 'إلغاء'}
            </button>
          </div>
          <div className="mt-3">
            <Progress
              value={content.processing?.percent ?? donePages}
              max={content.processing ? 100 : Math.max(data.pages.length, 1)}
            />
            <p className="muted mt-1 text-[11px]">
              {content.processing
                ? `${Math.round(content.processing.percent)}% · ${content.processing.label}`
                : `${donePages} من ${data.pages.length} صفحة`}
            </p>
            {content.processing?.segmentsTotal ? (
              <p className="muted mt-1 text-[11px]" dir="rtl">
                أجزاء الفيديو: {content.processing.segmentsProcessed ?? 0} من {content.processing.segmentsTotal}
                {content.processing.durationSeconds
                  ? ` · المدة ${Math.floor(content.processing.durationSeconds / 60)}:${String(content.processing.durationSeconds % 60).padStart(2, '0')}`
                  : ''}
              </p>
            ) : null}
          </div>
        </section>
      )}

      {content.needsRefresh && totalResults > 0 && (
        <div className="notice-card card flex items-start gap-3 border-[var(--line)] bg-[color-mix(in_srgb,var(--blue)_18%,var(--surface))] p-3.5">
          <RefreshCw size={17} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <div>
            <p className="text-sm font-semibold">النتائج الحالية من نسخة سابقة</p>
            <p className="muted mt-0.5 text-xs leading-6">
              أضفت صفحات أو غيّرت ترتيبها بعد إنشاء الملخصات والاختبارات. النتائج محفوظة، ويمكنك إنشاء نسخة
              جديدة من المحتوى المحدّث.
            </p>
          </div>
        </div>
      )}

      {editOpen && (
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">تعديل بيانات الموضوع</h2>
            <button type="button" className="icon-btn is-sm" onClick={() => setEditOpen(false)} aria-label="إغلاق">
              <X size={15} />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="عنوان الموضوع" htmlFor="editContentTitle">
                <div className="flex gap-2">
                  <input
                    id="editContentTitle"
                    className="input"
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    maxLength={160}
                  />
                  <button
                    type="button"
                    className="btn btn-soft shrink-0 px-3 text-xs"
                    onClick={() => void suggestTitle()}
                    disabled={suggesting || !ready}
                    title="اقتراح عنوان من النص باستخدام الذكاء الاصطناعي"
                  >
                    {suggesting ? <Loader2 size={14} className="animate-spin" /> : <WandSparkles size={14} />}
                    اقتراح
                  </button>
                </div>
              </Field>
            </div>
            <Field label="المادة" htmlFor="editContentSubject">
              <select
                id="editContentSubject"
                className="input"
                value={editSubject}
                onChange={(event) => setEditSubject(event.target.value)}
              >
                <option value="">بدون تحديد</option>
                {curriculum?.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>{subject.name}</option>
                ))}
              </select>
            </Field>
            <Field label="الصف" htmlFor="editContentGrade">
              <select
                id="editContentGrade"
                className="input"
                value={editGrade}
                onChange={(event) => setEditGrade(event.target.value)}
              >
                <option value="">بدون تحديد</option>
                {curriculum?.grades.map((grade) => (
                  <option key={grade.id} value={grade.id}>{grade.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <button type="button" className="btn btn-primary mt-3" onClick={() => void saveMeta()} disabled={busy === 'edit'}>
            {busy === 'edit' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            حفظ البيانات
          </button>
        </section>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
        <StatTile tint="blue" label="صفحات المحتوى" value={String(content.pagesCount)} />
        <StatTile tint="mint" label="حروف مستخرجة" value={content.textChars.toLocaleString('ar-JO')} />
        <StatTile tint="lavender" label="اختبارات وملخصات" value={String((content.counts.tests ?? 0) + (content.counts.summaries ?? 0))} />
        <StatTile tint="yellow" label="محادثات" value={String(content.counts.conversations)} />
      </div>

      <section className="card overflow-hidden p-0">
        <div className="grid gap-0 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="min-h-48 border-b border-[var(--line-soft)] bg-[var(--surface-hover)] sm:border-b-0 sm:border-e">
            {content.sourceType === 'video' && content.hasSourceFile ? (
              <video
                controls
                preload="metadata"
                className="size-full max-h-80 bg-black object-contain"
                src={`/api/contents/${content.id}/file`}
              />
            ) : content.sourceType === 'pdf' && content.hasSourceFile ? (
              <div className="grid min-h-48 place-items-center p-5 text-center">
                <div>
                  <span className="mx-auto grid size-16 place-items-center rounded-2xl border-2 border-[var(--line)] bg-[var(--pink)] text-[#25251f]">
                    <FileText size={30} />
                  </span>
                  <p className="mt-2 text-sm font-semibold">ملف PDF محفوظ</p>
                  <a href={`/api/contents/${content.id}/file`} target="_blank" rel="noreferrer" className="btn btn-soft mt-2">
                    فتح الملف
                  </a>
                </div>
              </div>
            ) : firstImage?.imageUrl ? (
              <a href={firstImage.imageUrl} target="_blank" rel="noreferrer" className="block">
                <img src={firstImage.imageUrl} alt="معاينة المحتوى" className="max-h-80 w-full object-contain" />
              </a>
            ) : (
              <div className="grid min-h-48 place-items-center p-5 text-center">
                <div>
                  <span className="mx-auto grid size-16 place-items-center rounded-2xl border-2 border-[var(--line)] bg-[var(--mint)] text-[#25251f]">
                    <FileText size={30} />
                  </span>
                  <p className="mt-2 text-sm font-semibold">محتوى نصي</p>
                  <p className="muted text-xs">{content.textChars.toLocaleString('ar-JO')} حرف مستخرج</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={statusBadge(content.status)}>{statusLabels[content.status] ?? content.status}</span>
              <span className="badge"><Layers size={11} /> {content.sourceTypeLabel}</span>
              <span className="badge"><CalendarDays size={11} /> {formatDate(content.createdAt)}</span>
              {content.durationSeconds ? <span className="badge"><Clock size={11} /> {Math.round(content.durationSeconds / 60)} دقيقة</span> : null}
            </div>

            <p className="muted text-xs leading-6">
              {content.hasImages
                ? 'المحتوى محفوظ كصور وصفحات نصية. يمكنك إضافة صفحات جديدة أو إعادة قراءة صفحة غير واضحة دون رفع الدرس من جديد.'
                : 'النص المستخرج محفوظ كفهرس كامل. كل أداة تعمل على هذا النص نفسه.'}
            </p>

            {content.transcriptPreview && (
              <div className="rounded-[13px_9px_15px_10px] border-2 border-[var(--line-soft)] bg-[var(--surface-hover)] p-2.5">
                <p className="text-xs font-semibold">تفريغ صوت الفيديو</p>
                <p className="muted mt-0.5 line-clamp-3 text-[11px] leading-6">{content.transcriptPreview}</p>
              </div>
            )}
            {content.transcriptStatus === 'failed' && (
              <p className="text-[11px] leading-5 text-[var(--danger)]">
                تعذّر تفريغ الصوت: {content.transcriptError ?? 'حاول لاحقًا.'}
              </p>
            )}
            {content.transcriptStatus === 'skipped' && content.transcriptError && (
              <p className="muted text-[11px] leading-5">{content.transcriptError}</p>
            )}

            <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--line-soft)] pt-3">
              <button type="button" className="btn btn-soft btn-sm" onClick={() => addRef.current?.click()} disabled={busy === 'add'}>
                {busy === 'add' ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                إضافة صفحات
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reprocess()} disabled={busy === 'reprocess' || processing}>
                {busy === 'reprocess' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                إعادة معالجة
              </button>
              <button type="button" className="btn btn-ghost btn-sm text-[var(--danger)]" onClick={() => void removeContent()} disabled={busy === 'delete'}>
                <Trash2 size={14} /> حذف
              </button>
              <input
                ref={addRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(event) => {
                  void addPages(event.target.files);
                  event.target.value = '';
                }}
              />
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Presentation size={18} className="text-[var(--accent)]" />
            ابدأ مهمة من هذا المحتوى
          </h2>
          {!ready && <span className="badge badge-blue">تتاح بعد اكتمال المعالجة</span>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            className="feature-tile text-start"
            style={{ '--tile': 'var(--yellow)' } as CSSProperties}
            onClick={() => setPanel(panel === 'exam' ? null : 'exam')}
            disabled={!ready}
          >
            <span className="feature-icon"><Presentation size={20} /></span>
            <span className="mt-2 block font-bold">أنشئ امتحانًا</span>
            <span className="muted text-[11px] leading-5">عدد الأسئلة ونوعها وصعوبتها والمؤقت.</span>
          </button>
          <button
            type="button"
            className="feature-tile text-start"
            style={{ '--tile': 'var(--blue)' } as CSSProperties}
            onClick={() => setPanel(panel === 'summary' ? null : 'summary')}
            disabled={!ready}
          >
            <span className="feature-icon"><Sparkles size={20} /></span>
            <span className="mt-2 block font-bold">لخّص المحتوى</span>
            <span className="muted text-[11px] leading-5">مختصر أو متوسط أو مفصل، مع محور محدد.</span>
          </button>
          <Link
            to={`/ask-teacher?contentId=${content.id}`}
            className={`feature-tile text-start ${!ready ? 'pointer-events-none opacity-50' : ''}`}
            style={{ '--tile': 'var(--mint)' } as CSSProperties}
            aria-disabled={!ready}
          >
            <span className="feature-icon"><WandSparkles size={20} /></span>
            <span className="mt-2 block font-bold">اسأل المعلم</span>
            <span className="muted text-[11px] leading-5">حوّل سؤالك إلى درس تفاعلي من هذا المحتوى.</span>
          </Link>
          <Link
            to="/assistant"
            className="feature-tile text-start"
            style={{ '--tile': 'var(--lavender)' } as CSSProperties}
          >
            <span className="feature-icon"><MessageSquare size={20} /></span>
            <span className="mt-2 block font-bold">الدردشة الحرّة</span>
            <span className="muted text-[11px] leading-5">تحدث عن أي موضوع دون الحاجة إلى محتوى.</span>
          </Link>
        </div>
        {!hasKey && ready && (
          <p className="muted mt-2 text-xs">
            تحتاج مفتاح Groq لتشغيل الامتحان والملخص والمعلم.{' '}
            <button type="button" className="font-semibold text-[var(--accent)] underline" onClick={() => openActivation('activate')}>
              تفعيل الذكاء الاصطناعي
            </button>
          </p>
        )}
      </section>

      {panel === 'teacher' && (
        <section className="card space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">حوّل سؤالك إلى درس تفاعلي</h2>
            <button type="button" className="icon-btn is-sm" onClick={() => setPanel(null)} aria-label="إغلاق"><X size={15} /></button>
          </div>
          <p className="muted text-sm leading-7">
            سيفتح «اسأل المعلم» سؤالك عن هذا المحتوى كدرس مرتّب بعناوين وأقسام، مع إمكانية التنقل
            بالأسهم. المصادر هنا اختيارية، ويمكنك أيضًا طرح سؤال عام من دون محتوى.
          </p>
          <Link to={`/ask-teacher?contentId=${content.id}`} className="btn btn-primary">
            <WandSparkles size={16} /> افتح الدرس التفاعلي
          </Link>
        </section>
      )}

      {panel === 'exam' && (
        <form onSubmit={createExam} className="card space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">إعدادات الامتحان</h2>
            <button type="button" className="icon-btn is-sm" onClick={() => setPanel(null)} aria-label="إغلاق"><X size={15} /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="عدد الأسئلة" htmlFor="examCount">
              <input id="examCount" type="number" min={5} max={25} className="input" value={examCount} onChange={(event) => setExamCount(Math.max(5, Math.min(25, Number(event.target.value) || 5)))} />
            </Field>
            <Field label="مدة الاختبار (دقيقة)" htmlFor="examMinutes">
              <input
                id="examMinutes"
                type="number"
                min={3}
                max={180}
                className="input"
                placeholder="تلقائي"
                value={examMinutes}
                onChange={(event) => setExamMinutes(event.target.value)}
                disabled={!examTimed}
              />
            </Field>
            <Field label="محور محدد (اختياري)" htmlFor="examFocus">
              <input id="examFocus" className="input" value={examFocus} onChange={(event) => setExamFocus(event.target.value)} maxLength={200} placeholder="مثال: القوانين والتطبيقات" />
            </Field>
          </div>

          <div>
            <p className="muted mb-1 text-xs">أنواع الأسئلة — اختر ما تريد</p>
            <div className="flex flex-wrap gap-1.5">
              {questionTypes.map((item) => (
                <button key={item.value} type="button" className="chip" aria-pressed={examTypes.includes(item.value)} onClick={() => toggleExamType(item.value)}>
                  {examTypes.includes(item.value) && <Check size={12} />} {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="muted mb-1 text-xs">مستوى الصعوبة</p>
            <div className="flex flex-wrap gap-1.5">
              {difficulties.map((item) => (
                <button key={item.value} type="button" className="chip" aria-pressed={examDifficulty === item.value} onClick={() => setExamDifficulty(item.value)}>
                  {item.label}
                </button>
              ))}
            </div>
            <p className="muted mt-1 text-[11px]">
              {difficulties.find((item) => item.value === examDifficulty)?.hint}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[13px_9px_15px_10px] border-2 border-[var(--line-soft)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">مؤقت للاختبار</p>
                  <p className="muted text-[11px]">عند الإيقاف تحل بلا ضغط وقت.</p>
                </div>
                <button type="button" role="switch" aria-checked={examTimed} aria-label="المؤقت" className="switch" onClick={() => setExamTimed((value) => !value)} />
              </div>
            </div>
            <div className="rounded-[13px_9px_15px_10px] border-2 border-[var(--line-soft)] p-3">
              <p className="text-sm font-semibold">إظهار الإجابات</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button type="button" className="chip" aria-pressed={examShowAnswers === 'after_finish'} onClick={() => setExamShowAnswers('after_finish')}>بعد إنهاء الامتحان</button>
                <button type="button" className="chip" aria-pressed={examShowAnswers === 'after_each'} onClick={() => setExamShowAnswers('after_each')}>بعد كل سؤال</button>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary" disabled={examBusy || examTypes.length === 0}>
              {examBusy ? <Loader2 size={16} className="animate-spin" /> : <Presentation size={16} />}
              {examBusy ? 'جار إنشاء الامتحان…' : 'أنشئ الامتحان'}
            </button>
          </div>
        </form>
      )}

      {panel === 'summary' && (
        <form onSubmit={createSummary} className="card space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">إعدادات الملخص</h2>
            <button type="button" className="icon-btn is-sm" onClick={() => setPanel(null)} aria-label="إغلاق"><X size={15} /></button>
          </div>
          <div>
            <p className="muted mb-1 text-xs">حجم الملخص</p>
            <div className="grid grid-cols-3 gap-2">
              {levelOptions.map((item) => (
                <button key={item.value} type="button" className="choice-card" aria-pressed={summaryLevel === item.value} onClick={() => setSummaryLevel(item.value)}>
                  <span className="text-sm font-semibold">{item.label}</span>
                  <span className="muted text-[11px]">{item.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="muted mb-1 text-xs">ركّز على</p>
            <div className="flex flex-wrap gap-1.5">
              {summaryFocuses.map(([value, label]) => (
                <button key={value || 'general'} type="button" className="chip" aria-pressed={summaryFocus === value} onClick={() => setSummaryFocus(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Field label="موضوع محدد داخل المحتوى (اختياري)" htmlFor="summaryTopic">
            <input id="summaryTopic" className="input" value={summaryTopic} onChange={(event) => setSummaryTopic(event.target.value)} maxLength={200} placeholder="مثال: أسباب الانخفاض في درجة التجمد" />
          </Field>
          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary" disabled={summaryBusy}>
              {summaryBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {summaryBusy ? 'جار التلخيص…' : 'أنشئ الملخص'}
            </button>
          </div>
        </form>
      )}

      <section className="card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Layers size={18} className="text-[var(--accent)]" />
            صفحات المحتوى
            <span className="badge">{data.pages.length}</span>
          </h2>
          <div className="flex items-center gap-1.5">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => addRef.current?.click()} disabled={busy === 'add'}>
              <Plus size={14} /> إضافة
            </button>
          </div>
        </div>
        {data.pages.length === 0 ? (
          <p className="muted text-sm">لا توجد صفحات بعد.</p>
        ) : (
          <ul className="space-y-2">
            {data.pages.map((page, index) => (
              <li key={page.id} className="flex items-start gap-2 rounded-[13px_9px_15px_10px] border-2 border-[var(--line-soft)] bg-[var(--surface)] p-2">
                <div className="flex shrink-0 flex-col gap-0.5">
                  <button type="button" className="icon-btn is-sm" aria-label="تقديم الصفحة" disabled={index === 0 || busy === 'order'} onClick={() => void movePage(index, -1)}>
                    <ArrowUp size={12} />
                  </button>
                  <span className="text-center text-[10px] font-bold">{page.pageNumber}</span>
                  <button type="button" className="icon-btn is-sm" aria-label="تأخير الصفحة" disabled={index === data.pages.length - 1 || busy === 'order'} onClick={() => void movePage(index, 1)}>
                    <ArrowDown size={12} />
                  </button>
                </div>

                {page.imageUrl ? (
                  <a href={page.imageUrl} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={page.imageUrl} alt={`صفحة ${page.pageNumber}`} loading="lazy" className="h-20 w-16 rounded-lg border border-[var(--line-soft)] object-cover" />
                  </a>
                ) : (
                  <span className="grid h-20 w-16 shrink-0 place-items-center rounded-lg border border-[var(--line-soft)] bg-[var(--surface-hover)]">
                    <FileText size={18} className="text-[var(--accent)]" />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={statusBadge(page.status)}>{statusLabels[page.status] ?? page.status}</span>
                    <span className="badge text-[10px]">{pageSourceLabel(page)}</span>
                    {page.sourceTimeSeconds != null && <span className="badge text-[10px]"><Clock size={10} /> {timeLabel(page.sourceTimeSeconds)}</span>}
                    {page.confidence != null && <span className="muted text-[10px]">ثقة {page.confidence}%</span>}
                  </div>
                  <p className={`muted mt-1 text-[12px] leading-6 ${pageTexts[page.id] == null ? 'line-clamp-2' : 'max-h-56 overflow-auto whitespace-pre-wrap'}`}>
                    {pageTexts[page.id] ?? page.preview ?? page.errorMessage ?? 'لا يوجد نص مستخرج بعد.'}
                  </p>
                  {page.chars > 0 && (
                    <button
                      type="button"
                      className="mt-1 text-[10px] font-bold underline decoration-dashed"
                      onClick={() => void togglePageText(page.id)}
                      disabled={textLoading === page.id}
                    >
                      {textLoading === page.id
                        ? 'جار تحميل النص…'
                        : pageTexts[page.id] == null
                          ? `عرض النص الكامل (${page.chars} حرفًا)`
                          : 'إخفاء النص'}
                    </button>
                  )}
                  {page.errorMessage && page.status !== 'done' && (
                    <p className="mt-0.5 text-[11px] leading-5 text-[var(--danger)]">{page.errorMessage}</p>
                  )}
                  <div className="mt-1 flex gap-1">
                    {page.hasImage && (
                      <button type="button" className="btn btn-ghost min-h-7 px-2 text-[10px]" onClick={() => void reprocessPage(page)} disabled={busy === `page-${page.id}`}>
                        {busy === `page-${page.id}` ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} إعادة قراءة
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost min-h-7 px-2 text-[10px] text-[var(--danger)]" onClick={() => void removePage(page)} disabled={busy === `page-${page.id}`}>
                      <Trash2 size={12} /> حذف
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <FolderOpen size={18} className="text-[var(--accent)]" />
          نتائج هذا المحتوى
        </h2>

        {data.summaries.length === 0 && data.tests.length === 0 && data.conversations.length === 0 ? (
          <EmptyState
            title="لا توجد نتائج بعد"
            body="أنشئ امتحانًا أو ملخصًا أو افتح محادثة مع المعلم؛ كل نتيجة تُحفظ هنا وتعود إليها لاحقًا."
            icon={<Sparkles size={26} />}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="card p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold"><Sparkles size={15} /> الملخصات ({data.summaries.length})</h3>
              {data.summaries.length === 0 ? <p className="muted text-xs">لا ملخصات بعد.</p> : (
                <ul className="space-y-1.5">
                  {data.summaries.map((item) => (
                    <li key={item.id}>
                      <Link to={`/summary/${item.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line-soft)] p-2 text-xs hover:bg-[var(--surface-hover)]">
                        <span className="min-w-0 truncate font-semibold">{item.title}</span>
                        <span className="muted shrink-0">{item.detailLevel}</span>
                        {item.stale && <span className="badge badge-yellow text-[9px]">نسخة قديمة</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold"><ListChecks size={15} /> الاختبارات ({data.tests.length})</h3>
              {data.tests.length === 0 ? <p className="muted text-xs">لا اختبارات بعد.</p> : (
                <ul className="space-y-1.5">
                  {data.tests.map((item) => (
                    <li key={item.id}>
                      <Link to={`/tests/${item.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line-soft)] p-2 text-xs hover:bg-[var(--surface-hover)]">
                        <span className="min-w-0 truncate font-semibold">{item.title}</span>
                        <span className="muted shrink-0">{item.questionsCount} سؤالًا</span>
                        {item.stale && <span className="badge badge-yellow text-[9px]">نسخة قديمة</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold"><MessageSquare size={15} /> المحادثات ({data.conversations.length})</h3>
              {data.conversations.length === 0 ? <p className="muted text-xs">لا محادثات بعد.</p> : (
                <ul className="space-y-1.5">
                  {data.conversations.map((item) => (
                    <li key={item.id}>
                      <Link
                        to={`/assistant?conversation=${item.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line-soft)] p-2 text-xs hover:bg-[var(--surface-hover)]"
                      >
                        <span className="min-w-0 truncate font-semibold">{item.title}</span>
                        <span className="muted shrink-0">{item.messageCount} رسالة</span>
                        {item.stale && <span className="badge badge-yellow text-[9px]">نسخة قديمة</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      <p className="muted flex items-center gap-1 text-[11px]">
        <CalendarDays size={12} /> آخر تحديث {formatDateTime(content.updatedAt)} · الإصدار {content.version}
      </p>
    </AppShell>
  );
}
