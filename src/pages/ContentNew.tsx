import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUp,
  Camera,
  FileText,
  ImagePlus,
  Images,
  Loader2,
  PenLine,
  Presentation,
  Sparkles,
  Trash2,
  Video,
  WandSparkles,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, Field, PageHeader } from '../components/ui.tsx';
import { ApiError } from '../lib/api.ts';
import { getAiKey } from '../lib/aiKey.ts';
import { useSession } from '../lib/session.tsx';
import type { ContentSourceType, ContentTask } from '../lib/contentTypes.ts';
import type { MetaPayload } from '../lib/types.ts';

type Mode = 'camera' | 'gallery' | 'video' | 'text' | 'pdf';

const modes: Array<{
  key: Mode;
  title: string;
  hint: string;
  icon: typeof Camera;
  tone: string;
}> = [
  { key: 'camera', title: 'تصوير صفحات', hint: 'صوّر الصفحة الآن بالكاميرا', icon: Camera, tone: '--yellow' },
  { key: 'gallery', title: 'اختيار صور', hint: 'اختر عدة صفحات من المعرض', icon: Images, tone: '--blue' },
  { key: 'video', title: 'رفع فيديو', hint: 'شرح درس أو تصوير متتابع', icon: Video, tone: '--lavender' },
  { key: 'text', title: 'كتابة المحتوى', hint: 'اكتب أو الصق النص مباشرة', icon: PenLine, tone: '--mint' },
  { key: 'pdf', title: 'ملف PDF', hint: 'خيار إضافي للكتب الرقمية', icon: FileText, tone: '--pink' },
];

const tasks: Array<{ key: ContentTask; title: string; hint: string; icon: typeof Camera }> = [
  { key: 'exam', title: 'أنشئ لي امتحانًا', hint: 'أسئلة من هذا المحتوى فقط', icon: Presentation },
  { key: 'summary', title: 'لخّص لي المحتوى', hint: 'ملخص مرتّب مع المصادر', icon: Sparkles },
  { key: 'teacher', title: 'اسأل المعلم', hint: 'درس تفاعلي من المحتوى', icon: WandSparkles },
  { key: 'none', title: 'احفظه فقط', hint: 'أكمل المهمة لاحقًا', icon: Images },
];

function formatSize(bytes: number): string {
  if (!bytes) return '0';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} ميغابايت` : `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت`;
}

export default function ContentNewPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [mode, setMode] = useState<Mode>('gallery');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [gradeLevelId, setGradeLevelId] = useState(user?.gradeLevelId ? String(user.gradeLevelId) : '');
  const [task, setTask] = useState<ContentTask>('exam');
  const [meta, setMeta] = useState<MetaPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/meta', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: MetaPayload | null) => {
        if (!cancelled && data) setMeta(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  const curriculum = useMemo(() => {
    if (!meta) return null;
    return meta.curricula.find((item) => item.id === user?.curriculumId) ?? meta.curricula[0] ?? null;
  }, [meta, user?.curriculumId]);

  function changeMode(next: Mode) {
    if (next === mode) return;
    const imageGroup = (value: Mode) => value === 'camera' || value === 'gallery';
    if (!imageGroup(mode) || !imageGroup(next)) {
      setFiles([]);
      setText('');
    }
    setMode(next);
    setError(null);
  }

  function acceptFiles(next: File[]) {
    if (mode === 'video' || mode === 'pdf') {
      setFiles(next.slice(0, 1));
      return;
    }
    setFiles((current) => [...current, ...next].slice(0, 30));
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (picked.length === 0) return;
    acceptFiles(picked);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= files.length) return;
    setFiles((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const sourceType: ContentSourceType =
    mode === 'camera' || mode === 'gallery' ? 'images' : mode === 'video' ? 'video' : mode === 'pdf' ? 'pdf' : 'text';

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const canSubmit =
    !busy &&
    (mode === 'text' ? text.trim().replace(/\s/g, '').length >= 20 : files.length > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('sourceType', sourceType);
      if (title.trim()) form.set('title', title.trim());
      if (subjectId) form.set('subjectId', subjectId);
      if (gradeLevelId) form.set('gradeLevelId', gradeLevelId);
      if (mode === 'text') form.set('text', text.trim());
      if (files.length > 0) {
        if (mode === 'video' || mode === 'pdf') form.set('files', files[0]);
        else files.forEach((file) => form.append('files', file));
      }

      const key = getAiKey();
      const response = await fetch('/api/contents', {
        method: 'POST',
        credentials: 'same-origin',
        headers: key ? { 'X-AI-Key': key } : {},
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as
        | { content?: { id: number }; error?: { message?: string } }
        | null;
      if (!response.ok || !payload?.content) {
        throw new ApiError(response.status, payload?.error?.message ?? 'تعذّر حفظ المحتوى.');
      }
      navigate(`/content/${payload.content.id}${task !== 'none' ? `?task=${task}` : ''}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر رفع المحتوى. تحقق من الاتصال وحاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="درس جديد"
        title="ماذا تريد أن تدرس اليوم؟"
        subtitle="صوّر الصفحات، ارفع فيديو، أو اكتب النص. احفظه مرة واحدة ثم استخدمه في الامتحان والملخص والمعلم."
        actions={
          <Link to="/content" className="btn btn-ghost">
            <ArrowLeft size={16} />
            مكتبتي
          </Link>
        }
      />

      {error && <Alert>{error}</Alert>}

      <section className="card p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="eyebrow mb-0.5">الخطوة 1</p>
            <h2 className="text-lg font-bold">أضف المحتوى</h2>
          </div>
          <span className="badge badge-mint">اختر طريقة واحدة</span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {modes.map((item) => {
            const Icon = item.icon;
            const active = mode === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => changeMode(item.key)}
                aria-pressed={active}
                className={`feature-tile text-start ${active ? 'ring-2 ring-[var(--accent)]' : ''}`}
                style={{ '--tile': `var(${item.tone})` } as CSSProperties}
              >
                <span className="feature-icon">
                  <Icon size={19} />
                </span>
                <span className="mt-2 block text-sm font-bold">{item.title}</span>
                <span className="muted mt-0.5 block text-[11px] leading-5">{item.hint}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-[15px_11px_17px_10px] border-2 border-dashed border-[var(--line-soft)] bg-[var(--surface-hover)] p-3">
          {(mode === 'camera' || mode === 'gallery') && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={() => cameraRef.current?.click()}>
                <Camera size={17} /> فتح الكاميرا
              </button>
              <button type="button" className="btn btn-soft" onClick={() => galleryRef.current?.click()}>
                <ImagePlus size={17} /> إضافة من المعرض
              </button>
              <span className="muted text-xs">{files.length} / 30 صورة · {formatSize(totalBytes)}</span>
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={onFiles}
              />
              <input
                ref={galleryRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={onFiles}
              />
            </div>
          )}

          {mode === 'video' && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={() => videoRef.current?.click()}>
                <Video size={17} /> اختيار فيديو
              </button>
              <span className="muted text-xs">MP4 أو MOV أو WEBM · حتى 200 ميغابايت</span>
              <input
                ref={videoRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
                className="hidden"
                onChange={onFiles}
              />
            </div>
          )}

          {mode === 'pdf' && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={() => pdfRef.current?.click()}>
                <FileText size={17} /> اختيار ملف PDF
              </button>
              <span className="muted text-xs">ملف PDF نصي واحد · حتى 50 ميغابايت</span>
              <input
                ref={pdfRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={onFiles}
              />
            </div>
          )}

          {mode === 'text' && (
            <div>
              <textarea
                className="input min-h-48 resize-y leading-8"
                placeholder="اكتب أو الصق النص الدراسي هنا… يمكنك لصق ملاحظات المعلم أو فقرة من الكتاب."
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={100000}
              />
              <div className="mt-1 flex justify-between text-[11px]">
                <span className="muted">لا حاجة لرفع أي ملف.</span>
                <span className="muted">{text.length.toLocaleString('ar-JO')} حرف</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {(files.length > 0 || text.trim()) && (
        <section className="card p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="eyebrow mb-0.5">الخطوة 2</p>
              <h2 className="text-lg font-bold">راجع المحتوى قبل المعالجة</h2>
            </div>
            {(mode === 'camera' || mode === 'gallery') && files.length > 1 && (
              <span className="muted text-xs">رتّب الصفحات بالأسهم</span>
            )}
          </div>

          {mode === 'video' && files[0] && (
            <div className="space-y-2">
              <video controls preload="metadata" className="max-h-72 w-full rounded-[14px_10px_16px_11px] border-2 border-[var(--line)] bg-black" src={previews[0]} />
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{files[0].name}</span>
                <button type="button" className="btn btn-ghost min-h-8 px-2 text-xs" onClick={() => setFiles([])}>
                  <Trash2 size={14} /> استبدال
                </button>
              </div>
            </div>
          )}

          {mode === 'pdf' && files[0] && (
            <div className="flex items-center justify-between gap-3 rounded-[13px_9px_15px_10px] border-2 border-[var(--line-soft)] p-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border-2 border-[var(--line)] bg-[var(--pink)] text-[#25251f]">
                  <FileText size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{files[0].name}</span>
                  <span className="muted text-[11px]">{formatSize(files[0].size)}</span>
                </span>
              </div>
              <button type="button" className="btn btn-ghost min-h-8 px-2 text-xs" onClick={() => setFiles([])}>
                <Trash2 size={14} /> حذف
              </button>
            </div>
          )}

          {(mode === 'camera' || mode === 'gallery') && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {files.map((file, index) => (
                <div key={`${file.name}-${index}`} className="book-card overflow-hidden p-0">
                  <div className="relative aspect-[3/4] bg-[var(--surface-hover)]">
                    {previews[index] && (
                      <img src={previews[index]} alt={`صفحة ${index + 1}`} className="size-full object-cover" />
                    )}
                    <span className="absolute start-1.5 top-1.5 badge bg-[var(--yellow)] text-[#25251f]">صفحة {index + 1}</span>
                  </div>
                  <div className="flex items-center justify-between gap-1 p-1.5">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="icon-btn is-sm"
                        aria-label="تقديم الصفحة"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp size={13} className="-rotate-90" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn is-sm"
                        aria-label="تأخير الصفحة"
                        disabled={index === files.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowUp size={13} className="rotate-90" />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="icon-btn is-sm text-[var(--danger)]"
                      aria-label="حذف الصفحة"
                      onClick={() => setFiles((current) => current.filter((_item, itemIndex) => itemIndex !== index))}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {mode === 'gallery' && (
                <button
                  type="button"
                  onClick={() => galleryRef.current?.click()}
                  className="grid min-h-40 place-items-center rounded-[15px_11px_17px_10px] border-2 border-dashed border-[var(--line-soft)] p-3 text-center"
                >
                  <span>
                    <ImagePlus size={22} className="mx-auto text-[var(--accent)]" />
                    <span className="mt-1 block text-xs font-semibold">إضافة صور</span>
                  </span>
                </button>
              )}
            </div>
          )}

          {mode === 'text' && (
            <p className="reader-text max-h-64 overflow-y-auto whitespace-pre-wrap">{text}</p>
          )}
        </section>
      )}

      <form onSubmit={submit} className="card space-y-4 p-4 sm:p-5">
        <div>
          <p className="eyebrow mb-0.5">الخطوة 3</p>
          <h2 className="text-lg font-bold">سمِّ الدرس واختر المهمة</h2>
          <p className="muted mt-1 text-xs leading-6">
            كل الحقول اختيارية. يمكن للذكاء الاصطناعي اقتراح عنوان لاحقًا، ويمكنك تعديله في أي وقت.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="عنوان الموضوع (اختياري)" htmlFor="contentTitle">
            <input
              id="contentTitle"
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              placeholder="مثال: الانخفاض في درجة التجمد"
            />
          </Field>
          <Field label="المادة (اختياري)" htmlFor="contentSubject">
            <select
              id="contentSubject"
              className="input"
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              <option value="">بدون تحديد</option>
              {curriculum?.subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
          </Field>
          <Field label="الصف (اختياري)" htmlFor="contentGrade">
            <select
              id="contentGrade"
              className="input"
              value={gradeLevelId}
              onChange={(event) => setGradeLevelId(event.target.value)}
            >
              <option value="">بدون تحديد</option>
              {curriculum?.grades.map((grade) => (
                <option key={grade.id} value={grade.id}>{grade.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <p className="muted mb-1 text-xs">ماذا تريد أن تفعل به؟</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tasks.map((item) => {
              const Icon = item.icon;
              const active = task === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTask(item.key)}
                  className={`choice-card ${active ? 'is-selected' : ''}`}
                >
                  <Icon size={17} className="text-[var(--accent)]" />
                  <span className="text-sm font-semibold">{item.title}</span>
                  <span className="muted block text-[11px] leading-5">{item.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-[var(--line-soft)] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="muted text-[11px] leading-6">
            {mode === 'video'
              ? 'سنستخرج إطارات الفيديو ونقرأ النص. تفريغ الصوت يحتاج مفتاح الذكاء الاصطناعي، وسنوضح لك إن لم يتم.'
              : mode === 'pdf'
                ? 'PDF النصي يُقرأ مباشرة. إن كان مصوّرًا بالكامل فالأفضل رفعه كصور صفحات.'
                : 'تُحفظ الصور والنص في مكتبتك، ويمكنك إضافة صفحات أو إعادة المعالجة لاحقًا.'}
          </p>
          <button type="submit" className="btn btn-primary shrink-0" disabled={!canSubmit}>
            {busy ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}
            {busy ? 'جار حفظ المحتوى…' : 'حفظ وبدء المعالجة'}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
