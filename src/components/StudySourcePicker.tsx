import { useEffect, useId, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import {
  Camera,
  CheckCircle2,
  FileText,
  ImagePlus,
  Images,
  Loader2,
  PenLine,
  RefreshCw,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import { api, ApiError, formatBytes } from '../lib/api.ts';
import { getAiKey } from '../lib/aiKey.ts';
import { useAiAccess } from './AiAccess.tsx';
import type { ContentDetailResponse, ContentListItem, ContentSourceType } from '../lib/contentTypes.ts';
import type { Book } from '../lib/bookTypes.ts';

type SourceMode = 'image' | 'video' | 'pdf' | 'text';

const sourceModes: Array<{
  key: SourceMode;
  label: string;
  hint: string;
  icon: typeof ImagePlus;
  tone: string;
}> = [
  { key: 'image', label: 'صورة', hint: 'صفحة أو عدة صفحات', icon: ImagePlus, tone: '--blue' },
  { key: 'video', label: 'فيديو', hint: 'شرح أو شرائح تعليمية', icon: Video, tone: '--lavender' },
  { key: 'pdf', label: 'PDF', hint: 'كتاب أو صفحات محددة', icon: FileText, tone: '--pink' },
  { key: 'text', label: 'نص', hint: 'اكتبه أو الصقه', icon: PenLine, tone: '--mint' },
];

const imageAccept = 'image/jpeg,image/png,image/webp';
const videoAccept = 'video/mp4,video/quicktime,video/webm,video/x-m4v';

export interface StudySourceSelection {
  contentId: string;
  bookId: string;
}

export function StudySourcePicker({
  contentId,
  bookId,
  contents,
  books,
  onChange,
  onLibraryChanged,
  disabled = false,
}: {
  contentId: string;
  bookId: string;
  contents: ContentListItem[];
  books: Book[];
  onChange: (selection: StudySourceSelection) => void;
  onLibraryChanged: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const { hasKey } = useAiAccess();
  const baseId = useId();
  const [mode, setMode] = useState<SourceMode | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ContentListItem | null>(null);
  const [activeContentId, setActiveContentId] = useState<number | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [parts, setParts] = useState<{ done: number; total: number } | null>(null);
  const cancelRequested = useRef(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  const readyContents = contents.filter(
    (item) => item.status === 'ready' || item.status === 'needs_review',
  );
  const readyBooks = books.filter((book) => book.status === 'ready' && book.chunksCount > 0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  function chooseMode(next: SourceMode) {
    if (busy) return;
    if (mode !== next) onChange({ contentId: '', bookId: '' });
    setMode((current) => (current === next ? null : next));
    setFiles([]);
    setText('');
    setTitle('');
    setError(null);
    setCreated(null);
    setStage('');
    setProgress(null);
    setDurationSeconds(null);
    setParts(null);
  }

  function acceptFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (picked.length === 0) return;
    if (!mode) return;
    setError(null);
    setCreated(null);

    if (mode === 'video') {
      const file = picked[0];
      if (file.size > 200 * 1024 * 1024) {
        setError('حجم الفيديو أكبر من 200 ميغابايت. اختر ملفًا أصغر أو قسّمه إلى مقاطع.');
        return;
      }
      setFiles([file]);
      return;
    }
    if (mode === 'pdf') {
      const file = picked[0];
      if (file.size > 50 * 1024 * 1024) {
        setError('حجم ملف PDF أكبر من 50 ميغابايت.');
        return;
      }
      setFiles([file]);
      return;
    }
    setFiles((current) => [...current, ...picked].slice(0, 30));
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function selectExistingContent(value: string) {
    onChange({ contentId: value, bookId: '' });
    setCreated(null);
    setMode(null);
    setFiles([]);
    setText('');
  }

  function selectBook(value: string) {
    onChange({ contentId: '', bookId: value });
    setCreated(null);
    setMode(null);
    setFiles([]);
    setText('');
  }

  const cleanText = text.trim();
  const sourceType: ContentSourceType | null =
    mode === 'image' ? 'images' : mode === 'video' ? 'video' : mode === 'pdf' ? 'pdf' : mode === 'text' ? 'text' : null;
  const canSubmit =
    !disabled &&
    !busy &&
    (mode === 'text' ? cleanText.replace(/\s/g, '').length >= 20 : files.length > 0);

  async function waitUntilReady(contentIdValue: number) {
    // فيديو طويل قد يستغرق أكثر من عشر دقائق؛ ننتظر حتى 30 دقيقة مع إتاحة الإلغاء.
    const attempts = 720;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2500));
      if (!alive.current) return null;
      const detail = await api.get<ContentDetailResponse>(`/contents/${contentIdValue}`);
      if (!alive.current) return null;
      const item = detail.content;
      const donePages = detail.pages.filter(
        (page) => !['pending', 'extracting'].includes(page.status),
      ).length;
      const totalPages = detail.pages.length || item.pagesCount;
      if (item.processing) {
        setProgress(item.processing.percent);
        setStage(item.processing.label);
        if (item.processing.durationSeconds) setDurationSeconds(item.processing.durationSeconds);
        if (item.processing.segmentsTotal) {
          setParts({
            done: item.processing.segmentsProcessed ?? 0,
            total: item.processing.segmentsTotal,
          });
        }
      } else {
        if (totalPages > 0) setProgress(Math.round((donePages / totalPages) * 100));
        setStage(
          item.status === 'pending'
            ? 'تم حفظ المحتوى، وجارٍ تجهيزه للاستخراج…'
            : `جارٍ استخراج النص من الصفحات… ${donePages}/${totalPages}`,
        );
      }

      if (item.status === 'ready' || item.status === 'needs_review') {
        setProgress(100);
        return item;
      }
      if (item.status === 'failed') {
        throw new ApiError(
          422,
          cancelRequested.current
            ? 'أُلغيت المعالجة. النص المستخرج حتى الآن محفوظ، ويمكنك استئناف المعالجة من مكتبتك.'
            : item.errorMessage ?? 'تعذّرت معالجة هذا المحتوى.',
        );
      }
    }
    throw new ApiError(
      408,
      'المعالجة تستغرق وقتًا أطول من المعتاد. بقي المحتوى محفوظًا في مكتبتك، ويمكنك متابعة حالته من هناك.',
    );
  }

  async function cancelProcessing() {
    if (!activeContentId || cancelBusy) return;
    setCancelBusy(true);
    cancelRequested.current = true;
    setStage('جارٍ إلغاء المعالجة وحفظ ما تم استخراجه…');
    try {
      await api.post(`/contents/${activeContentId}/cancel`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إلغاء المعالجة.');
    } finally {
      setCancelBusy(false);
    }
  }

  async function upload() {
    if (!canSubmit || !mode || !sourceType) return;
    setBusy(true);
    setError(null);
    setCreated(null);
    setProgress(null);
    setActiveContentId(null);
    setDurationSeconds(null);
    setParts(null);
    cancelRequested.current = false;
    setStage('جارٍ رفع المحتوى…');
    let uploadedId: number | null = null;
    try {
      const form = new FormData();
      form.set('sourceType', sourceType);
      const fallbackTitle =
        mode === 'text'
          ? 'نص دراسي جديد'
          : mode === 'image'
            ? 'صور صفحات دراسية'
            : files[0]?.name.replace(/\.[^.]+$/, '') || 'محتوى دراسي';
      form.set('title', title.trim() || fallbackTitle);
      if (mode === 'text') form.set('text', cleanText);
      if (files.length > 0) files.forEach((file) => form.append('files', file));

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
        throw new ApiError(response.status, payload?.error?.message ?? 'تعذّر رفع المحتوى.');
      }

      setStage('تم الرفع، وجارٍ استخراج النص…');
      uploadedId = payload.content.id;
      setActiveContentId(payload.content.id);
      const ready = await waitUntilReady(payload.content.id);
      if (!ready || !alive.current) return;
      setCreated(ready);
      setStage('المحتوى جاهز للاستخدام');
      await onLibraryChanged();
      onChange({ contentId: String(ready.id), bookId: '' });
      setFiles([]);
      setText('');
      setActiveContentId(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر رفع المحتوى. تحقّق من الاتصال وحاول مجددًا.');
      setStage('');
      setProgress(null);
      if (uploadedId) void onLibraryChanged();
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const selectedContent = readyContents.find((item) => String(item.id) === contentId);
  const selectedBook = readyBooks.find((book) => String(book.id) === bookId);

  return (
    <section className="source-picker" aria-labelledby={`${baseId}-heading`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="eyebrow mb-0.5">الخطوة 1</p>
          <h2 id={`${baseId}-heading`} className="flex items-center gap-2 text-base font-bold">
            <Sparkles size={16} className="text-[var(--accent)]" />
            من أين ندرس؟
          </h2>
        </div>
        <span className="badge badge-mint">صور · فيديو · PDF · نص</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {sourceModes.map((item) => {
          const Icon = item.icon;
          const active = mode === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => chooseMode(item.key)}
              aria-pressed={active}
              disabled={disabled || busy}
              className={`source-choice ${active ? 'is-active' : ''}`}
              style={{ '--source-tone': `var(${item.tone})` } as CSSProperties}
            >
              <span className="source-choice-icon">
                <Icon size={19} />
              </span>
              <span className="source-choice-label">{item.label}</span>
              <span className="source-choice-hint">{item.hint}</span>
            </button>
          );
        })}
      </div>

      {mode && (
        <div className="source-editor">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold">
              {mode === 'image'
                ? 'صور صفحات الكتاب'
                : mode === 'video'
                  ? 'فيديو الشرح'
                  : mode === 'pdf'
                    ? 'ملف PDF'
                    : 'النص الدراسي'}
            </p>
            <button
              type="button"
              className="icon-btn is-sm"
              onClick={() => chooseMode(mode)}
              disabled={busy}
              aria-label="إغلاق إدخال المصدر"
            >
              <X size={15} />
            </button>
          </div>

          {mode === 'text' ? (
            <div>
              <textarea
                className="input min-h-36 resize-y leading-7"
                placeholder="اكتب أو الصق هنا الموضوع الذي تريد دراسته…"
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setCreated(null);
                }}
                disabled={busy}
                aria-label="النص الدراسي"
              />
              <div className="mt-1 flex justify-between text-[11px]">
                <span className="muted">20 حرفًا على الأقل</span>
                <span className="muted">{text.length.toLocaleString('ar-JO')} حرف</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {mode === 'image' && (
                <>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => cameraRef.current?.click()} disabled={busy}>
                    <Camera size={16} /> التقاط صورة
                  </button>
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => galleryRef.current?.click()} disabled={busy}>
                    <Images size={16} /> اختيار صور
                  </button>
                  <input
                    ref={cameraRef}
                    type="file"
                    accept={imageAccept}
                    capture="environment"
                    className="hidden"
                    onChange={acceptFiles}
                  />
                  <input
                    ref={galleryRef}
                    type="file"
                    accept={imageAccept}
                    multiple
                    className="hidden"
                    onChange={acceptFiles}
                  />
                  <span className="muted text-xs">{files.length} / 30 صورة</span>
                </>
              )}

              {mode === 'video' && (
                <>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => videoRef.current?.click()} disabled={busy}>
                    <Video size={16} /> اختيار فيديو
                  </button>
                  <input
                    ref={videoRef}
                    type="file"
                    accept={videoAccept}
                    className="hidden"
                    onChange={acceptFiles}
                  />
                  <span className="muted text-xs">MP4 أو MOV أو WEBM · حتى 200 ميغابايت</span>
                </>
              )}

              {mode === 'pdf' && (
                <>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => pdfRef.current?.click()} disabled={busy}>
                    <FileText size={16} /> اختيار ملف PDF
                  </button>
                  <input
                    ref={pdfRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={acceptFiles}
                  />
                  <span className="muted text-xs">ملف واحد · حتى 50 ميغابايت</span>
                </>
              )}
            </div>
          )}

          {previews.length > 0 && mode === 'image' && (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {previews.map((url, index) => (
                <div key={`${url}-${index}`} className="source-preview">
                  <img src={url} alt={`صفحة ${index + 1}`} loading="lazy" />
                  <span className="source-preview-number">{index + 1}</span>
                  <button
                    type="button"
                    className="source-preview-remove"
                    onClick={() => removeFile(index)}
                    disabled={busy}
                    aria-label={`حذف الصورة ${index + 1}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {mode === 'video' && files[0] && previews[0] && (
            <div className="mt-3">
              <video className="source-video" src={previews[0]} controls preload="metadata" />
              <p className="muted mt-1 text-[11px]">
                {files[0].name} · {formatBytes(files[0].size)}
                <button type="button" className="ms-2 underline" onClick={() => setFiles([])} disabled={busy}>
                  تغيير الملف
                </button>
              </p>
            </div>
          )}

          {mode === 'pdf' && files[0] && previews[0] && (
            <div className="source-file mt-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl border-2 border-[var(--line)] bg-[var(--pink)] text-[#25251f]">
                <FileText size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{files[0].name}</p>
                <p className="muted text-[11px]">{formatBytes(files[0].size)}</p>
              </div>
              <a href={previews[0]} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                معاينة
              </a>
              <button type="button" className="icon-btn is-sm" onClick={() => setFiles([])} disabled={busy} aria-label="حذف الملف">
                <X size={14} />
              </button>
            </div>
          )}

          {(mode === 'text' ? cleanText.length > 0 : files.length > 0) && (
            <div className="mt-3">
              <label htmlFor={`${baseId}-title`} className="muted mb-1 block text-[11px]">
                اسم المحتوى (اختياري)
              </label>
              <input
                id={`${baseId}-title`}
                className="input"
                placeholder="مثال: الوحدة الثانية — الكسور"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={busy}
              />
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary sm:w-52" onClick={() => void upload()} disabled={!canSubmit}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {busy ? 'جارٍ تجهيز المصدر…' : 'ارفع وابدأ الدراسة'}
            </button>
            <span className="muted text-[11px]">
              {hasKey
                ? 'بعد الرفع سيُستخرج النص وتُحفظ الصفحات، ثم يصبح المصدر جاهزًا.'
                : 'يمكن استخراج النص من الصور وPDF والفيديو بلا مفتاح؛ أسئلة الذكاء الاصطناعي تحتاج مفتاحك لاحقًا.'}
            </span>
          </div>

          {busy && (
            <div className="source-progress" role="status" aria-live="polite">
              <Loader2 size={17} className="animate-spin" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{stage}</p>
                <p className="muted text-[11px]">
                  يمكنك ترك الصفحة؛ المعالجة تكمل في الخادم، والنص المستخرج يُحفظ أولًا بأول.
                </p>
                {progress != null && (
                  <div className="source-progress-track mt-2" aria-hidden="true">
                    <span style={{ width: `${progress}%` }} />
                  </div>
                )}
                {progress != null && (
                  <p className="muted mt-1 text-[11px]">
                    {Math.round(progress)}%
                    {durationSeconds
                      ? ` · المدة ${Math.floor(durationSeconds / 60)}:${String(Math.floor(durationSeconds % 60)).padStart(2, '0')}`
                      : ''}
                    {parts ? ` · الأجزاء ${parts.done}/${parts.total}` : ''}
                  </p>
                )}
              </div>
              {activeContentId && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm shrink-0"
                  onClick={() => void cancelProcessing()}
                  disabled={cancelBusy}
                >
                  <X size={14} /> {cancelBusy ? 'جارٍ الإلغاء…' : 'إلغاء'}
                </button>
              )}
            </div>
          )}

          {error && (
            <p className="source-error mt-3" role="alert">
              {error}
            </p>
          )}

          {created && !busy && (
            <div className="source-success mt-3" role="status">
              <CheckCircle2 size={17} />
              <div>
                <p className="text-sm font-bold">تم تجهيز «{created.title}»</p>
                <p className="muted text-[11px]">
                  {created.pagesCount} صفحة\n                  {created.durationSeconds ? ` · ${Math.floor(created.durationSeconds / 60)} دقيقة` : ''} · جاهز\n                  للاختبار والملخص. يمكنك اختيار موضوع أو نطاق صفحات أدناه.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="source-divider">
        <span>أو اختر مصدرًا جاهزًا</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="muted mb-1 block text-[11px]">من محتواي الدراسي</span>
          <select
            className="input"
            value={contentId}
            onChange={(event) => selectExistingContent(event.target.value)}
            disabled={disabled || busy}
          >
            <option value="">{readyContents.length === 0 ? 'لا يوجد محتوى جاهز بعد' : 'اختر محتوى…'}</option>
            {readyContents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} ({item.pagesCount} صفحة)
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="muted mb-1 block text-[11px]">أو من كتبي المرفوعة</span>
          <select
            className="input"
            value={bookId}
            onChange={(event) => selectBook(event.target.value)}
            disabled={disabled || busy}
          >
            <option value="">{readyBooks.length === 0 ? 'لا يوجد كتاب جاهز بعد' : 'اختر كتابًا…'}</option>
            {readyBooks.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title} ({book.pagesCount} صفحة)
              </option>
            ))}
          </select>
        </label>
      </div>

      {(selectedContent || selectedBook) && (
        <p className="source-selected mt-3">
          <CheckCircle2 size={14} />
          المصدر المحدد: <strong>{selectedContent?.title ?? selectedBook?.title}</strong>
          {' · '}
          {selectedContent?.pagesCount ?? selectedBook?.pagesCount} صفحة
        </p>
      )}

      {!selectedContent && !selectedBook && (
        <p className="muted mt-3 text-[11px]">
          ابدأ برفع صورة أو فيديو أو PDF أو نص، أو اختر كتابًا جاهزًا. بعد ذلك يمكنك تحديد الموضوع ونطاق الصفحات.
        </p>
      )}
    </section>
  );
}
