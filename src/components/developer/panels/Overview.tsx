import { useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  MessageSquareWarning,
  Users,
  UserPlus,
  UserX,
  Wrench,
  XCircle,
} from 'lucide-react';
import { TrendChart, UsageBars } from '../Charts.tsx';
import { DevError, DevHeader, EmptyBlock, Kpi, LoadingBlock, Panel, StatusBadge } from '../ui.tsx';
import { api, ApiError, formatDateTime } from '../../../lib/api.ts';
import type { OverviewData, RangeKey } from '../../../lib/developerTypes.ts';
import type { DeveloperTab } from '../DeveloperLayout.tsx';
import { connectionLabels, decimal, number } from '../format.ts';

export function DeveloperOverview({
  range,
  onNavigate,
  onRefreshContext,
}: {
  range: RangeKey;
  onNavigate: (tab: DeveloperTab) => void;
  onRefreshContext: () => void;
}) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .get<OverviewData>(`/developer/overview?range=${range}`)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل نظرة عامة.');
      });
    return () => {
      cancelled = true;
    };
  }, [range, refreshKey]);

  if (error) return <DevError>{error}</DevError>;
  if (!data) return <LoadingBlock label="جار تجميع مؤشرات نيرد…" />;

  return (
    <div className="dev-stack">
      <DevHeader
        eyebrow="مركز العمليات"
        title="نظرة عامة على نيرد"
        subtitle={`ملخص حقيقي من قاعدة البيانات · ${data.rangeLabel}`}
        actions={
          <button
            type="button"
            className="dev-btn dev-btn-soft"
            onClick={() => {
              setRefreshKey((value) => value + 1);
              onRefreshContext();
            }}
          >
            تحديث الملخص
          </button>
        }
      />

      <div className="dev-kpi-grid">
        <Kpi label="إجمالي المستخدمين" value={number(data.metrics.users)} icon={<Users size={17} />} tone="blue" hint="كل الحسابات المسجلة" />
        <Kpi label="نشطون اليوم" value={number(data.metrics.activeToday)} icon={<Activity size={17} />} tone="mint" hint="آخر ظهور اليوم" />
        <Kpi
          label="مستخدمون جدد"
          value={number(data.metrics.newUsers)}
          icon={<UserPlus size={17} />}
          tone="lavender"
          hint={data.rangeLabel}
          delta={data.deltas.newUsers}
        />
        <Kpi label="حسابات معطّلة" value={number(data.metrics.disabledUsers)} icon={<UserX size={17} />} tone="pink" danger={data.metrics.disabledUsers > 0} />
        <Kpi label="طلبات AI اليوم" value={number(data.metrics.aiToday)} icon={<Bot size={17} />} tone="yellow" hint="كل الطلبات" />
        <Kpi label="نجاح طلبات AI" value={data.successRate === null ? '—' : `${decimal(data.successRate)}%`} icon={<CheckCircle2 size={17} />} tone="mint" hint="خلال الفترة" />
        <Kpi label="طلبات فاشلة" value={number(data.metrics.aiFailed)} icon={<XCircle size={17} />} tone="pink" danger={data.metrics.aiFailed > 0} hint={data.failureRate === null ? 'لا توجد طلبات' : `${decimal(data.failureRate)}% من الطلبات`} />
        <Kpi label="أدوات مفعّلة" value={number(data.metrics.activeTools)} icon={<Wrench size={17} />} tone="lavender" hint="من أصل كل الأدوات" />
      </div>

      <div className="dev-grid-2">
        <Panel title="نمو المستخدمين" subtitle="حسابات جديدة ونشاط مسجّل يوميًا">
          <TrendChart
            labels={data.series.map((row) => row.day)}
            series={[
              { name: 'تسجيلات جديدة', color: '#6ba8ff', values: data.series.map((row) => row.signups) },
              { name: 'نشاط مستخدمين', color: '#8ed6a0', values: data.series.map((row) => row.active) },
            ]}
          />
        </Panel>
        <Panel title="حركة الذكاء الاصطناعي" subtitle="طلبات AI اليومية ضمن الفترة">
          <TrendChart
            labels={data.series.map((row) => row.day)}
            series={[{ name: 'طلبات AI', color: '#d39b4b', values: data.series.map((row) => row.ai) }]}
          />
        </Panel>
      </div>

      <div className="dev-grid-2">
        <Panel
          title="أكثر الأدوات استخدامًا"
          subtitle="عدد الاستخدامات المسجلة، لا أرقام تجريبية"
          action={
            <button type="button" className="dev-link-btn" onClick={() => onNavigate('analytics')}>
              كل التحليلات
            </button>
          }
        >
          <UsageBars
            items={data.topTools.map((tool, index) => ({
              label: tool.title,
              value: tool.uses,
              share: tool.share,
              tone: ['#6ba8ff', '#8ed6a0', '#f4a6b9', '#d8b4fe', '#ffd83d'][index % 5],
            }))}
          />
        </Panel>

        <Panel title="حالة مزودي AI" subtitle="الاتصال لا يُعتبر مؤكدًا إلا بفحص فعلي" action={<button type="button" className="dev-link-btn" onClick={() => onNavigate('ai')}>فتح المراقبة</button>}>
          <div className="dev-provider-list">
            {data.providers.map((provider) => (
              <div key={provider.id} className="dev-provider-row">
                <span className="dev-provider-mark">{provider.id}</span>
                <div className="min-w-0 flex-1">
                  <strong>{provider.label}</strong>
                  <small dir="ltr">{provider.model ?? 'لا يوجد نموذج'}</small>
                </div>
                <StatusBadge
                  tone={
                    provider.connection === 'verified'
                      ? 'ok'
                      : provider.connection === 'failed'
                        ? 'bad'
                        : provider.configured
                          ? 'warn'
                          : 'muted'
                  }
                  dot
                >
                  {connectionLabels[provider.connection]}
                </StatusBadge>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="dev-grid-2">
        <Panel
          title="آخر الأخطاء والمشكلات"
          subtitle="أخطاء AI والنظام المسجلة فعليًا"
          action={<button type="button" className="dev-link-btn" onClick={() => onNavigate('health')}>صحة النظام</button>}
        >
          {data.errors.length === 0 ? (
            <EmptyBlock title="لا أخطاء مسجلة" body="لم تُسجّل أخطاء حديثة في الفترة المعروضة." />
          ) : (
            <ul className="dev-feed">
              {data.errors.map((item) => (
                <li key={item.id}>
                  <span className="dev-feed-dot is-bad" />
                  <div className="min-w-0 flex-1">
                    <strong>{item.title}</strong>
                    <p>{item.message}</p>
                    <small>{item.source} · {formatDateTime(item.createdAt)}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="آخر النشاطات المهمة"
          subtitle="أحدث أحداث المستخدمين"
          action={<button type="button" className="dev-link-btn" onClick={() => onNavigate('activity')}>السجل الكامل</button>}
        >
          {data.activity.length === 0 ? (
            <EmptyBlock title="لا نشاط بعد" />
          ) : (
            <ul className="dev-feed">
              {data.activity.map((item) => (
                <li key={item.id}>
                  <span className="dev-feed-dot" />
                  <div className="min-w-0 flex-1">
                    <strong>{item.title}</strong>
                    <p>{item.detail ?? '—'}</p>
                    <small>{item.username ?? 'مستخدم محذوف'} · {formatDateTime(item.createdAt)}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {data.metrics.feedbackOpen > 0 && (
        <button type="button" className="dev-callout" onClick={() => onNavigate('feedback')}>
          <MessageSquareWarning size={18} />
          <span>
            <strong>{data.metrics.feedbackOpen} بلاغ مفتوح</strong>
            <small>بلاغات تنتظر المراجعة أو الرد من فريق نيرد.</small>
          </span>
          <span className="dev-callout-arrow">←</span>
        </button>
      )}
    </div>
  );
}
