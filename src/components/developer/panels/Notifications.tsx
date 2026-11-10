import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Bell, CalendarClock, Send, XCircle } from 'lucide-react';
import { DevError, DevHeader, EmptyBlock, LoadingBlock, Pager, Panel, StatusBadge } from '../ui.tsx';
import { api, ApiError, formatDateTime } from '../../../lib/api.ts';
import type { NotificationsData } from '../../../lib/developerTypes.ts';
import { audienceLabels, number, toIsoOrNull } from '../format.ts';

const statusTone: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'muted'> = {
  sent: 'ok',
  scheduled: 'warn',
  cancelled: 'muted',
  failed: 'bad',
};

const statusLabels: Record<string, string> = {
  sent: 'أُرسل',
  scheduled: 'مجدول',
  cancelled: 'ملغى',
  failed: 'فشل',
};

export function DeveloperNotifications({ onNotice }: { onNotice: () => void }) {
  const [data, setData] = useState<NotificationsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all');
  const [users, setUsers] = useState<Array<{ id: number; username: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    body: '',
    audience: 'all',
    targetUserId: '',
    scheduledAt: '',
  });

  const load = useCallback(async (nextPage = page) => {
    setError(null);
    try {
      const payload = await api.get<NotificationsData>(
        `/developer/notifications?page=${nextPage}&limit=20&status=${filter}`,
      );
      setData(payload);
      setPage(nextPage);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الإشعارات.');
    }
  }, [page, filter]);

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    api
      .get<{ users: Array<{ id: number; username: string }> }>('/developer/users?limit=50&status=active')
      .then((payload) => setUsers(payload.users))
      .catch(() => undefined);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ sent: number; status: string }>('/developer/notifications', {
        title: form.title.trim(),
        body: form.body.trim(),
        audience: form.audience,
        targetUserId: form.audience === 'user' ? Number(form.targetUserId) : null,
        scheduledAt: toIsoOrNull(form.scheduledAt),
      });
      setNotice(
        result.status === 'sent'
          ? `تم إرسال الإشعار إلى ${number(result.sent)} مستخدمًا.`
          : 'تم جدولة الإشعار وسيُرسل في الوقت المحدد.',
      );
      setForm({ title: '', body: '', audience: 'all', targetUserId: '', scheduledAt: '' });
      await load(1);
      onNotice();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إنشاء الإشعار.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: number) {
    if (!window.confirm('إلغاء هذا الإشعار المجدول؟')) return;
    try {
      await api.post(`/developer/notifications/${id}/cancel`);
      await load(page);
      onNotice();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إلغاء الإشعار.');
    }
  }

  return (
    <div className="dev-stack">
      <DevHeader
        eyebrow="التواصل"
        title="الإشعارات"
        subtitle="إرسال فوري أو مجدول لجميع المستخدمين أو شريحة محددة. تُحترم إعدادات الإشعارات الشخصية."
      />

      {error && <DevError>{error}</DevError>}
      {notice && <div className="dev-success">{notice}</div>}

      <div className="dev-grid-2 dev-grid-wide-left">
        <Panel title="إنشاء إشعار" subtitle="يظهر داخل التطبيق في صفحة الإشعارات">
          <form className="dev-form" onSubmit={submit}>
            <label>
              <span>عنوان الإشعار</span>
              <input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="مثال: تحديث جديد في نيرد"
                maxLength={120}
                required
              />
            </label>
            <label>
              <span>نص الإشعار</span>
              <textarea
                value={form.body}
                onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
                placeholder="اكتب رسالة واضحة ومختصرة…"
                rows={5}
                maxLength={1500}
                required
              />
            </label>
            <div className="dev-form-grid">
              <label>
                <span>الجمهور</span>
                <select
                  value={form.audience}
                  onChange={(event) => setForm((current) => ({ ...current, audience: event.target.value }))}
                >
                  <option value="all">كل المستخدمين النشطين</option>
                  <option value="active">نشطون آخر 7 أيام</option>
                  <option value="inactive">غير نشطين آخر 7 أيام</option>
                  <option value="new">المستخدمون الجدد</option>
                  <option value="user">مستخدم محدد</option>
                </select>
              </label>
              <label>
                <span>وقت الجدولة <small>اختياري</small></span>
                <input
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(event) => setForm((current) => ({ ...current, scheduledAt: event.target.value }))}
                />
              </label>
            </div>
            {form.audience === 'user' && (
              <label>
                <span>المستخدم المستهدف</span>
                <select
                  value={form.targetUserId}
                  onChange={(event) => setForm((current) => ({ ...current, targetUserId: event.target.value }))}
                  required
                >
                  <option value="">اختر مستخدمًا…</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>#{user.id} — {user.username}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="dev-form-actions">
              <button type="submit" className="dev-btn dev-btn-primary" disabled={busy}>
                {form.scheduledAt ? <CalendarClock size={15} /> : <Send size={15} />}
                {busy ? 'جار المعالجة…' : form.scheduledAt ? 'جدولة الإشعار' : 'إرسال الآن'}
              </button>
            </div>
          </form>
        </Panel>

        <Panel title="آخر الحملات" subtitle={`إجمالي ${number(data?.counts.all ?? 0)} حملة`}>
          <div className="dev-toolbar dev-toolbar-tight">
            <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="تصفية الحملات">
              <option value="all">كل الحالات</option>
              <option value="scheduled">مجدولة</option>
              <option value="sent">مرسلة</option>
              <option value="cancelled">ملغاة</option>
              <option value="failed">فاشلة</option>
            </select>
          </div>
          {!data ? (
            <LoadingBlock />
          ) : data.campaigns.length === 0 ? (
            <EmptyBlock title="لا حملات" body="أنشئ أول إشعار من النموذج المجاور." icon={<Bell size={22} />} />
          ) : (
            <>
              <ul className="dev-campaign-list">
                {data.campaigns.map((campaign) => (
                  <li key={campaign.id}>
                    <div className="dev-campaign-main">
                      <div className="dev-campaign-title">
                        <strong>{campaign.title}</strong>
                        <StatusBadge tone={statusTone[campaign.status] ?? 'muted'} dot>
                          {statusLabels[campaign.status] ?? campaign.status}
                        </StatusBadge>
                      </div>
                      <p>{campaign.body}</p>
                      <small>
                        {audienceLabels[campaign.audience] ?? campaign.audience}
                        {campaign.targetUsername ? ` · ${campaign.targetUsername}` : ''}
                        {' · '}
                        {campaign.status === 'sent'
                          ? `${number(campaign.recipientCount)} مستلم · ${formatDateTime(campaign.sentAt)}`
                          : campaign.status === 'scheduled' && campaign.scheduledAt
                            ? `مجدول ${formatDateTime(campaign.scheduledAt)}`
                            : `أُنشئ ${formatDateTime(campaign.createdAt)}`}
                      </small>
                    </div>
                    {campaign.status === 'scheduled' && (
                      <button type="button" className="dev-icon-btn danger" onClick={() => void cancel(campaign.id)} aria-label="إلغاء الإشعار">
                        <XCircle size={16} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={(next) => void load(next)} />
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
