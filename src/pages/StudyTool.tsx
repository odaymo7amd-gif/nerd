import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Calculator,
  ClipboardCheck,
  Copy,
  GraduationCap,
  Languages,
  PenLine,
  Sparkles,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, Field, PageHeader, SubmitButton } from '../components/ui.tsx';
import { useAiAccess } from '../components/AiAccess.tsx';
import { aiApi, isKeyProblem } from '../lib/aiApi.ts';
import { api, ApiError } from '../lib/api.ts';
import type { AiStatus, StudyToolLevel, StudyToolMode, StudyToolResult } from '../lib/aiTypes.ts';
import type { ContentListItem } from '../lib/contentTypes.ts';
import { PageLinks, SummaryBody } from './Summary.tsx';

const meta: Record<
  StudyToolMode,
  {
    title: string;
    eyebrow: string;
    subtitle: string;
    topicLabel: string;
    topicPlaceholder: string;
    notesLabel: string;
    notesPlaceholder: string;
    icon: typeof GraduationCap;
  }
> = {
  teacher: {
    title: 'شرح المعلم',
    eyebrow: 'افهم الدرس',
    subtitle: 'إجابة مرتبة حسب سؤالها: مباشرة للتعريف، وخطوات للشرح، وحل واضح للمسائل — من محتواك ومراجع الصفحات.',
    topicLabel: 'الموضوع أو الدرس الذي تريد شرحه',
    topicPlaceholder: 'مثال: أقسام الفعل في اللغة العربية، أو قانون نيوتن الثاني',
    notesLabel: 'ملاحظات إضافية (اختياري)',
    notesPlaceholder: 'مثال: اشرح بمستوى صفي، وأكثر من الأمثلة',
    icon: GraduationCap,
  },
  solver: {
    title: 'حل المسائل',
    eyebrow: 'خطوة بخطوة',
    subtitle: 'حل منظّم يوضح المعطيات والخطوات والتحقق، ولا يخترع أرقامًا ناقصة.',
    topicLabel: 'المسألة',
    topicPlaceholder: 'اكتب المسألة كاملة، مع الأرقام والوحدات إن وجدت…',
    notesLabel: 'ملاحظات أو قيود (اختياري)',
    notesPlaceholder: 'مثال: استخدم القانون العام فقط، واشرح كل خطوة',
    icon: Calculator,
  },
  grader: {
    title: 'التصحيح التلقائي',
    eyebrow: 'تقييم عادل',
    subtitle: 'قيّم إجابتك، واعرف نقاط القوة والأخطاء والإجابة النموذجية وخطوة التحسين.',
    topicLabel: 'السؤال',
    topicPlaceholder: 'اكتب السؤال أو المطلوب…',
    notesLabel: 'ملاحظات المعلم أو معايير إضافية (اختياري)',
    notesPlaceholder: 'مثال: خصص درجتين للأسلوب وثلاثًا للأفكار',
    icon: ClipboardCheck,
  },
  expression: {
    title: 'مساعد التعبير',
    eyebrow: 'اكتب بأسلوبك',
    subtitle: 'مخطط وأفكار ومسودة تعليمية وملاحظات لتحسين موضوع التعبير، لا موضوع جاهز للنسخ.',
    topicLabel: 'موضوع التعبير',
    topicPlaceholder: 'مثال: أثر القراءة في حياة الإنسان',
    notesLabel: 'الصف والطول والأسلوب (اختياري)',
    notesPlaceholder: 'مثال: الصف العاشر، 250 كلمة، أسلوب أدبي واضح',
    icon: PenLine,
  },
  'english-grammar': {
    title: 'قواعد الإنجليزية',
    eyebrow: 'Grammar',
    subtitle: 'قاعدة مشروحة وأمثلة مترجمة وتدريبات مع إجابات مشروحة.',
    topicLabel: 'القاعدة أو الموضوع',
    topicPlaceholder: 'مثال: Present Perfect، أو حروف الجر in/on/at',
    notesLabel: 'ملاحظات إضافية (اختياري)',
    notesPlaceholder: 'مثال: اشرح بالعربية وأعطِ أمثلة من الحياة اليومية',
    icon: Languages,
  },
};

const levels: Array<{ value: StudyToolLevel; label: string; hint: string }> = [
  { value: 'brief', label: 'مختصر', hint: 'الأساسيات بسرعة' },
  { value: 'standard', label: 'متوسط', hint: 'شرح متوازن' },
  { value: 'deep', label: 'مفصّل', hint: 'شرح موسّع' },
];

export default function StudyToolPage({ mode }: { mode: StudyToolMode }) {
  const info = meta[mode];
  const Icon = info.icon;
  const [searchParams] = useSearchParams();
  const initialContentId = searchParams.get('contentId') ?? '';
  const { hasKey, requireKey, openActivation } = useAiAccess();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [contents, setContents] = useState<ContentListItem[]>([]);
  const [contentId, setContentId] = useState(initialContentId);
  const [topic, setTopic] = useState('');
  const [answer, setAnswer] = useState('');
  const [rubric, setRubric] = useState('');
  const [notes, setNotes] = useState('');
  const [level, setLevel] = useState<StudyToolLevel>('standard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StudyToolResult | null>(null);
  const [copied, setCopied] = useState(false);

  const readyContents = useMemo(
    () => contents.filter((item) => item.status === 'ready' || item.status === 'needs_review'),
    [contents],
  );

  useEffect(() => {
    if (!initialContentId || topic.trim()) return;
    const selected = readyContents.find((item) => String(item.id) === initialContentId);
    if (selected) setTopic(selected.title);
  }, [initialContentId, readyContents, topic]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<AiStatus>('/ai/status'),
      api.get<{ contents: ContentListItem[] }>('/contents'),
    ])
      .then(([statusData, contentData]) => {
        if (cancelled) return;
        setStatus(statusData);
        setContents(contentData.contents);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل بيانات الأداة.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!requireKey()) return;
    if (topic.trim().length < 2) {
      setError(mode === 'solver' ? 'اكتب المسألة كاملة أولًا.' : 'اكتب الموضوع أو السؤال أولًا.');
      return;
    }
    if (mode === 'grader' && !answer.trim()) {
      setError('الصق إجابة الطالب حتى يستطيع التصحيح تقييمها.');
      return;
    }
    setBusy(true);
    setError(null);
    setCopied(false);
    setResult(null);
    try {
      const data = await aiApi.post<{ result: StudyToolResult }>('/ai/tools', {
        mode,
        contentId: contentId ? Number(contentId) : null,
        level,
        topic: topic.trim(),
        answer: mode === 'grader' ? answer.trim() : null,
        rubric: mode === 'grader' ? rubric.trim() || null : null,
        notes: notes.trim() || null,
      });
      setResult(data.result);
      if (status) {
        setStatus({
          ...status,
          usedToday: status.usedToday + 1,
          remaining: data.result.remainingToday,
        });
      }
    } catch (caught) {
      if (isKeyProblem(caught)) openActivation('activate');
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تشغيل الأداة. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow={info.eyebrow}
        title={info.title}
        subtitle={info.subtitle}
        actions={
          <span className="badge badge-yellow inline-flex items-center gap-1">
            <Icon size={13} />
            أداة ذكاء اصطناعي
          </span>
        }
      />

      {error && <Alert>{error}</Alert>}

      {!hasKey && (
        <Alert tone="info">
          <span className="inline-flex flex-wrap items-center gap-2">
            هذه الأداة تحتاج مفتاح Groq الخاص بك. أضفه مرة واحدة على هذا الجهاز، ولن يُحفظ على الخادم.
            <button
              type="button"
              className="btn btn-soft px-2 py-1 text-xs"
              onClick={() => openActivation('activate')}
            >
              تفعيل الذكاء الاصطناعي
            </button>
          </span>
        </Alert>
      )}

      {status && (
        <p className="muted text-xs">
          المزوّد: {status.provider} · النموذج: {status.model} · المتبقي اليوم: {status.remaining} من{' '}
          {status.dailyLimit} طلبًا
        </p>
      )}

      <form onSubmit={submit} className="card space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="اربطه بمحتواك (اختياري)" htmlFor={`${mode}-content`}>
            <select
              id={`${mode}-content`}
              className="input"
              value={contentId}
              onChange={(event) => setContentId(event.target.value)}
            >
              <option value="">بدون مصدر — إجابة عامة</option>
              {readyContents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} ({item.pagesCount} صفحة)
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="مستوى التفصيل"
            htmlFor={`${mode}-level`}
            hint={mode === 'grader' ? 'يؤثر على طول التقييم والشرح.' : undefined}
          >
            <select
              id={`${mode}-level`}
              className="input"
              value={level}
              onChange={(event) => setLevel(event.target.value as StudyToolLevel)}
            >
              {levels.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.hint}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={info.topicLabel} htmlFor={`${mode}-topic`}>
          <textarea
            id={`${mode}-topic`}
            className="input min-h-28 resize-y"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder={info.topicPlaceholder}
            maxLength={4000}
          />
        </Field>

        {mode === 'grader' && (
          <>
            <Field label="إجابة الطالب" htmlFor={`${mode}-answer`}>
              <textarea
                id={`${mode}-answer`}
                className="input min-h-36 resize-y"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="الصق الإجابة التي تريد تصحيحها…"
                maxLength={12000}
              />
            </Field>
            <Field label="معايير التصحيح (اختياري)" htmlFor={`${mode}-rubric`}>
              <input
                id={`${mode}-rubric`}
                className="input"
                value={rubric}
                onChange={(event) => setRubric(event.target.value)}
                placeholder="مثال: 6 درجات للمحتوى، 2 للتنظيم، 2 للغة"
                maxLength={3000}
              />
            </Field>
          </>
        )}

        <Field label={info.notesLabel} htmlFor={`${mode}-notes`}>
          <input
            id={`${mode}-notes`}
            className="input"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={info.notesPlaceholder}
            maxLength={3000}
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="muted flex items-center gap-1 text-[11px]">
            <Sparkles size={13} />
            {contentId
              ? 'ستُستخدم مقاطع محتواك أولًا، مع مراجع الصفحات.'
              : 'بدون مصدر ستكون الإجابة عامة وليست من محتواك.'}
          </p>
          <SubmitButton busy={busy} className="btn btn-primary sm:w-auto sm:px-6">
            {busy ? 'جار العمل…' : `تشغيل ${info.title}`}
          </SubmitButton>
        </div>
      </form>

      {result && (
        <section className="card p-4 sm:p-6">
          <span className="tape" aria-hidden="true" />
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <span className="badge badge-mint">{result.label}</span>
              <h2 className="mt-2 font-display text-lg font-extrabold">{result.title}</h2>
              <p className="muted mt-1 text-[11px]">
                {result.sourceUsed ? 'مبني على محتواك الدراسي' : 'إجابة عامة بلا مصدر'} ·{' '}
                {result.provider} · {result.model}
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyResult()}>
              <Copy size={14} />
              {copied ? 'تم النسخ' : 'نسخ'}
            </button>
          </div>

          <SummaryBody content={result.content} />
          <PageLinks bookId={null} contentId={contentId ? Number(contentId) : null} pages={result.pages} />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t-2 border-dashed border-[var(--line-soft)] pt-3">
            <p className="muted text-[11px]">المتبقي اليوم: {result.remainingToday} طلبًا</p>
            {contentId ? (
              <Link to={`/content/${contentId}`} className="btn btn-soft btn-sm">
                فتح المحتوى
              </Link>
            ) : (
              <Link to="/content" className="btn btn-ghost btn-sm">
                ربط محتوى دراسي
              </Link>
            )}
          </div>
        </section>
      )}
    </AppShell>
  );
}
