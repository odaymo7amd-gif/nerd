import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, FlaskConical, RefreshCw, ServerCog } from 'lucide-react';
import { DevError, DevHeader, DevTabs, EmptyBlock, Kpi, LoadingBlock, Pager, Panel, StatusBadge } from '../ui.tsx';
import { api, ApiError, formatDateTime } from '../../../lib/api.ts';
import type { AiData, RangeKey } from '../../../lib/developerTypes.ts';
import { connectionLabels, decimal, money, number } from '../format.ts';

export function DeveloperAi({ range }: { range: RangeKey; onRefreshContext: () => void }) {
  const [data, setData] = useState<AiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('providers');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [task, setTask] = useState('');
  const [q, setQ] = useState('');
  const [checking, setChecking] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<Record<string, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async (nextPage = page) => {
    setError(null);
    try {
      const params = new URLSearchParams({
        range,
        page: String(nextPage),
        limit: '20',
        status,
        task,
        q,
      });
      const payload = await api.get<AiData>(`/developer/ai?${params}`);
      setData(payload);
      setPage(nextPage);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل مراقبة AI.');
    }
  }, [range, page, status, task, q]);

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, status, task, refreshKey]);

  async function runCheck(id: 'A' | 'B') {
    setChecking(id);
    setCheckResult((current) => ({ ...current, [id]: '' }));
    try {
      const result = await api.post<{ ok: boolean; message: string; latencyMs: number }>(`/developer/ai/providers/${id}/check`);
      setCheckResult((current) => ({
        ...current,
        [id]: `${result.message} (${result.latencyMs}ms)`,
      }));
      await load(page);
    } catch (caught) {
      setCheckResult((current) => ({
        ...current,
        [id]: caught instanceof ApiError ? caught.message : 'تعذّر فحص المزوّد.',
      }));
    } finally {
      setChecking(null);
    }
  }

  if (!data && error) return <DevError>{error}</DevError>;
  if (!data) return <LoadingBlock label="جار تحميل مراقبة الذكاء الاصطناعي…" />;

  return (
    <div className="dev-stack">
      <DevHeader
        eyebrow="AI Operations"
        title="مراقبة الذكاء الاصطناعي"
        subtitle="أحداث حقيقية من AI Router. لا تُعرض المفاتيح، ولا يُعدّ المزود متصلًا دون فحص يدوي."
        actions={
          <button type="button" className="dev-btn dev-btn-soft" onClick={() => setRefreshKey((value) => value + 1)}>
            <RefreshCw size={15} /> تحديث
          </button>
        }
      />

      <div className="dev-kpi-grid dev-kpi-grid-4">
        <Kpi label="إجمالي الطلبات" value={number(data.totals.requests)} icon={<Bot size={17} />} tone="lavender" hint={data.rangeLabel} />
        <Kpi label="نسبة النجاح" value={data.totals.successRate === null ? '—' : `${decimal(data.totals.successRate)}%`} icon={<CheckCircle2 size={17} />} tone="mint" />
        <Kpi label="الرموز" value={number(data.totals.tokens)} icon={<ServerCog size={17} />} tone="blue" hint="إجمالي مسجل" />
        <Kpi label="التكلفة التقديرية" value={money(data.totals.costUsd)} tone="yellow" hint="حسب أسعار البيئة" />
      </div>

      <div className="dev-provider-cards">
        {data.providers.map((provider) => (
          <article key={provider.id} className={`dev-provider-card is-${provider.connection}`}>
            <div className="dev-provider-card-head">
              <span className="dev-provider-letter">{provider.id}</span>
              <div className="min-w-0 flex-1">
                <h3>{provider.label}</h3>
                <p dir="ltr">{provider.model ?? 'غير مهيأ'}</p>
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
            <div className="dev-provider-grid">
              <span><small>الطلبات</small><b>{number(provider.requests)}</b></span>
              <span><small>النجاح</small><b>{number(provider.successes)}</b></span>
              <span><small>الفشل</small><b>{number(provider.failures)}</b></span>
              <span><small>متوسط الاستجابة</small><b>{provider.avgLatencyMs ? `${number(provider.avgLatencyMs)} ms` : '—'}</b></span>
              <span><small>الرموز</small><b>{number(provider.tokensIn + provider.tokensOut)}</b></span>
              <span><small>الاحتياطي</small><b>{number(provider.fallbacks)}</b></span>
            </div>
            {provider.lastError && (
              <p className="dev-provider-error">آخر خطأ: {provider.lastError}</p>
            )}
            <div className="dev-provider-card-foot">
              <button
                type="button"
                className="dev-btn dev-btn-soft dev-btn-small"
                disabled={!provider.configured || checking === provider.id}
                onClick={() => void runCheck(provider.id)}
              >
                <FlaskConical size={14} />
                {checking === provider.id ? 'جار الفحص…' : 'فحص الاتصال فعليًا'}
              </button>
              {provider.lastHealthCheck && (
                <small>آخر فحص: {formatDateTime(provider.lastHealthCheck.createdAt)}</small>
              )}
            </div>
            {checkResult[provider.id] && <p className="dev-check-result">{checkResult[provider.id]}</p>}
          </article>
        ))}
      </div>

      {error && <DevError>{error}</DevError>}

      <DevTabs
        tabs={[
          { key: 'providers', label: 'ملخص المزودين' },
          { key: 'routing', label: 'توجيه المهام والنماذج', count: data.routing.length },
          { key: 'logs', label: 'سجلات الطلبات', count: data.total },
          { key: 'errors', label: 'الأخطاء', count: data.errors.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'providers' && (
        <div className="dev-grid-2">
          <Panel title="توزيع الطلبات على المهام" subtitle="أكثر المهام طلبًا للذكاء الاصطناعي">
            {data.tasks.length === 0 ? (
              <EmptyBlock title="لا طلبات" />
            ) : (
              <div className="dev-provider-list">
                {data.tasks.slice(0, 10).map((item) => (
                  <div key={item.task} className="dev-provider-row">
                    <span className="dev-task-mark">{item.task.slice(0, 2).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <strong dir="ltr">{item.task}</strong>
                      <small>مهمة مسجلة في AI Router</small>
                    </div>
                    <b>{number(item.requests)}</b>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="قاموس الحالات" subtitle="معنى حالة الاتصال المعروضة">
            <dl className="dev-definition-list">
              <div><dt>متصل ومتحقق</dt><dd>آخر فحص يدوي ناجح من اللوحة.</dd></div>
              <div><dt>مهيأ وغير متحقق</dt><dd>المفاتيح موجودة لكن لم يُجرَ فحص اتصال.</dd></div>
              <div><dt>فشل آخر فحص</dt><dd>الفحص اليدوي الأخير أعاد خطأ.</dd></div>
              <div><dt>غير مهيأ</dt><dd>لا توجد إعدادات مزوّد على الخادم.</dd></div>
            </dl>
          </Panel>
        </div>
      )}

      {tab === 'routing' && (
        <Panel title="أي نموذج يخدم أي أداة؟" subtitle="هذا هو التوجيه الفعلي الحالي في AI Router">
          <div className="dev-table-wrap">
            <table className="dev-table">
              <thead>
                <tr>
                  <th>المهمة</th>
                  <th>المزود الأساسي</th>
                  <th>النموذج الأساسي</th>
                  <th>المزود الاحتياطي</th>
                  <th>نموذج الاحتياطي</th>
                  <th>رؤية</th>
                </tr>
              </thead>
              <tbody>
                {data.routing.map((route) => (
                  <tr key={route.task}>
                    <td data-label="المهمة"><code>{route.task}</code></td>
                    <td data-label="المزود الأساسي">{route.primary.label} <small>({route.primary.id})</small></td>
                    <td data-label="النموذج الأساسي"><code dir="ltr">{route.primary.model ?? '—'}</code></td>
                    <td data-label="المزود الاحتياطي">{route.fallback.label} <small>({route.fallback.id})</small></td>
                    <td data-label="نموذج الاحتياطي"><code dir="ltr">{route.fallback.model ?? '—'}</code></td>
                    <td data-label="رؤية">{route.vision ? <StatusBadge tone="info">مدعومة</StatusBadge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {tab === 'logs' && (
        <Panel
          title="سجلات طلبات AI"
          subtitle="لا تُسجَّل نصوص المحادثات أو الملفات هنا"
          action={
            <div className="dev-inline-filters">
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">كل الحالات</option>
                <option value="success">ناجحة</option>
                <option value="failed">فاشلة</option>
              </select>
              <select value={task} onChange={(event) => setTask(event.target.value)}>
                <option value="">كل المهام</option>
                {data.tasks.map((item) => <option key={item.task} value={item.task}>{item.task}</option>)}
              </select>
              <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="بحث…" aria-label="بحث السجلات" />
            </div>
          }
        >
          {data.logs.length === 0 ? (
            <EmptyBlock title="لا سجلات" body="لم تُسجّل طلبات بهذه المعايير." />
          ) : (
            <>
              <div className="dev-table-wrap">
                <table className="dev-table">
                  <thead>
                    <tr>
                      <th>المهمة</th>
                      <th>المستخدم</th>
                      <th>المزود</th>
                      <th>النموذج</th>
                      <th>الرموز</th>
                      <th>الاستجابة</th>
                      <th>الحالة</th>
                      <th>الوقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.logs.map((log) => (
                      <tr key={log.id}>
                        <td data-label="المهمة"><code>{log.task}</code>{log.errorCode && <small className="dev-block dev-soft">{log.errorCode}</small>}</td>
                        <td data-label="المستخدم">{log.username ?? 'محذوف'}</td>
                        <td data-label="المزود">{log.provider ?? '—'}</td>
                        <td data-label="النموذج"><code dir="ltr">{log.model ?? '—'}</code></td>
                        <td data-label="الرموز">{number(log.tokensIn + log.tokensOut)}</td>
                        <td data-label="الاستجابة">{log.latencyMs ? `${log.latencyMs} ms` : '—'}</td>
                        <td data-label="الحالة">
                          <StatusBadge tone={log.status === 'success' ? 'ok' : 'bad'} dot>
                            {log.status === 'success' ? 'ناجح' : 'فاشل'}
                          </StatusBadge>
                        </td>
                        <td data-label="الوقت">{formatDateTime(log.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={(next) => void load(next)} />
            </>
          )}
        </Panel>
      )}

      {tab === 'errors' && (
        <div className="dev-grid-2">
          <Panel title="أخطاء متكررة" subtitle="تجميع بحسب المزود والمهمة ورمز الخطأ">
            {data.errorGroups.length === 0 ? (
              <EmptyBlock title="لا أخطاء ضمن الفترة" />
            ) : (
              <ul className="dev-error-groups">
                {data.errorGroups.map((group, index) => (
                  <li key={`${group.provider}-${group.task}-${group.code}-${index}`}>
                    <div>
                      <strong>{group.code ?? 'خطأ غير معروف'}</strong>
                      <small>{group.provider} · {group.task}</small>
                    </div>
                    <span>{group.repeats}×</span>
                    <small>{formatDateTime(group.lastAt)}</small>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="آخر الأخطاء الفنية" subtitle="ملخصات آمنة دون أسرار أو مفاتيح">
            {data.errors.length === 0 ? (
              <EmptyBlock title="لا أخطاء" />
            ) : (
              <ul className="dev-feed">
                {data.errors.slice(0, 12).map((item) => (
                  <li key={item.id}>
                    <span className="dev-feed-dot is-bad" />
                    <div className="min-w-0 flex-1">
                      <strong>{item.code ?? item.task}</strong>
                      <p>{item.message ?? '—'}</p>
                      <small>{item.provider} · {formatDateTime(item.createdAt)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
