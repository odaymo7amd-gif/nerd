import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  GraduationCap,
  Layers,
  Loader2,
  RotateCcw,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { MarkdownText } from '../components/MarkdownText.tsx';
import { Alert, PageHeader, Progress } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { aiApi, isKeyProblem } from '../lib/aiApi.ts';
import { useAiAccess } from '../components/AiAccess.tsx';
import type {
  AiStatus,
  Citation,
  TeacherLesson,
  TeacherLessonResponse,
} from '../lib/aiTypes.ts';
import type { ContentListItem } from '../lib/contentTypes.ts';

const examples = [
  'لماذا يتغيّر لون السماء عند الغروب؟',
  'ما أهم أسباب الحرب العالمية الثانية؟',
  'اشرح لي فكرة النسبية ببساطة.',
  'علّمني كيف أذاكر بذكاء قبل الاختبار.',
];

export default function AskTeacherPage() {
  const [searchParams] = useSearchParams();
  const { hasKey, openActivation } = useAiAccess();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [contents, setContents] = useState<ContentListItem[]>([]);
  const [question, setQuestion] = useState(searchParams.get('q') ?? '');
  const [contentId, setContentId] = useState(searchParams.get('contentId') ?? '');
  const [lesson, setLesson] = useState<TeacherLesson | null>(null);
  const [sources, setSources] = useState<Citation[]>([]);
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lessonRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const prefilled = useRef(false);

  const readyContents = contents.filter((item) => ['ready', 'needs_review'].includes(item.status));
  const selectedContent = readyContents.find((item) => String(item.id) === contentId) ?? null;
  const section = lesson?.sections[current] ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [statusData, contentsData] = await Promise.all([
          api.get<AiStatus>('/ai/status'),
          api.get<{ contents: ContentListItem[] }>('/contents'),
        ]);
        if (cancelled) return;
        setStatus(statusData);
        setContents(contentsData.contents);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل بيانات المعلم.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (prefilled.current || question.trim() || !selectedContent) return;
    prefilled.current = true;
    setQuestion(`اشرح لي «${selectedContent.title}» بأسلوب منظم.`);
  }, [question, selectedContent]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    if (!hasKey) {
      openActivation('activate');
      return;
    }
    setBusy(true);
    setError(null);
    setLesson(null);
    setSources([]);
    try {
      const data = await aiApi.post<TeacherLessonResponse>('/ai/teacher-lesson', {
        question: text,
        contentId: contentId ? Number(contentId) : null,
      });
      setLesson(data.lesson);
      setSources(data.sources);
      setCurrent(0);
      if (status) {
        setStatus({
          ...status,
          usedToday: status.usedToday + data.usage.requests,
          remaining: data.usage.remainingToday,
        });
      }
      window.setTimeout(() => {
        lessonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    } catch (caught) {
      if (isKeyProblem(caught)) openActivation('activate');
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إنشاء الدرس. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  function resetLesson() {
    setLesson(null);
    setSources([]);
    setCurrent(0);
    setError(null);
    window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  function goTo(index: number) {
    if (!lesson) return;
    setCurrent(Math.max(0, Math.min(lesson.sections.length - 1, index)));
    contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="درس تفاعلي"
        title="اسأل المعلم"
        subtitle="حوّل أي سؤال إلى درس مرتّب: عناوين واضحة، شرح مختصر، وأمثلة. تنقّل بين الأقسام بالأسهم أو من قائمة العناوين."
        actions={
          lesson ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={resetLesson}>
              <RotateCcw size={14} />
              درس جديد
            </button>
          ) : (
            <span className="badge badge-lavender">3–8 أقسام</span>
          )
        }
      />

      {error && <Alert>{error}</Alert>}

      {!hasKey && (
        <Alert tone="info">
          <span className="inline-flex flex-wrap items-center gap-2">
            «اسأل المعلم» يحتاج مفتاح Groq API الخاص بك. أضفه مرة واحدة على هذا الجهاز.
            <button type="button" className="btn btn-soft btn-sm" onClick={() => openActivation('activate')}>
              تفعيل الذكاء الاصطناعي
            </button>
          </span>
        </Alert>
      )}

      {!lesson && (
        <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
          <form ref={formRef} onSubmit={(event) => void submit(event)} className="card space-y-4 p-4 sm:p-5">
            <div>
              <p className="eyebrow mb-1">
                <WandSparkles size={12} /> ابدأ بسؤال
              </p>
              <h2 className="text-xl font-extrabold">ماذا تريد أن تتعلّم اليوم؟</h2>
              <p className="muted mt-1 text-sm leading-7">
                يمكنك السؤال عن أي موضوع. اختيار مصدر من مكتبتك مفيد إذا أردت شرحًا مرتبطًا بدرس محدد،
                لكنه ليس شرطًا.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="teacherQuestion">
                سؤالك
              </label>
              <textarea
                id="teacherQuestion"
                className="input min-h-36 resize-y leading-8"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={1200}
                dir="auto"
                placeholder="مثال: ما أسباب نشوء الحرب العالمية الثانية؟ أو: اشرح لي قانون نيوتن الثاني بأمثلة من الحياة."
                disabled={busy}
              />
              <div className="mt-1 flex justify-between text-[11px]">
                <span className="muted">كلما كان السؤال أوضح، كان الدرس أدق.</span>
                <span className="muted">{question.length.toLocaleString('ar-JO')} / 1200</span>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="teacherSource">
                المصدر (اختياري)
              </label>
              <select
                id="teacherSource"
                className="input"
                value={contentId}
                onChange={(event) => {
                  setContentId(event.target.value);
                  setError(null);
                }}
                disabled={busy}
              >
                <option value="">معرفتي العامة — بدون مصدر</option>
                {readyContents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <p className="muted mt-1 text-xs leading-6">
                عند اختيار مصدر، تُبنى الإجابة عليه أولًا وتُذكر أرقام الصفحات. أي إضافة خارج المصدر
                تظهر بوضوح.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || question.trim().length < 2 || !status}
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {busy ? 'أبني الدرس…' : 'حوّل السؤال إلى درس'}
              </button>
              <span className="muted text-xs">
                {selectedContent ? `المصدر: ${selectedContent.title}` : 'بدون مصدر خارجي'}
              </span>
            </div>
            {status && (
              <p className="muted text-[11px]">
                استخدمت اليوم {status.usedToday} طلبًا · المتبقي {status.remaining}
              </p>
            )}
          </form>

          <aside className="space-y-3">
            <section className="card p-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                <Layers size={15} /> كيف يتكوّن الدرس؟
              </h3>
              <ol className="muted space-y-2 text-xs leading-6">
                <li className="flex gap-2">
                  <span className="badge badge-blue h-fit py-0 text-[9px]">1</span>
                  نبدأ مباشرة بالإجابة، بلا مقدمات طويلة.
                </li>
                <li className="flex gap-2">
                  <span className="badge badge-blue h-fit py-0 text-[9px]">2</span>
                  نقسّم الشرح إلى 3–8 أقسام حسب تعقيد السؤال.
                </li>
                <li className="flex gap-2">
                  <span className="badge badge-blue h-fit py-0 text-[9px]">3</span>
                  تتنقل بين الأقسام بالأسهم أو من قائمة العناوين.
                </li>
              </ol>
            </section>

            <section className="card p-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                <BookOpen size={15} /> جرّب مثلًا
              </h3>
              <div className="flex flex-col gap-1.5">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="suggestion-chip"
                    onClick={() => setQuestion(example)}
                    disabled={busy}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}

      {lesson && (
        <div ref={lessonRef} className="space-y-3">
          <section className="paper-note overflow-visible p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow mb-1">
                  <GraduationCap size={12} /> درسك التفاعلي
                </p>
                <h2 className="break-words text-xl font-extrabold leading-8 sm:text-2xl">{lesson.lessonTitle}</h2>
                <p className="break-words muted mt-1 text-xs leading-6">
                  {lesson.sections.length} أقسام · اقرأ بهدوء ثم انتقل بالأسهم
                  {lesson.sourceTitle ? ` · المصدر: ${lesson.sourceTitle}` : ' · من المعرفة العامة'}
                </p>
              </div>
              <span className="badge badge-mint">
                <Check size={12} /> جاهز
              </span>
            </div>
          </section>

          <div className="grid min-w-0 gap-3 lg:grid-cols-[265px_1fr]">
            <aside className="lesson-plan card min-w-0 max-w-full p-2 lg:sticky lg:top-4 lg:h-fit">
              <div className="mb-1.5 flex items-center justify-between gap-2 px-1.5 py-1">
                <p className="text-xs font-bold">خطة الدرس</p>
                <span className="badge badge-blue py-0 text-[9px]">
                  {current + 1} / {lesson.sections.length}
                </span>
              </div>
              <ol className="lesson-plan-list grid w-full min-w-0 max-w-full grid-cols-2 gap-1.5 lg:flex lg:flex-col">
                {lesson.sections.map((item, index) => {
                  const active = index === current;
                  return (
                    <li key={item.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => goTo(index)}
                        aria-current={active ? 'step' : undefined}
                        className={`flex w-full items-start gap-2 rounded-[11px_8px_12px_7px] border-2 px-2 py-2 text-start text-xs transition ${
                          active
                            ? 'border-[var(--line)] bg-[color-mix(in_srgb,var(--lavender)_48%,var(--surface))] shadow-[2px_2px_0_var(--shadow-color)]'
                            : 'border-transparent hover:bg-[var(--surface-hover)]'
                        }`}
                      >
                        <span
                          className={`grid size-5 shrink-0 place-items-center rounded-full border-2 border-[var(--line)] text-[10px] font-extrabold ${
                            active ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-solid)]'
                          }`}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 leading-5">{item.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </aside>

            <article ref={contentRef} className="lesson-reader card min-w-0 scroll-mt-24 p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b-2 border-dashed border-[var(--line-soft)] pb-3">
                <div className="min-w-0">
                  <p className="muted text-[10px]">القسم {current + 1}</p>
                  <h3 className="break-words text-lg font-extrabold leading-7">{section?.title}</h3>
                </div>
                <span className="badge badge-lavender">{lesson.sections.length} أقسام</span>
              </div>

              {section && (
                <MarkdownText
                  key={section.id}
                  content={section.content}
                  ariaLabel={`محتوى ${section.title}`}
                />
              )}

              {sources.length > 0 && (
                <div className="mt-4 border-t-2 border-dashed border-[var(--line-soft)] pt-3">
                  <p className="muted mb-1.5 text-[10px]">مصادر هذا الدرس</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sources.slice(0, 12).map((source) => (
                      <Link
                        key={`${source.bookId}-${source.pageFrom}-${source.pageTo}`}
                        to={source.contentId ? `/content/${source.contentId}` : `/books/${source.bookId}?page=${source.pageFrom}`}
                        className="rounded-md border-2 border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-bold shadow-[1px_1px_0_var(--shadow-color)]"
                        title={source.contentTitle ?? source.bookTitle}
                      >
                        ص {source.pageFrom}
                        {source.pageTo !== source.pageFrom ? `–${source.pageTo}` : ''}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5 border-t-2 border-dashed border-[var(--line-soft)] pt-3">
                <div className="mb-2 flex items-center justify-between text-[11px]">
                  <span className="muted">تقدمك في الدرس</span>
                  <span className="font-bold">{current + 1} من {lesson.sections.length}</span>
                </div>
                <Progress value={current + 1} max={lesson.sections.length} />
              </div>

              <div className="lesson-actions mt-4 grid grid-cols-2 items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                <div className="order-first col-span-2 min-w-0 text-center sm:order-none sm:col-span-1">
                  {current === lesson.sections.length - 1 ? (
                    <span className="badge badge-mint">
                      <Check size={12} /> وصلت إلى النهاية
                    </span>
                  ) : (
                    <span className="muted block truncate text-[10px]" title={lesson.sections[current + 1]?.title}>
                      التالي: {lesson.sections[current + 1]?.title}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-soft w-full justify-center sm:w-auto"
                  onClick={() => goTo(current - 1)}
                  disabled={current === 0}
                >
                  <ArrowRight size={16} />
                  السابق
                </button>
                <button
                  type="button"
                  className="btn btn-primary w-full justify-center sm:w-auto"
                  onClick={() => goTo(current + 1)}
                  disabled={current === lesson.sections.length - 1}
                >
                  التالي
                  <ArrowLeft size={16} />
                </button>
              </div>
            </article>
          </div>

          <div className="flex justify-center">
            <button type="button" className="btn btn-ghost btn-sm" onClick={resetLesson}>
              <RotateCcw size={14} /> اسأل عن موضوع آخر
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
