import { useEffect, useState } from 'react';
import { Activity, Database, HardDrive, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { DevError, DevHeader, EmptyBlock, Kpi, LoadingBlock, Panel, StatusBadge } from '../ui.tsx';
import { api, ApiError, formatBytes, formatDateTime } from '../../../lib/api.ts';
import type { HealthData } from '../../../lib/developerTypes.ts';
import { duration, number } from '../format.ts';

const statusTone = (status: string): 'ok' | 'warn' | 'bad' | 'muted' =>
  status === 'ok' ? 'ok' : status === 'warning' ? 'warn' : status === 'failed' ? 'bad' : 'muted';

export function DeveloperHealth() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    api
      .get<HealthData>('/developer/health')
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل صحة النظام.');
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (error) return <DevError>{error}</DevError>;
  if (!data) return <LoadingBlock label="جار فحص الخادم وقاعدة البيانات…" />;

  return (
    <div className="dev-stack">
      <DevHeader
        eyebrow="System Health"
        title="صحة النظام والأداء"
        subtitle="قياسات مباشرة من العملية الحالية. لا ندّعي مراقبة موارد لا تتيحها الاستضافة."
        actions={
          <button type="button" className="dev-btn dev-btn-soft" onClick={() => setRefreshKey((value) => value + 1)}>
            <RefreshCw size={15} /> فحص الآن
          </button>
        }
      />

      <div className="dev-kpi-grid dev-kpi-grid-4">
        <Kpi label="الخادم" value={data.server.status === 'ok' ? 'يعمل' : 'تحذير'} icon={<Server size={17} />} tone="mint" hint={`Node ${data.server.node}`} />
        <Kpi label="قاعدة البيانات" value={`${data.database.latencyMs} ms`} icon={<Database size={17} />} tone={statusTone(data.database.status) === 'ok' ? 'blue' : 'pink'} hint={`${number(data.database.users)} مستخدم`} />
        <Kpi label="زمن تشغيل العملية" value={duration(data.server.runtime.uptimeSeconds)} icon={<Activity size={17} />} tone="lavender" hint={`بدأ ${formatDateTime(data.server.runtime.startedAt)}`} />
        <Kpi label="معدل الأخطاء" value={`${data.server.runtime.errorRate}%`} icon={<ShieldCheck size={17} />} tone={data.server.runtime.errorRate > 1 ? 'pink' : 'mint'} hint={`${number(data.server.runtime.errors)} خطأ من ${number(data.server.runtime.requests)} طلب`} />
      </div>

      <div className="dev-grid-2">
        <Panel title="مكونات الخدمة" subtitle="الحالة من الفحص الحالي">
          <div className="dev-service-list">
            <div>
              <span><Server size={16} /> الخادم</span>
              <StatusBadge tone="ok" dot>يعمل</StatusBadge>
            </div>
            <div>
              <span><Database size={16} /> SQLite</span>
              <StatusBadge tone={statusTone(data.database.status)} dot>{data.database.status}</StatusBadge>
            </div>
            <div>
              <span><HardDrive size={16} /> التخزين المحلي</span>
              <StatusBadge tone={statusTone(data.storage.status)} dot>{data.storage.status === 'ok' ? 'متاح' : 'تحذير'}</StatusBadge>
            </div>
            {data.ai.providers.map((provider) => (
              <div key={provider.id}>
                <span><Activity size={16} /> {provider.label} ({provider.id})</span>
                <StatusBadge tone={provider.configured ? 'warn' : 'muted'} dot>
                  {provider.configured ? 'مهيأ' : 'غير مهيأ'}
                </StatusBadge>
              </div>
            ))}
          </div>
          <p className="dev-muted-note">{data.ai.message}</p>
        </Panel>

        <Panel title="الموارد والطلبات" subtitle="منذ تشغيل الخادم الحالي فقط">
          <dl className="dev-definition-list">
            <div><dt>الذاكرة المستخدمة</dt><dd>{data.server.memoryMb.heapUsed} MB</dd></div>
            <div><dt>ذاكرة العملية</dt><dd>{data.server.memoryMb.rss} MB</dd></div>
            <div><dt>إجمالي الطلبات</dt><dd>{number(data.server.runtime.requests)}</dd></div>
            <div><dt>طلبات API</dt><dd>{number(data.server.runtime.apiRequests)}</dd></div>
            <div><dt>متوسط زمن الاستجابة</dt><dd>{data.server.runtime.avgLatencyMs} ms</dd></div>
            <div><dt>حجم قاعدة البيانات</dt><dd>{formatBytes(data.database.sizeBytes)}</dd></div>
            <div><dt>سجلات المحتوى</dt><dd>{number(data.database.records)}</dd></div>
          </dl>
        </Panel>
      </div>

      <div className="dev-grid-2">
        <Panel title="النسخ الاحتياطي" subtitle="لا توجد أزرار وهمية؛ هذه حالة النظام الفعلي فقط">
          <div className="dev-backup-state">
            <StatusBadge tone={data.backups.scriptAvailable ? 'ok' : 'warn'} dot>
              {data.backups.scriptAvailable ? 'سكربت النسخ متاح على الخادم' : 'السكربت غير متاح'}
            </StatusBadge>
            <p>
              {data.backups.available
                ? `آخر نسخة محفوظة: ${data.backups.items[0]?.name}`
                : 'لا توجد نسخ محفوظة في مجلد backups بعد.'}
            </p>
          </div>
          {data.backups.items.length > 0 && (
            <ul className="dev-backup-list">
              {data.backups.items.map((item) => (
                <li key={item.name}>
                  <span>{item.name}</span>
                  <small>{item.createdAt ? formatDateTime(item.createdAt) : '—'} · {formatBytes(item.sizeBytes)}</small>
                </li>
              ))}
            </ul>
          )}
          <p className="dev-muted-note">
            الاستعادة غير مفعّلة من الواجهة. تُدار النسخ من سكربت الخادم حاليًا لحماية البيانات.
          </p>
        </Panel>

        <Panel title="آخر أخطاء الخادم" subtitle="أخطاء 500 وملخصات تقنية آمنة">
          {data.errors.length === 0 ? (
            <EmptyBlock title="لا أخطاء مسجلة" body="لم تُسجَّل أخطاء نظام حديثة." />
          ) : (
            <ul className="dev-feed">
              {data.errors.map((item) => (
                <li key={item.id}>
                  <span className="dev-feed-dot is-bad" />
                  <div className="min-w-0 flex-1">
                    <strong>{item.code ?? item.source}</strong>
                    <p>{item.message}</p>
                    <small>{item.path ?? '—'} · {formatDateTime(item.createdAt)}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
