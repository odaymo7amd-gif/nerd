import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MessageSquareWarning, Send } from 'lucide-react';
import { DevError, DevHeader, EmptyBlock, LoadingBlock, Pager, Panel, StatusBadge } from '../ui.tsx';
import { api, ApiError, formatDateTime } from '../../../lib/api.ts';
import type { FeedbackData, FeedbackDetailData } from '../../../lib/developerTypes.ts';
import {
  categoryLabels,
  feedbackStatusLabels,
  number,
} from '../format.ts';

const statusTone: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'muted'> = {
  new: 'bad',
  reviewing: 'warn',
  in_progress: 'info',
  resolved: 'ok',
  closed: 'muted',
};

export function DeveloperFeedback({ onRefreshContext }: { onRefreshContext: () => void }) {
  const [data, setData] = useState<FeedbackData | null>(null);
  const [detail, setDetail] = useState<FeedbackDetailData | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [newStatus, setNewStatus] = useState('in_progress');

  const load = useCallback(async (nextPage = page) => {
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: '20',
        status,
        category,
      });
      const payload = await api.get<FeedbackData>(`/developer/feedback?${params}`);
      setData(payload);
      setPage(nextPage);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل البلاغات.');
    }
  }, [page, status, category]);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const payload = await api.get<FeedbackDetailData>(`/developer/feedback/${id}`);
      setDetail(payload);
      setNewStatus(payload.report.status);
      setSelected(id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل تفاصيل البلاغ.');
    }
  }, []);

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, category]);

  async function updateStatus(id: number, next: string) {
    try {
      await api.patch(`/developer/feedback/${id}`, { status: next });
      await load(page);
      if (selected === id) await loadDetail(id);
      onRefreshContext();
      setNotice('تم تحديث حالة البلاغ.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحديث البلاغ.');
    }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!selected || !reply.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post(`/developer/feedback/${selected}/replies`, {
        body: reply.trim(),
        status: newStatus,
      });
      setReply('');
      await loadDetail(selected);
      await load(page);
      onRefreshContext();
      setNotice('تم إرسال الرد وإشعار المستخدم داخل التطبيق.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إرسال الرد.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dev-stack">
      <DevHeader
        eyebrow="Feedback Center"
        title="الشكاوى والاقتراحات"
        subtitle="بلاغات المستخدمين، الردود، والتصنيفات. الرد يصل للمستخدم كإشعار داخل نيرد."
      />

      {error && <DevError>{error}</DevError>}
      {notice && <div className="dev-success">{notice}</div>}

      <div className="dev-feedback-layout">
        <div className="dev-feedback-list-column">
          <div className="dev-toolbar dev-toolbar-tight">
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="تصفية البلاغات">
              <option value="all">كل الحالات</option>
              {Object.entries(feedbackStatusLabels).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="تصفية التصنيف">
              <option value="all">كل التصنيفات</option>
              {Object.entries(categoryLabels).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          {!data ? (
            <LoadingBlock label="جار تحميل البلاغات…" />
          ) : data.reports.length === 0 ? (
            <EmptyBlock title="لا بلاغات" body="لم تصل بلاغات بهذه المعايير بعد." icon={<MessageSquareWarning size={23} />} />
          ) : (
            <Panel className="dev-feedback-list">
              <ul>
                {data.reports.map((report) => (
                  <li key={report.id}>
                    <button
                      type="button"
                      className={selected === report.id ? 'is-selected' : ''}
                      onClick={() => void loadDetail(report.id)}
                    >
                      <div className="dev-feedback-title">
                        <strong>{report.title}</strong>
                        <StatusBadge tone={statusTone[report.status] ?? 'muted'} dot>
                          {feedbackStatusLabels[report.status] ?? report.status}
                        </StatusBadge>
                      </div>
                      <p>{report.body.slice(0, 120)}…</p>
                      <small>
                        {report.username} · {categoryLabels[report.category] ?? report.category} · {formatDateTime(report.createdAt)}
                        {report.repliesCount > 0 ? ` · ${number(report.repliesCount)} ردود` : ''}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={(next) => void load(next)} />
              <p className="dev-muted-note">
                {number(data.counts.new)} جديد · {number(data.counts.reviewing)} قيد المراجعة · {number(data.counts.in_progress)} قيد الحل
              </p>
            </Panel>
          )}
        </div>

        <div className="dev-feedback-detail">
          {!detail ? (
            <Panel title="تفاصيل البلاغ">
              <EmptyBlock title="اختر بلاغًا" body="اضغط على أي بلاغ لعرض تفاصيله والرد عليه." />
            </Panel>
          ) : (
            <Panel
              title="تفاصيل البلاغ"
              subtitle={`البلاغ #${detail.report.id} · ${detail.report.email}`}
              action={
                <select value={newStatus} onChange={(event) => setNewStatus(event.target.value)} aria-label="حالة البلاغ">
                  {Object.entries(feedbackStatusLabels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              }
            >
              <div className="dev-feedback-head">
                <div>
                  <h3>{detail.report.title}</h3>
                  <p>{categoryLabels[detail.report.category] ?? detail.report.category} · {detail.report.username}</p>
                </div>
                <button type="button" className="dev-btn dev-btn-soft" onClick={() => void updateStatus(detail.report.id, newStatus)}>
                  حفظ الحالة
                </button>
              </div>
              <div className="dev-feedback-body">{detail.report.body}</div>

              <div className="dev-thread">
                {detail.replies.length === 0 ? (
                  <p className="dev-muted-note">لا ردود بعد.</p>
                ) : (
                  detail.replies.map((item) => (
                    <article key={item.id} className={item.authorRole === 'admin' ? 'is-admin' : ''}>
                      <div>
                        <strong>{item.authorRole === 'admin' ? 'فريق نيرد' : item.authorName ?? 'المستخدم'}</strong>
                        <small>{formatDateTime(item.createdAt)}</small>
                      </div>
                      <p>{item.body}</p>
                    </article>
                  ))
                )}
              </div>

              <form className="dev-reply-form" onSubmit={sendReply}>
                <label>
                  <span>الرد على المستخدم</span>
                  <textarea
                    rows={4}
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder="اكتب ردًا واضحًا، سيصل كإشعار داخل التطبيق…"
                    maxLength={2000}
                    required
                  />
                </label>
                <button type="submit" className="dev-btn dev-btn-primary" disabled={busy || reply.trim().length < 2}>
                  <Send size={15} /> {busy ? 'جار الإرسال…' : 'إرسال الرد'}
                </button>
              </form>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
