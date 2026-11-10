import { useEffect, useState, type FormEvent } from 'react';
import { Database, KeyRound, Save, Server, ShieldCheck, UserRound } from 'lucide-react';
import { DevError, DevHeader, LoadingBlock, Panel, StatusBadge, Toggle } from '../ui.tsx';
import { api, ApiError, formatBytes, formatDateTime } from '../../../lib/api.ts';
import type { SettingsData } from '../../../lib/developerTypes.ts';
import { duration } from '../format.ts';

export function DeveloperSettings({ onRefreshContext }: { onRefreshContext: () => void }) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ appName: '', aiDailyLimit: 30, feedbackEnabled: true });

  async function load() {
    try {
      const payload = await api.get<SettingsData>('/developer/settings');
      setData(payload);
      setForm({
        appName: payload.app.name,
        aiDailyLimit: payload.app.aiDailyLimit,
        feedbackEnabled: payload.app.feedbackEnabled,
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل إعدادات اللوحة.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.patch('/developer/settings', {
        appName: form.appName.trim(),
        aiDailyLimit: Number(form.aiDailyLimit),
        feedbackEnabled: form.feedbackEnabled,
      });
      setNotice('تم حفظ الإعدادات.');
      await load();
      onRefreshContext();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حفظ الإعدادات.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <DevError>{error}</DevError> : <LoadingBlock label="جار تحميل إعدادات اللوحة…" />;

  return (
    <div className="dev-stack">
      <DevHeader
        eyebrow="Control Plane"
        title="إعدادات لوحة المطوّر"
        subtitle="معلومات الحساب والخدمات والإعدادات الآمنة. لا تُعرض مفاتيح API أو أسرار الاتصال."
      />

      {error && <DevError>{error}</DevError>}
      {notice && <div className="dev-success">{notice}</div>}

      <div className="dev-grid-2">
        <Panel title="حساب المطوّر" subtitle="الوصول مرتبط بمعرّف حساب ثابت في الخادم">
          <div className="dev-account-card">
            <span className="dev-avatar">{data.admin.username.slice(0, 2).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <strong>{data.admin.username}</strong>
              <small dir="ltr">{data.admin.email}</small>
              <span className="dev-badge dev-badge-info"><ShieldCheck size={12} /> {data.admin.role}</span>
            </div>
          </div>
          <dl className="dev-definition-list">
            <div><dt>عضو منذ</dt><dd>{formatDateTime(data.admin.memberSince)}</dd></div>
            <div><dt>الصلاحية</dt><dd>مطوّر رئيسي — عبر معرّف ثابت</dd></div>
            <div><dt>المصادقة</dt><dd>جلسة HttpOnly موجودة؛ لا كلمة مرور إضافية</dd></div>
          </dl>
        </Panel>

        <Panel title="حالة الخدمات" subtitle="فحص الوضع الحالي للخدمات المرتبطة">
          <div className="dev-service-list">
            <div><span><Server size={16} /> الخادم</span><StatusBadge tone="ok" dot>يعمل</StatusBadge></div>
            <div><span><Database size={16} /> قاعدة البيانات</span><StatusBadge tone="ok" dot>متصلة</StatusBadge></div>
            <div><span><KeyRound size={16} /> مفاتيح AI</span><StatusBadge tone="muted" dot>لا تُعرض هنا</StatusBadge></div>
            {data.services.ai.map((provider) => (
              <div key={provider.id}>
                <span><UserRound size={16} /> {provider.label} ({provider.id})</span>
                <StatusBadge tone={provider.configured ? 'ok' : 'warn'} dot>
                  {provider.configured ? 'مهيأ' : 'غير مهيأ'}
                </StatusBadge>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="الإعدادات العامة" subtitle="تغييرات آمنة تُسجَّل في سجل الإجراءات الإدارية">
        <form className="dev-form" onSubmit={save}>
          <div className="dev-form-grid">
            <label>
              <span>اسم التطبيق</span>
              <input value={form.appName} onChange={(event) => setForm((current) => ({ ...current, appName: event.target.value }))} maxLength={40} required />
            </label>
            <label>
              <span>الحد اليومي لطلبات AI لكل مستخدم</span>
              <input
                type="number"
                min={1}
                max={500}
                value={form.aiDailyLimit}
                onChange={(event) => setForm((current) => ({ ...current, aiDailyLimit: Number(event.target.value) }))}
                required
              />
            </label>
          </div>
          <div className="dev-setting-switch">
            <div>
              <strong>مركز الشكاوى والاقتراحات</strong>
              <small>إظهار أو إخفاء إمكانية إرسال البلاغات للمستخدمين.</small>
            </div>
            <Toggle checked={form.feedbackEnabled} onChange={(value) => setForm((current) => ({ ...current, feedbackEnabled: value }))} label="مركز الشكاوى" />
          </div>
          <div className="dev-form-actions">
            <button type="submit" className="dev-btn dev-btn-primary" disabled={busy}>
              <Save size={15} /> {busy ? 'جار الحفظ…' : 'حفظ الإعدادات'}
            </button>
          </div>
        </form>
      </Panel>

      <div className="dev-grid-2">
        <Panel title="وقت التشغيل" subtitle="العملية الحالية فقط">
          <dl className="dev-definition-list">
            <div><dt>مدة التشغيل</dt><dd>{duration(data.runtime.uptimeSeconds)}</dd></div>
            <div><dt>إجمالي الطلبات</dt><dd>{data.runtime.requests}</dd></div>
            <div><dt>طلبات API</dt><dd>{data.runtime.apiRequests}</dd></div>
            <div><dt>معدل الأخطاء</dt><dd>{data.runtime.errorRate}%</dd></div>
            <div><dt>الذاكرة</dt><dd>{data.runtime.memoryMb} MB</dd></div>
            <div><dt>Node</dt><dd dir="ltr">{data.runtime.node}</dd></div>
          </dl>
        </Panel>
        <Panel title="النسخ الاحتياطي" subtitle="حالة فعلية دون أزرار استعادة وهمية">
          <div className="dev-backup-state">
            <StatusBadge tone={data.backups.scriptAvailable ? 'ok' : 'warn'} dot>
              {data.backups.scriptAvailable ? 'سكربت النسخ جاهز' : 'السكربت غير متاح'}
            </StatusBadge>
            <p>{data.backups.available ? `آخر نسخة: ${data.backups.items[0]?.name}` : 'لا نسخ محفوظة حتى الآن.'}</p>
          </div>
          {data.backups.items.length > 0 ? (
            <ul className="dev-backup-list">
              {data.backups.items.map((item) => (
                <li key={item.name}><span>{item.name}</span><small>{item.createdAt ? formatDateTime(item.createdAt) : '—'} · {formatBytes(item.sizeBytes)}</small></li>
              ))}
            </ul>
          ) : null}
          <p className="dev-muted-note">النسخ والاستعادة تُداران من سكربتات الخادم؛ لم أضف عمليات وهمية.</p>
        </Panel>
      </div>

      <div className="dev-note">
        <strong>ملاحظة أمنية:</strong> لا توجد صلاحيات مدير مخزّنة في الواجهة. كل طلب إلى `/api/developer` يتحقق من
        الجلسة ومن معرّف المطوّر الثابت على الخادم، والعمليات الحساسة تُسجَّل دون كلمات مرور أو مفاتيح.
      </div>
    </div>
  );
}
