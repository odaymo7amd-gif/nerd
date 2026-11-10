import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, EmptyState, FullPageLoader, PageHeader } from '../components/ui.tsx';
import { api, ApiError, formatDateTime } from '../lib/api.ts';
import type { NotificationItem } from '../lib/types.ts';

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ notifications: NotificationItem[] }>('/notifications')
      .then((data) => {
        if (!cancelled) setItems(data.notifications);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الإشعارات.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function markAll() {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/notifications/read-all');
      setItems((current) => current?.map((item) => ({ ...item, read: true })) ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحديث الإشعارات.');
    } finally {
      setBusy(false);
    }
  }

  async function markOne(id: number) {
    try {
      await api.post(`/notifications/${id}/read`);
      setItems((current) => current?.map((item) => (item.id === id ? { ...item, read: true } : item)) ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحديث الإشعار.');
    }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="صندوق الوارد"
        title="الإشعارات"
        subtitle={
          items?.some((item) => !item.read)
            ? `لديك ${items.filter((item) => !item.read).length} إشعارًا غير مقروء.`
            : 'تنبيهات الحساب والمهام والكتب.'
        }
        actions={
          <button
            type="button"
            className="btn btn-ghost min-h-9 px-3 text-xs"
            onClick={() => void markAll()}
            disabled={busy || !items?.some((item) => !item.read)}
          >
            تعليم الكل كمقروء
          </button>
        }
      />

      {error && <Alert>{error}</Alert>}

      {!items ? (
        <FullPageLoader label="جار تحميل الإشعارات…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="لا توجد إشعارات"
          body="ستظهر هنا تنبيهات مواعيد الدراسة، واكتمال معالجة الكتب، والملخصات والاختبارات."
          icon={<BellRing size={26} />}
        />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="notice-card card flex items-start justify-between gap-3 p-4"
              data-unread={!item.read}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`size-2.5 shrink-0 rounded-full border border-[var(--line)] ${
                      item.read ? 'bg-[var(--line-soft)]' : 'bg-[var(--blue)]'
                    }`}
                    aria-hidden="true"
                  />
                  <p className="font-semibold">{item.title}</p>
                  {!item.read && <span className="badge badge-blue badge-xs">جديد</span>}
                </div>
                <p className="muted mt-1 text-sm leading-6">{item.body}</p>
                <p className="muted mt-1 text-[11px]">{formatDateTime(item.createdAt)}</p>
              </div>
              {!item.read && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm shrink-0"
                  onClick={() => void markOne(item.id)}
                >
                  مقروء
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
