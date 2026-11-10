import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Search, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DevError, DevHeader, DevTabs, EmptyBlock, LoadingBlock, Pager, Panel, StatusBadge } from '../ui.tsx';
import { api, ApiError, formatDateTime } from '../../../lib/api.ts';
import type { UsersData } from '../../../lib/developerTypes.ts';
import { number } from '../format.ts';

const toolLabels: Record<string, string> = {
  books: 'الكتب',
  'content-library': 'المحتوى',
  tests: 'الاختبارات',
  summary: 'الملخصات',
  schedule: 'الجدول',
  'daily-challenge': 'التحدي اليومي',
  'ai-chat': 'الدردشة',
  teacher: 'اسأل المعلم',
  solver: 'حل المسائل',
  grader: 'التصحيح',
  expression: 'التعبير',
  'english-grammar': 'الإنجليزية',
  'arabic-grammar': 'العربية',
  'question-bank': 'بنك الأسئلة',
  'global-search': 'البحث',
};

export function DeveloperUsers({
  onError,
  onNotice,
}: {
  onError: (message: string) => void;
  onNotice: () => void;
}) {
  const navigate = useNavigate();
  const [data, setData] = useState<UsersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage = page) => {
      setLoading(true);
      setLocalError(null);
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          limit: '20',
          status,
          sort,
          q: q.trim(),
        });
        const payload = await api.get<UsersData>(`/developer/users?${params}`);
        setData(payload);
        setPage(nextPage);
      } catch (caught) {
        const message = caught instanceof ApiError ? caught.message : 'تعذّر تحميل المستخدمين.';
        setLocalError(message);
        onError(message);
      } finally {
        setLoading(false);
      }
    },
    [page, status, sort, q, onError],
  );

  useEffect(() => {
    void load(1);
    // تحميل أولي فقط عند تغيير الفلاتر.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sort]);

  async function toggleActive(id: number, active: boolean) {
    if (busy) return;
    if (!window.confirm(active ? 'تعطيل الحساب وإلغاء جلساته الحالية؟' : 'إعادة تفعيل الحساب؟')) return;
    setBusy(id);
    try {
      await api.patch(`/developer/users/${id}`, { isActive: active });
      await load(page);
      onNotice();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'تعذّر تحديث الحساب.';
      setLocalError(message);
      onError(message);
    } finally {
      setBusy(null);
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    void load(1);
  }

  return (
    <div className="dev-stack">
      <DevHeader
        eyebrow="إدارة الحسابات"
        title="المستخدمون"
        subtitle="بحث وتصفية ومراجعة النشاط، مع تعطيل آمن وإعادة تفعيل."
      />

      <div className="dev-toolbar">
        <form className="dev-search" onSubmit={submitSearch}>
          <Search size={17} />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="ابحث بالاسم أو البريد أو معرّف الحساب…"
            aria-label="بحث المستخدمين"
          />
          <button type="submit" className="dev-btn dev-btn-primary">بحث</button>
        </form>
        <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="ترتيب المستخدمين">
          <option value="newest">الأحدث تسجيلًا</option>
          <option value="active">الأكثر نشاطًا</option>
          <option value="oldest">الأقدم</option>
          <option value="name">الاسم</option>
        </select>
      </div>

      <DevTabs
        tabs={[
          { key: 'all', label: 'الكل', count: data?.counts.all },
          { key: 'active', label: 'نشط', count: data?.counts.active },
          { key: 'disabled', label: 'معطّل', count: data?.counts.disabled },
          { key: 'new', label: 'جديد', count: data?.counts.new },
        ]}
        active={status}
        onChange={(next) => {
          setPage(1);
          setStatus(next);
        }}
      />

      {localError && <DevError>{localError}</DevError>}
      {loading && !data ? (
        <LoadingBlock label="جار تحميل الحسابات…" />
      ) : !data || data.users.length === 0 ? (
        <EmptyBlock title="لا نتائج" body="جرّب تغيير البحث أو التصفية." />
      ) : (
        <Panel className="dev-panel-table">
          <div className="dev-table-wrap">
            <table className="dev-table">
              <thead>
                <tr>
                  <th>المستخدم</th>
                  <th>المعرّف</th>
                  <th>التسجيل</th>
                  <th>آخر ظهور</th>
                  <th>الحالة</th>
                  <th>AI</th>
                  <th>الاختبارات</th>
                  <th>الملخصات</th>
                  <th>الأداة الأكثر</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => (
                  <tr key={user.id} className={!user.isActive ? 'is-muted' : ''}>
                    <td data-label="المستخدم">
                      <button type="button" className="dev-user-cell" onClick={() => navigate(`/developer/users/${user.id}`)}>
                        <span className="dev-avatar-sm">{user.username.slice(0, 2).toUpperCase()}</span>
                        <span className="min-w-0">
                          <strong>{user.username}</strong>
                          <small dir="ltr">{user.email}</small>
                        </span>
                      </button>
                    </td>
                    <td data-label="المعرّف"><code>#{user.id}</code></td>
                    <td data-label="التسجيل">{formatDateTime(user.createdAt)}</td>
                    <td data-label="آخر ظهور">{user.lastActiveAt ? formatDateTime(user.lastActiveAt) : 'لم يسجل'}</td>
                    <td data-label="الحالة">
                      {user.isDeveloper ? (
                        <StatusBadge tone="info"><ShieldCheck size={12} /> مطوّر</StatusBadge>
                      ) : user.isActive ? (
                        <StatusBadge tone="ok" dot>نشط</StatusBadge>
                      ) : (
                        <StatusBadge tone="bad" dot>معطّل</StatusBadge>
                      )}
                    </td>
                    <td data-label="AI">{number(user.aiRequests)} <small className="dev-soft">{user.aiFailures ? `· ${user.aiFailures} فشل` : ''}</small></td>
                    <td data-label="الاختبارات">{number(user.testsCount)}</td>
                    <td data-label="الملخصات">{number(user.summariesCount)}</td>
                    <td data-label="الأداة الأكثر">{user.topTool ? toolLabels[user.topTool] ?? user.topTool : '—'}</td>
                    <td>
                      <div className="dev-row-actions">
                        <button type="button" className="dev-btn dev-btn-tiny" onClick={() => navigate(`/developer/users/${user.id}`)}>
                          التفاصيل
                        </button>
                        {!user.isDeveloper && (
                          <button
                            type="button"
                            className={`dev-btn dev-btn-tiny ${user.isActive ? 'dev-btn-danger' : 'dev-btn-soft'}`}
                            disabled={busy === user.id}
                            onClick={() => void toggleActive(user.id, !user.isActive)}
                          >
                            {user.isActive ? <UserX size={13} /> : <UserCheck size={13} />}
                            {user.isActive ? 'تعطيل' : 'تفعيل'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pages={data.pages} total={data.total} onPage={(next) => void load(next)} />
        </Panel>
      )}
    </div>
  );
}
