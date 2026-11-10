import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Save, Wrench } from 'lucide-react';
import { DevError, DevHeader, EmptyBlock, LoadingBlock, Panel, StatusBadge, Toggle } from '../ui.tsx';
import { api, ApiError } from '../../../lib/api.ts';
import type { ToolsData } from '../../../lib/developerTypes.ts';

export function DeveloperTools({ onRefreshContext }: { onRefreshContext: () => void }) {
  const [data, setData] = useState<ToolsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [maintenance, setMaintenance] = useState({ enabled: false, message: '' });
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await api.get<ToolsData>('/developer/tools');
      setData(payload);
      setMaintenance(payload.maintenance);
      setMessages(
        Object.fromEntries(payload.tools.map((tool) => [tool.key, tool.maintenanceMessage ?? ''])),
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الأدوات.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleTool(key: string, enabled: boolean) {
    setSaving(key);
    setError(null);
    try {
      await api.patch(`/developer/tools/${key}`, { enabled });
      await load();
      onRefreshContext();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحديث الأداة.');
    } finally {
      setSaving(null);
    }
  }

  async function saveMessage(key: string) {
    setSaving(key);
    setError(null);
    setNotice(null);
    try {
      await api.patch(`/developer/tools/${key}`, {
        maintenanceMessage: messages[key]?.trim() || null,
      });
      setNotice('تم حفظ رسالة الصيانة.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حفظ الرسالة.');
    } finally {
      setSaving(null);
    }
  }

  async function saveMaintenance(enabled: boolean) {
    if (!maintenance.message.trim()) {
      setError('اكتب رسالة الصيانة أولًا.');
      return;
    }
    setMaintenanceBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.patch('/developer/maintenance', {
        enabled,
        message: maintenance.message.trim(),
      });
      setNotice(enabled ? 'تم تفعيل وضع الصيانة العام على الخادم.' : 'تم إلغاء وضع الصيانة العام.');
      await load();
      onRefreshContext();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حفظ وضع الصيانة.');
    } finally {
      setMaintenanceBusy(false);
    }
  }

  if (!data) return error ? <DevError>{error}</DevError> : <LoadingBlock label="جار تحميل الأدوات…" />;

  return (
    <div className="dev-stack">
      <DevHeader
        eyebrow="التحكم التشغيلي"
        title="الأدوات والصيانة"
        subtitle="الإيقاف يُفرض على الخادم، وليس بإخفاء الواجهة فقط."
      />

      {error && <DevError>{error}</DevError>}
      {notice && <div className="dev-success">{notice}</div>}

      <Panel title="وضع الصيانة العام" subtitle="يمنع وصول الطلاب إلى واجهات التطبيق ويُبقي الدخول ولوحة المطوّر متاحين.">
        <div className={`dev-maintenance-box ${maintenance.enabled ? 'is-on' : ''}`}>
          <div className="dev-maintenance-head">
            <span className="dev-maintenance-icon"><AlertTriangle size={20} /></span>
            <div className="min-w-0 flex-1">
              <strong>{maintenance.enabled ? 'الصيانة مفعّلة الآن' : 'التطبيق يعمل بشكل طبيعي'}</strong>
              <small>تغيير الحالة يسري فورًا على طلبات API للطلاب.</small>
            </div>
            <StatusBadge tone={maintenance.enabled ? 'warn' : 'ok'} dot>
              {maintenance.enabled ? 'صيانة' : 'يعمل'}
            </StatusBadge>
          </div>
          <label className="dev-form">
            <span>رسالة الصيانة التي تظهر للمستخدم</span>
            <textarea
              rows={3}
              value={maintenance.message}
              onChange={(event) => setMaintenance((current) => ({ ...current, message: event.target.value }))}
              maxLength={500}
            />
          </label>
          <div className="dev-form-actions">
            <button
              type="button"
              className={`dev-btn ${maintenance.enabled ? 'dev-btn-soft' : 'dev-btn-danger'}`}
              disabled={maintenanceBusy}
              onClick={() => void saveMaintenance(!maintenance.enabled)}
            >
              {maintenanceBusy ? 'جار الحفظ…' : maintenance.enabled ? 'إلغاء الصيانة' : 'تفعيل الصيانة'}
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="أدوات التطبيق" subtitle={`${data.tools.length} أداة مرتبطة بأعلام الميزات في قاعدة البيانات`}>
        {data.tools.length === 0 ? (
          <EmptyBlock title="لا أدوات" />
        ) : (
          <div className="dev-tool-grid">
            {data.tools.map((tool) => (
              <article key={tool.key} className={`dev-tool-card ${tool.enabled ? '' : 'is-off'}`}>
                <div className="dev-tool-card-head">
                  <span className="dev-tool-mark"><Wrench size={17} /></span>
                  <div className="min-w-0 flex-1">
                    <strong>{tool.title}</strong>
                    <small dir="ltr">{tool.key}</small>
                  </div>
                  <Toggle
                    checked={tool.enabled}
                    disabled={saving === tool.key}
                    onChange={(value) => void toggleTool(tool.key, value)}
                    label={`تشغيل ${tool.title}`}
                  />
                </div>
                <p>{tool.description}</p>
                <StatusBadge tone={tool.enabled ? 'ok' : 'bad'} dot>
                  {tool.enabled ? 'مفعّلة' : 'متوقفة'}
                </StatusBadge>
                <label className="dev-tool-message">
                  <span>رسالة التوقف</span>
                  <textarea
                    rows={2}
                    value={messages[tool.key] ?? ''}
                    onChange={(event) => setMessages((current) => ({ ...current, [tool.key]: event.target.value }))}
                    placeholder={tool.enabled ? 'اختيارية عند الإيقاف…' : 'تظهر للمستخدم عند محاولة الاستخدام'}
                    maxLength={500}
                  />
                </label>
                <button
                  type="button"
                  className="dev-btn dev-btn-tiny dev-btn-soft"
                  disabled={saving === tool.key}
                  onClick={() => void saveMessage(tool.key)}
                >
                  <Save size={13} /> حفظ الرسالة
                </button>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
