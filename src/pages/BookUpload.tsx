import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp, X } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, Field, PageHeader, Progress, SubmitButton } from '../components/ui.tsx';
import { api, ApiError, formatBytes } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import type { Curriculum, MetaPayload } from '../lib/types.ts';

const ACCEPTED = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export default function BookUploadPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [meta, setMeta] = useState<MetaPayload | null>(null);
  const [form, setForm] = useState({ title: '', subjectId: '', gradeLevelId: '', semesterId: '', unitName: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<MetaPayload>('/meta')
      .then((payload) => {
        if (cancelled) return;
        setMeta(payload);
        const curriculum = payload.curricula[0];
        setForm((current) => ({
          ...current,
          subjectId: current.subjectId || String(curriculum?.subjects[0]?.id ?? ''),
          gradeLevelId: current.gradeLevelId || String(user?.gradeLevelId ?? curriculum?.grades[0]?.id ?? ''),
          semesterId: current.semesterId || String(user?.semesterId ?? curriculum?.semesters[0]?.id ?? ''),
        }));
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل بيانات المناهج.');
      });
    return () => {
      cancelled = true;
    };
  }, [user?.gradeLevelId, user?.semesterId]);

  const curriculum: Curriculum | undefined = meta?.curricula[0];

  function addFiles(selected: FileList | null) {
    if (!selected) return;
    const incoming = Array.from(selected);
    const invalid = incoming.find((file) => !ACCEPTED.some((ext) => file.name.toLowerCase().endsWith(ext)));
    if (invalid) {
      setError(`الملف «${invalid.name}» بصيغة غير مدعومة. المسموح: PDF أو JPG/PNG/WEBP.`);
      return;
    }
    const tooLarge = incoming.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) {
      setError(`الملف «${tooLarge.name}» أكبر من 50 ميغابايت.`);
      return;
    }
    const hasPdf = [...files, ...incoming].some((file) => file.name.toLowerCase().endsWith('.pdf'));
    if (hasPdf && files.length + incoming.length > 1) {
      setError('ملف PDF يُرفع منفردًا. ارفع صور الصفحات في رفع منفصل.');
      return;
    }
    setError(null);
    setFiles((current) => [...current, ...incoming]);
    if (!form.title && incoming[0]) {
      setForm((current) => ({ ...current, title: incoming[0].name.replace(/\.[^.]+$/, '').slice(0, 120) }));
    }
  }

  function upload() {
    if (busy) return;
    if (files.length === 0) {
      setError('اختر ملف PDF أو صور صفحات الكتاب.');
      return;
    }
    if (form.title.trim().length < 2) {
      setError('اكتب اسم الكتاب.');
      return;
    }

    const body = new FormData();
    body.append('title', form.title.trim());
    if (form.subjectId) body.append('subjectId', form.subjectId);
    if (form.gradeLevelId) body.append('gradeLevelId', form.gradeLevelId);
    if (form.semesterId) body.append('semesterId', form.semesterId);
    if (form.unitName.trim()) body.append('unitName', form.unitName.trim());
    for (const file of files) body.append('files', file);

    setBusy(true);
    setError(null);
    setProgress(0);

    const request = new XMLHttpRequest();
    request.open('POST', '/api/books');
    request.withCredentials = true;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      setBusy(false);
      let payload: { book?: { id: number }; error?: { message?: string } } | null = null;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        payload = null;
      }
      if (request.status >= 200 && request.status < 300 && payload?.book) {
        navigate(`/books/${payload.book.id}`, { replace: true });
        return;
      }
      setError(payload?.error?.message ?? `تعذّر رفع الملف (رمز ${request.status}).`);
      setProgress(0);
    };
    request.onerror = () => {
      setBusy(false);
      setProgress(0);
      setError('انقطع الاتصال أثناء الرفع. تحقّق من الشبكة وحاول مرة أخرى.');
    };
    request.send(body);
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="مكتبتك"
        title="رفع كتاب"
        subtitle="PDF نصي أو صور صفحات. المعالجة تبدأ فورًا وتستمر في الخلفية."
      />

      <div className="card space-y-4 p-5">
        {error && <Alert>{error}</Alert>}

        <Field label="اسم الكتاب" htmlFor="title">
          <input
            id="title"
            className="input"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="مثال: كتاب اللغة العربية – الصف العاشر"
            maxLength={160}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="المادة" htmlFor="subject">
            <select
              id="subject"
              className="input"
              value={form.subjectId}
              onChange={(event) => setForm((current) => ({ ...current, subjectId: event.target.value }))}
            >
              {curriculum?.subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الصف" htmlFor="grade">
            <select
              id="grade"
              className="input"
              value={form.gradeLevelId}
              onChange={(event) => setForm((current) => ({ ...current, gradeLevelId: event.target.value }))}
            >
              {curriculum?.grades.map((grade) => (
                <option key={grade.id} value={grade.id}>
                  {grade.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الفصل الدراسي" htmlFor="semester">
            <select
              id="semester"
              className="input"
              value={form.semesterId}
              onChange={(event) => setForm((current) => ({ ...current, semesterId: event.target.value }))}
            >
              {curriculum?.semesters.map((semester) => (
                <option key={semester.id} value={semester.id}>
                  {semester.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="الوحدة أو الفصل (اختياري)" htmlFor="unit">
          <input
            id="unit"
            className="input"
            value={form.unitName}
            onChange={(event) => setForm((current) => ({ ...current, unitName: event.target.value }))}
            placeholder="مثال: الوحدة الأولى"
            maxLength={120}
          />
        </Field>

        <div>
          <p className="label">الملفات</p>
          <div
            className="upload-dropzone px-4 py-6 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              addFiles(event.dataTransfer.files);
            }}
          >
            <span className="upload-icon">
              <FileUp size={20} />
            </span>
            <p className="text-sm">اسحب الملفات هنا أو اخترها من جهازك</p>
            <p className="muted mt-1 text-xs">PDF واحد، أو حتى 30 صورة (JPG/PNG/WEBP) — 50 ميغابايت للملف.</p>
            <button
              type="button"
              className="btn btn-ghost mt-3 min-h-9 px-3 text-xs"
              onClick={() => inputRef.current?.click()}
            >
              اختيار ملفات
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED.join(',')}
              multiple
              className="hidden"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </div>

          {files.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center justify-between gap-2 rounded-[11px_8px_12px_7px] border-2 border-[var(--line-soft)] bg-[var(--surface-solid)] px-3 py-2 text-xs"
                >
                  <span className="min-w-0 truncate" dir="auto">
                    {file.name}
                  </span>
                  <span className="muted shrink-0">{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    aria-label={`إزالة ${file.name}`}
                    className="grid size-6 shrink-0 place-items-center rounded-md text-[var(--color-bad)] hover:bg-[var(--surface-hover)]"
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    disabled={busy}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {busy && (
          <div>
            <div className="muted mb-1 flex justify-between text-xs">
              <span>جار رفع الملفات…</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} max={100} />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <SubmitButton type="button" busy={busy} onClick={upload} className="btn btn-primary sm:w-52">
            {busy ? 'جار الرفع…' : 'رفع وبدء المعالجة'}
          </SubmitButton>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/books')} disabled={busy}>
            إلغاء
          </button>
        </div>
      </div>
    </AppShell>
  );
}
