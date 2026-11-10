import { useEffect, useState } from 'react';
import { BarChart3, Download, FileSpreadsheet, TrendingUp, Users } from 'lucide-react';
import { TrendChart, UsageBars } from '../Charts.tsx';
import { DevError, DevHeader, EmptyBlock, Kpi, LoadingBlock, Panel, StatusBadge } from '../ui.tsx';
import { api, ApiError } from '../../../lib/api.ts';
import type { AnalyticsData, RangeKey } from '../../../lib/developerTypes.ts';
import { decimal, money, number } from '../format.ts';

export function DeveloperAnalytics({ range }: { range: RangeKey }) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .get<AnalyticsData>(`/developer/analytics?range=${range}`)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل التحليلات.');
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  if (error) return <DevError>{error}</DevError>;
  if (!data) return <LoadingBlock label="جار حساب التحليلات…" />;

  const exportBase = `/api/developer/analytics/export?range=${range}`;

  return (
    <div className="dev-stack">
      <DevHeader
        eyebrow="قياس النمو"
        title="الإحصائيات والتحليلات"
        subtitle={`أرقام محسوبة من نشاط المستخدمين وسجلات AI · ${data.rangeLabel}`}
        actions={
          <>
            <a className="dev-btn dev-btn-soft" href={`${exportBase}&format=csv`} download>
              <Download size={15} /> CSV
            </a>
            <a className="dev-btn dev-btn-primary" href={`${exportBase}&format=xlsx`} download>
              <FileSpreadsheet size={15} /> Excel
            </a>
          </>
        }
      />

      <div className="dev-kpi-grid dev-kpi-grid-5">
        <Kpi label="إجمالي المستخدمين" value={number(data.metrics.totalUsers)} icon={<Users size={17} />} tone="blue" />
        <Kpi label="مستخدمون جدد" value={number(data.metrics.newUsers)} hint={data.rangeLabel} delta={data.deltas.newUsers} icon={<TrendingUp size={17} />} tone="mint" />
        <Kpi label="نشطون اليوم" value={number(data.metrics.activeToday)} icon={<BarChart3 size={17} />} tone="lavender" />
        <Kpi label="WAU / MAU" value={`${number(data.metrics.wau)} / ${number(data.metrics.mau)}`} tone="yellow" hint="أسبوعي / شهري" />
        <Kpi label="معدل العودة" value={data.metrics.retentionRate === null ? '—' : `${decimal(data.metrics.retentionRate)}%`} tone="mint" hint="من هم خارج أول 7 أيام" />
        <Kpi label="معدل التوقف" value={data.metrics.churnRate === null ? '—' : `${decimal(data.metrics.churnRate)}%`} tone="pink" hint="غير نشطين 30 يومًا" danger />
        <Kpi label="طلبات AI" value={number(data.metrics.aiRequests)} delta={data.deltas.aiRequests} tone="yellow" />
        <Kpi label="نجاح / فشل" value={`${number(data.metrics.aiSuccess)} / ${number(data.metrics.aiFailed)}`} tone="lavender" />
        <Kpi label="الرموز" value={number(data.metrics.tokens)} hint="استهلاك مسجل" tone="blue" />
        <Kpi label="التكلفة التقديرية" value={money(data.metrics.costUsd)} hint="حسب تسعير البيئة" tone="mint" />
      </div>

      <div className="dev-grid-2">
        <Panel title="نمو المستخدمين والنشاط" subtitle="التسجيلات مقابل المستخدمين الذين أنشأوا نشاطًا">
          <TrendChart
            labels={data.series.map((row) => row.day)}
            series={[
              { name: 'مستخدمون جدد', color: '#6ba8ff', values: data.series.map((row) => row.newUsers) },
              { name: 'نشاط يومي', color: '#8ed6a0', values: data.series.map((row) => row.activeUsers) },
            ]}
          />
        </Panel>
        <Panel title="نجاح وفشل طلبات AI" subtitle="مقارنة يومية بين الطلبات الناجحة والفاشلة">
          <TrendChart
            labels={data.series.map((row) => row.day)}
            series={[
              { name: 'ناجحة', color: '#8ed6a0', values: data.series.map((row) => row.aiSuccess) },
              { name: 'فاشلة', color: '#e78fa4', values: data.series.map((row) => row.aiFailed) },
            ]}
          />
        </Panel>
      </div>

      <Panel title="استخدام الأدوات" subtitle="عدد مرات الاستخدام وعدد المستخدمين ونسبة كل أداة">
        <UsageBars
          items={data.tools.map((tool, index) => ({
            label: tool.title,
            value: tool.uses,
            share: tool.share,
            tone: ['#6ba8ff', '#8ed6a0', '#f4a6b9', '#d8b4fe', '#ffd83d'][index % 5],
          }))}
        />
      </Panel>

      <Panel title="استهلاك مزودي AI" subtitle="حسب السجلات الفعلية، والتكلفة غير متاحة إذا لم تُضبط أسعار البيئة">
        {data.providers.length === 0 ? (
          <EmptyBlock title="لا استهلاك مسجل" body="لم تُسجّل طلبات ذكاء اصطناعي ضمن الفترة." />
        ) : (
          <div className="dev-table-wrap">
            <table className="dev-table">
              <thead>
                <tr>
                  <th>المزود</th>
                  <th>النموذج</th>
                  <th>الطلبات</th>
                  <th>النجاح</th>
                  <th>الفشل</th>
                  <th>النسبة</th>
                  <th>الرموز</th>
                  <th>التكلفة</th>
                </tr>
              </thead>
              <tbody>
                {data.providers.map((provider, index) => (
                  <tr key={`${provider.provider}-${provider.model ?? index}`}>
                    <td data-label="المزود"><strong>{provider.provider}</strong></td>
                    <td data-label="النموذج"><code>{provider.model ?? '—'}</code></td>
                    <td data-label="الطلبات">{number(provider.requests)}</td>
                    <td data-label="النجاح">{number(provider.success)}</td>
                    <td data-label="الفشل">{number(provider.failed)}</td>
                    <td data-label="النسبة">
                      {provider.successRate === null ? '—' : (
                        <StatusBadge tone={provider.successRate >= 95 ? 'ok' : provider.successRate >= 80 ? 'warn' : 'bad'}>
                          {decimal(provider.successRate)}%
                        </StatusBadge>
                      )}
                    </td>
                    <td data-label="الرموز">{number(provider.tokens)}</td>
                    <td data-label="التكلفة">{money(provider.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="dev-note">
        <strong>ملاحظة عن الدقة:</strong> النشاط اليومي يعتمد على الأحداث المسجلة في `activity_log`، وليس على تتبع
        تحليلي خارجي. معدل العودة تقديري للحسابات الأقدم من 7 أيام. لا يتضمن التصدير أي بيانات شخصية.
      </div>
    </div>
  );
}
