import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  Trash2,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, EmptyState, Field, PageHeader, StatTile, SubmitButton } from '../components/ui.tsx';
import { api, ApiError, formatMinutes } from '../lib/api.ts';
import type { ContentListItem } from '../lib/contentTypes.ts';
import type { ScheduleResponse, StudyTask } from '../lib/scheduleTypes.ts';

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date): Date {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - offset);
  return value;
}

function addDays(date: Date, days: number): Date {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function dayLabel(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('ar-JO', { weekday: 'long', day: 'numeric', month: 'short' }).format(date);
}

function shortRange(from: string, to: string): string {
  const formatter = new Intl.DateTimeFormat('ar-JO', { day: 'numeric', month: 'short' });
  return `${formatter.format(new Date(`${from}T12:00:00`))} — ${formatter.format(new Date(`${to}T12:00:00`))}`;
}

export default function SchedulePage() {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [subjects, setSubjects] = useState<Array<{ id: number; name: string }>>([]);
  const [contents, setContents] = useState<ContentListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | 'new' | null>(null);

  const from = isoDate(anchor);
  const to = isoDate(addDays(anchor, 6));

  const [title, setTitle] = useState('');
  const [studyDate, setStudyDate] = useState(() => isoDate(new Date()));
  const [startTime, setStartTime] = useState('16:00');
  const [endTime, setEndTime] = useState('17:00');
  const [subjectId, setSubjectId] = useState('');
  const [contentId, setContentId] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const [schedule, home, contentData] = await Promise.all([
        api.get<ScheduleResponse>(`/schedule?from=${from}&to=${to}`),
        api.get<{ subjects: Array<{ id: number; name_ar: string }> }>('/home'),
        api.get<{ contents: ContentListItem[] }>('/contents'),
      ]);
      setData(schedule);
      setSubjects(home.subjects.map((subject) => ({ id: subject.id, name: subject.name_ar })));
      setContents(contentData.contents.filter((item) => item.status === 'ready' || item.status === 'needs_review'));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الجدول الدراسي.');
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (studyDate < from || studyDate > to) setStudyDate(from);
  }, [from, to, studyDate]);

  const byDay = useMemo(() => {
    const map = new Map<string, StudyTask[]>();
    for (let index = 0; index < 7; index += 1) {
      map.set(isoDate(addDays(anchor, index)), []);
    }
    for (const task of data?.tasks ?? []) {
      map.get(task.studyDate)?.push(task);
    }
    return map;
  }, [anchor, data]);

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (busyId) return;
    if (title.trim().length < 2) {
      setError('اكتب عنوان المهمة أولًا.');
      return;
    }
    setBusyId('new');
    setError(null);
    try {
      await api.post('/schedule', {
        title: title.trim(),
        studyDate,
        startTime,
        endTime,
        subjectId: subjectId ? Number(subjectId) : null,
        contentId: contentId ? Number(contentId) : null,
        notes: notes.trim() || null,
      });
      setTitle('');
      setNotes('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إضافة المهمة.');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleTask(task: StudyTask) {
    if (busyId) return;
    setBusyId(task.id);
    setError(null);
    try {
      await api.patch(`/schedule/${task.id}`, { isCompleted: !task.isCompleted });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحديث المهمة.');
    } finally {
      setBusyId(null);
    }
  }

  async function removeTask(task: StudyTask) {
    if (busyId) return;
    if (!window.confirm(`حذف مهمة «${task.title}»؟`)) return;
    setBusyId(task.id);
    setError(null);
    try {
      await api.del(`/schedule/${task.id}`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حذف المهمة.');
    } finally {
      setBusyId(null);
    }
  }

  const stats = data?.stats;

  return (
    <AppShell>
      <PageHeader
        eyebrow="التنظيم والتحفيز"
        title="الجدول الدراسي"
        subtitle="خطّط جلسات الدراسة الأسبوعية، وأنجزها واحدة واحدة، وتابع دقائقك وسلسلة التزامك."
        actions={
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="icon-btn"
              aria-label="الأسبوع السابق"
              onClick={() => setAnchor((value) => addDays(value, -7))}
            >
              <ChevronRight size={18} />
            </button>
            <button
              type="button"
              className="btn btn-soft btn-sm"
              onClick={() => setAnchor(startOfWeek(new Date()))}
            >
              هذا الأسبوع
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="الأسبوع التالي"
              onClick={() => setAnchor((value) => addDays(value, 7))}
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        }
      />

      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile tint="blue" label="مهام هذا الأسبوع" value={stats ? String(stats.total) : '…'} />
        <StatTile tint="mint" label="منجزة" value={stats ? `${stats.completed}/${stats.total}` : '…'} />
        <StatTile
          tint="yellow"
          label="دقائق مخططة"
          value={stats ? formatMinutes(stats.plannedMinutes) : '…'}
          hint={stats ? `أنجزت ${formatMinutes(stats.completedMinutes)}` : undefined}
        />
        <StatTile
          tint="pink"
          label="سلسلة الالتزام"
          value={stats ? `${stats.streakDays} يوم` : '…'}
          hint={stats ? `اليوم: ${stats.todayCompleted}/${stats.todayCount}` : undefined}
        />
      </div>

      <form onSubmit={addTask} className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="section-icon">
            <Plus size={16} />
          </span>
          <h2 className="section-title mb-0">إضافة جلسة دراسة</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Field label="عنوان المهمة" htmlFor="taskTitle">
              <input
                id="taskTitle"
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="مثال: مراجعة الوحدة الثانية"
                maxLength={120}
              />
            </Field>
          </div>
          <Field label="التاريخ" htmlFor="taskDate">
            <input
              id="taskDate"
              type="date"
              className="input"
              value={studyDate}
              min={from}
              max={to}
              onChange={(event) => setStudyDate(event.target.value)}
              required
            />
          </Field>
          <Field label="من" htmlFor="taskStart">
            <input
              id="taskStart"
              type="time"
              className="input"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              required
            />
          </Field>
          <Field label="إلى" htmlFor="taskEnd">
            <input
              id="taskEnd"
              type="time"
              className="input"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              required
            />
          </Field>
          <Field label="المادة (اختياري)" htmlFor="taskSubject">
            <select
              id="taskSubject"
              className="input"
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              <option value="">بدون مادة</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="محتوى مرتبط (اختياري)" htmlFor="taskContent">
            <select
              id="taskContent"
              className="input"
              value={contentId}
              onChange={(event) => setContentId(event.target.value)}
            >
              <option value="">بدون محتوى</option>
              {contents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Field label="ملاحظات (اختياري)" htmlFor="taskNotes">
              <input
                id="taskNotes"
                className="input"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="مثال: حل الأسئلة 1–5 ثم مراجعة الأخطاء"
                maxLength={1000}
              />
            </Field>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <SubmitButton busy={busyId === 'new'} className="btn btn-primary sm:w-auto sm:px-6">
            إضافة المهمة
          </SubmitButton>
        </div>
      </form>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title mb-0 inline-flex items-center gap-2">
            <CalendarDays size={18} />
            {shortRange(from, to)}
          </h2>
          <span className="muted text-[11px]">الأسبوع يبدأ من الاثنين</span>
        </div>

        {!data ? (
          <div className="card p-6 text-center">
            <p className="muted text-sm">جار تحميل الجدول…</p>
          </div>
        ) : data.tasks.length === 0 ? (
          <EmptyState
            title="لا توجد مهام هذا الأسبوع"
            body="أضف أول جلسة دراسة من النموذج أعلاه، وحدّد مدة واقعية. ستُحتسب دقائقها في ملفك عند إنجازها."
            icon={<CalendarDays className="w-12" />}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {[...byDay.entries()].map(([date, tasks]) => (
              <div
                key={date}
                className={`card p-3 ${date === data.today ? 'border-[var(--accent)]' : ''}`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-bold">{dayLabel(date)}</p>
                  <span className={`badge ${date === data.today ? 'badge-yellow' : ''}`}>
                    {date === data.today ? 'اليوم' : `${tasks.length} مهمة`}
                  </span>
                </div>
                {tasks.length === 0 ? (
                  <p className="muted py-2 text-xs">لا مهام في هذا اليوم.</p>
                ) : (
                  <ul className="space-y-2">
                    {tasks.map((task) => (
                      <li
                        key={task.id}
                        className={`rounded-[12px_9px_13px_8px] border-2 border-[var(--line-soft)] p-2.5 ${
                          task.isCompleted ? 'opacity-65' : ''
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] border-2 border-[var(--line)] ${
                              task.isCompleted ? 'bg-[var(--mint)] text-[#25251f]' : 'bg-[var(--surface-solid)]'
                            }`}
                            aria-label={task.isCompleted ? 'إلغاء الإنجاز' : 'إنجاز المهمة'}
                            aria-pressed={task.isCompleted}
                            onClick={() => void toggleTask(task)}
                            disabled={busyId !== null}
                          >
                            {task.isCompleted && <Check size={12} strokeWidth={3.5} />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-bold ${task.isCompleted ? 'line-through' : ''}`}>
                              {task.title}
                            </p>
                            <p className="muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                              <span className="inline-flex items-center gap-1">
                                <Clock3 size={11} />
                                {task.startTime}–{task.endTime}
                              </span>
                              {task.subjectName && <span>· {task.subjectName}</span>}
                              {task.contentTitle && <span>· {task.contentTitle}</span>}
                            </p>
                            {task.notes && <p className="muted mt-1 text-[11px] leading-5">{task.notes}</p>}
                          </div>
                          <button
                            type="button"
                            className="icon-btn is-sm text-[var(--color-bad)]"
                            aria-label="حذف المهمة"
                            onClick={() => void removeTask(task)}
                            disabled={busyId !== null}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="muted text-[11px]">
        إنجاز المهمة يضيف دقائقها إلى إحصاءاتك ونقاطك. يمكنك ربط المهمة بمحتوى دراسي وفتحه من{' '}
        <Link to="/content" className="underline">
          المكتبة
        </Link>
        .
      </p>
    </AppShell>
  );
}
