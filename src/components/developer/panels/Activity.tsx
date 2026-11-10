import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { DevError, DevHeader, DevTabs, EmptyBlock, LoadingBlock, Pager, Panel, StatusBadge } from '../ui.tsx';
import { api, ApiError, formatDateTime } from '../../../lib/api.ts';
import type { ActivityData, RangeKey } from '../../../lib/developerTypes.ts';
import { sourceLabel } from '../format.ts';

export function DeveloperActivity({ range }: { range: RangeKey }) {
  const [data, setData] = useState<ActivityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (nextPage = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        range,
        page: String(nextPage),
        limit: '25',
        scope,
        q: q.trim(),
      });
      const payload = await api.get<ActivityData>(`/developer/activity?${params}`);
      setData(payload);
      setPage(nextPage);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل سجل النشاطات.');
    } finally {
      setLoading(false);
    }
  }, [range, page, scope, q]);

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, scope]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void load(1);
  }

  return (
    <div className="dev-stack">
      <DevHeader
        eyebrow="Audit Trail"
        title="سجل النشاطات"
        subtitle="نشاط المستخدمين، الإجراءات الإدارية، طلبات AI، وأخطاء النظام في مسار واحد."
      />

      <div className="dev-toolbar">
        <form className="dev-search" onSubmit={submit}>
          <Search size={17} />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="ابحث في العناوين والتفاصيل والمستخدمين…" aria-label="بحث السجل" />
          <button type="submit" className="dev-btn dev-btn-primary">بحث</button>
        </form>
      </div>

      <DevTabs
        tabs={[
          { key: 'all', label: 'الكل' },
          { key: 'users', label: 'نشاط المستخدمين' },
          { key: 'admin', label: 'الإجراءات الإدارية' },
          { key: 'ai', label: 'طلبات AI' },
          { key: 'errors', label: 'أخطاء النظام' },
        ]}
        active={scope}
        onChange={(next) => { setPage(1); setScope(next); }}
      />

      {error && <DevError>{error}</DevError>}
      {loading && !data ? (
        <LoadingBlock label="جار تحميل السجل…" />
      ) : !data || data.items.length === 0 ? (
        <EmptyBlock title="لا سجلات" body="غيّر النطاق أو الفترة أو عبارة البحث." />
      ) : (
        <Panel className="dev-panel-table">
          <div className="dev-table-wrap">
            <table className="dev-table dev-table-activity">
              <thead>
                <tr>
                  <th>النوع</th>
                  <th>الحدث</th>
                  <th>التفاصيل</th>
                  <th>المستخدم / المنفّذ</th>
                  <th>النتيجة</th>
                  <th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.key}>
                    <td data-label="النوع">
                      <StatusBadge
                        tone={item.source === 'error' ? 'bad' : item.source === 'admin' ? 'info' : item.source === 'ai' ? 'warn' : 'muted'}
                      >
                        {sourceLabel(item.source)}
                      </StatusBadge>
                    </td>
                    <td data-label="الحدث"><strong>{item.title}</strong><small className="dev-block dev-soft" dir="ltr">{item.kind}</small></td>
                    <td data-label="التفاصيل">{item.detail ?? '—'}</td>
                    <td data-label="المستخدم / المنفّذ">
                      {item.actor ?? '—'}
                      {item.userId ? <small className="dev-block dev-soft">#{item.userId}</small> : null}
                    </td>
                    <td data-label="النتيجة">
                      {item.result ? (
                        <StatusBadge tone={item.result === 'failed' || item.result === 'error' ? 'bad' : item.result === 'success' || item.result === 'sent' ? 'ok' : 'muted'}>
                          {item.result}
                        </StatusBadge>
                      ) : '—'}
                    </td>
                    <td data-label="الوقت">{formatDateTime(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pages={data.pages} total={data.total} onPage={(next) => void load(next)} />
          <p className="dev-muted-note">لا تتضمن السجلات محتوى المحادثات أو الملفات الخاصة أو كلمات المرور أو مفاتيح API.</p>
        </Panel>
      )}
    </div>
  );
}
