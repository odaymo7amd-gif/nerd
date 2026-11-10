import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ChevronLeft, MessageSquarePlus, MessagesSquare, Send } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, EmptyState, FullPageLoader, PageHeader } from '../components/ui.tsx';
import { api, ApiError, formatDateTime } from '../lib/api.ts';

interface Report {
  id: number;
  category: string;
  title: string;
  body: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  repliesCount: number;
}

interface Reply {
  id: number;
  body: string;
  authorRole: string;
  authorName: string | null;
  createdAt: string;
}

const categories: Array<{ value: string; label: string }> = [
  { value: 'technical', label: 'مشكلة تقنية' },
  { value: 'suggestion', label: 'اقتراح أو فكرة' },
  { value: 'ai', label: 'مشكلة في الذكاء الاصطناعي' },
  { value: 'account', label: 'الحساب أو تسجيل الدخول' },
  { value: 'tool', label: 'أداة دراسية' },
  { value: 'other', label: 'موضوع آخر' },
];

const statusLabels: Record<string, string> = {
  new: 'جديد',
  reviewing: 'قيد المراجعة',
  in_progress: 'قيد الحل',
  resolved: 'تم الحل',
  closed: 'مغلق',
};

const statusClasses: Record<string, string> = {
  new: 'badge-pink',
  reviewing: 'badge-yellow',
  in_progress: 'badge-blue',
  resolved: 'badge-mint',
  closed: '',
};

export default function FeedbackPage() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [selected, setSelected] = useState<{ report: Report; replies: Reply[] } | null>(null);
  const [category, setCategory] = useState('technical');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await api.get<{ reports: Report[] }>('/feedback');
      setReports(payload.reports);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل بلاغاتك.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(report: Report) {
    setError(null);
    try {
      const payload = await api.get<{ report: Report; replies: Reply[] }>(`/feedback/${report.id}`);
      setSelected(payload);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل البلاغ.');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ message: string }>('/feedback', { category, title: title.trim(), body: body.trim() });
      setNotice(result.message);
      setTitle('');
      setBody('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إرسال البلاغ.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="مركز المساعدة"
        title="الشكاوى والاقتراحات"
        subtitle="أخبرنا بأي مشكلة أو فكرة. البلاغ يصل لفريق نيرد، وأي رد سيظهر لك هنا وفي الإشعارات."
      />

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <MessageSquarePlus size={19} className="text-[var(--accent)]" /> بلاغ جديد
            </h2>
            <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--muted)]">
                التصنيف
                <select className="input" value={category} onChange={(event) => setCategory(event.target.value)}>
                  {categories.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--muted)]">
                العنوان
                <input
                  className="input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="ملخص قصير للمشكلة"
                  minLength={5}
                  maxLength={120}
                  required
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--muted)]">
                التفاصيل
                <textarea
                  className="input min-h-32 resize-y"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="ماذا حدث؟ ما الخطوات التي جرّبتها؟ لا تشارك كلمات المرور أو مفاتيح API."
                  minLength={20}
                  maxLength={4000}
                  required
                />
              </label>
              <p className="text-[11px] leading-5 text-[var(--muted)]">
                يمكنك إرسال 5 بلاغات كحد أقصى في الساعة. لا تُدرج بيانات حساسة.
              </p>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                <Send size={15} /> {busy ? 'جار الإرسال…' : 'إرسال البلاغ'}
              </button>
            </form>
          </section>
        </div>

        <section className="flex flex-col gap-3">
          {selected ? (
            <div className="card overflow-hidden">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex w-full items-center gap-1 border-b border-[var(--border)] px-4 py-3 text-xs font-bold text-[var(--accent)] hover:bg-[var(--surface-hover)]"
              >
                <ChevronLeft size={15} /> كل البلاغات
              </button>
              <div className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold">{selected.report.title}</h2>
                    <p className="muted mt-1 text-[11px]">
                      {categories.find((item) => item.value === selected.report.category)?.label ?? selected.report.category}
                      {' · '}{formatDateTime(selected.report.createdAt)}
                    </p>
                  </div>
                  <span className={`badge ${statusClasses[selected.report.status] ?? ''}`}>
                    {statusLabels[selected.report.status] ?? selected.report.status}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap rounded-[12px] border border-[var(--line-soft)] bg-[var(--surface-hover)] p-3 text-sm leading-7">
                  {selected.report.body}
                </p>

                <h3 className="mt-4 text-sm font-bold">المحادثة</h3>
                {selected.replies.length === 0 ? (
                  <p className="muted mt-2 text-xs leading-6">لا ردود بعد. سنراجع بلاغك قريبًا.</p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    {selected.replies.map((reply) => (
                      <article
                        key={reply.id}
                        className={`rounded-[12px] border p-3 ${
                          reply.authorRole === 'admin'
                            ? 'border-[color-mix(in_srgb,var(--accent)_30%,var(--line-soft))] bg-[color-mix(in_srgb,var(--accent)_6%,var(--surface))]'
                            : 'border-[var(--line-soft)] bg-[var(--surface-hover)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <strong className="text-xs">{reply.authorRole === 'admin' ? 'فريق نيرد' : 'أنت'}</strong>
                          <small className="muted text-[10px]">{formatDateTime(reply.createdAt)}</small>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-xs leading-6">{reply.body}</p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="border-b border-[var(--border)] px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-bold">
                  <MessagesSquare size={17} /> بلاغاتك السابقة
                </h2>
              </div>
              {!reports ? (
                <FullPageLoader label="جار تحميل البلاغات…" />
              ) : reports.length === 0 ? (
                <EmptyState
                  icon={<MessagesSquare size={23} />}
                  title="لا بلاغات بعد"
                  body="إذا واجهت مشكلة أو لديك فكرة، أرسل أول بلاغ من النموذج."
                />
              ) : (
                <ul>
                  {reports.map((report) => (
                    <li key={report.id} className="border-b border-[var(--line-soft)] last:border-0">
                      <button
                        type="button"
                        onClick={() => void open(report)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-[var(--surface-hover)]"
                      >
                        <span className={`badge mt-0.5 shrink-0 ${statusClasses[report.status] ?? ''}`}>
                          {statusLabels[report.status] ?? report.status}
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block text-xs">{report.title}</strong>
                          <span className="muted mt-0.5 line-clamp-2 block text-[11px] leading-5">{report.body}</span>
                          <small className="muted mt-1 block text-[10px]">
                            {formatDateTime(report.createdAt)}
                            {report.repliesCount > 0 ? ` · ${report.repliesCount} رد` : ''}
                          </small>
                        </span>
                        <ChevronLeft size={15} className="muted mt-1 shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
