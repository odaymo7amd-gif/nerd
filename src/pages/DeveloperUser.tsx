import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  Bot,
  MessageSquareWarning,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react';
import { DeveloperLayout, type DeveloperTab } from '../components/developer/DeveloperLayout.tsx';
import { UsageBars } from '../components/developer/Charts.tsx';
import {
  DevError,
  DevHeader,
  EmptyBlock,
  Kpi,
  LoadingBlock,
  Panel,
  StatusBadge,
} from '../components/developer/ui.tsx';
import { api, ApiError, formatDateTime, formatMinutes } from '../lib/api.ts';
import type { DeveloperContext, DeveloperUserDetail, RangeKey } from '../lib/developerTypes.ts';
import { money, number } from '../components/developer/format.ts';
import '../developer.css';

export default function DeveloperUserPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [context, setContext] = useState<DeveloperContext | null>(null);
  const [data, setData] = useState<DeveloperUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadContext = useCallback(async () => {
    try {
      setContext(await api.get<DeveloperContext>('/developer/context'));
    } catch {
      // يعرض طلب التفاصيل الخطأ الأهم.
    }
  }, []);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .get<DeveloperUserDetail>(`/developer/users/${id}`)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل المستخدم.');
      });
    return () => {
      cancelled = true;
    };
  }, [id, refreshKey]);

  const goTab = (tab: DeveloperTab) => navigate(tab === 'overview' ? '/developer' : `/developer?tab=${tab}`);

  async function toggleActive() {
    if (!data || busy) return;
    const next = !data.user.isActive;
    if (!window.confirm(next ? 'تعطيل هذا الحساب وإلغاء جلساته؟' : 'إعادة تفعيل هذا الحساب؟')) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/developer/users/${data.user.id}`, { isActive: next });
      setNotice(next ? 'تم تفعيل الحساب.' : 'تم تعطيل الحساب وإلغاء جلساته.');
      setRefreshKey((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحديث الحساب.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!data || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/developer/users/${data.user.id}`, { confirmation: 'DELETE', username: confirmName });
      navigate('/developer?tab=users', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حذف الحساب.');
      setBusy(false);
    }
  }

  return (
    <DeveloperLayout
      active="user"
      context={context}
      range={'30d' as RangeKey}
      onRange={() => undefined}
      onTab={goTab}
      onRefresh={() => setRefreshKey((value) => value + 1)}
    >
      {error && <DevError>{error}</DevError>}
      {notice && <div className="dev-success">{notice}</div>}
      {!data && !error ? (
        <LoadingBlock label="جار تحميل ملف المستخدم…" />
      ) : data ? (
        <div className="dev-stack">
          <DevHeader
            eyebrow={`الحساب #${data.user.id}`}
            title={data.user.username}
            subtitle={`${data.user.email} · ${data.user.countryName ?? 'دولة غير محددة'} · ${data.user.gradeName ?? 'صف غير محدد'}`}
            actions={
              <>
                {!data.user.isDeveloper && (
                  <button
                    type="button"
                    className={`dev-btn ${data.user.isActive ? 'dev-btn-danger' : 'dev-btn-primary'}`}
                    disabled={busy}
                    onClick={() => void toggleActive()}
                  >
                    {data.user.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                    {data.user.isActive ? 'تعطيل الحساب' : 'إعادة التفعيل'}
                  </button>
                )}
              </>
            }
          />

          <div className="dev-profile-strip">
            <span className="dev-avatar-lg">{data.user.username.slice(0, 2).toUpperCase()}</span>
            <div>
              <div className="dev-inline-badges">
                {data.user.isDeveloper ? <StatusBadge tone="info"><ShieldAlert size={12} /> مطوّر رئيسي</StatusBadge> : null}
                <StatusBadge tone={data.user.isActive ? 'ok' : 'bad'} dot>{data.user.isActive ? 'نشط' : 'معطّل'}</StatusBadge>
                <StatusBadge tone={data.user.onboarded ? 'info' : 'muted'}>{data.user.onboarded ? 'أكمل الإعداد' : 'لم يكمل الإعداد'}</StatusBadge>
              </div>
              <p>مسجّل {formatDateTime(data.user.createdAt)} · آخر ظهور {data.user.lastActiveAt ? formatDateTime(data.user.lastActiveAt) : 'لم يسجل'}</p>
            </div>
            <div className="dev-profile-sessions">
              <small>جلسات نشطة</small>
              <strong>{number(data.counts.sessions)}</strong>
            </div>
          </div>

          <div className="dev-kpi-grid dev-kpi-grid-5">
            <Kpi label="ساعات الدراسة" value={formatMinutes(data.stats.studyMinutes)} tone="blue" />
            <Kpi label="اختبارات مكتملة" value={number(data.stats.testsCompleted)} tone="mint" />
            <Kpi label="النقاط" value={number(data.stats.points)} tone="yellow" />
            <Kpi label="طلبات AI" value={number(data.ai.requests)} hint={`${number(data.ai.failed)} فشل`} tone="lavender" />
            <Kpi label="الرموز" value={number(data.ai.tokensIn + data.ai.tokensOut)} hint={money(data.ai.costUsd)} tone="pink" />
          </div>

          <div className="dev-grid-2">
            <Panel title="محتوى الحساب" subtitle="عدد السجلات المرتبطة، بلا نصوص المحتوى">
              <dl className="dev-definition-list">
                <div><dt>عناصر المحتوى</dt><dd>{number(data.counts.contents)}</dd></div>
                <div><dt>الكتب المرفوعة</dt><dd>{number(data.counts.books)}</dd></div>
                <div><dt>الاختبارات</dt><dd>{number(data.counts.tests)}</dd></div>
                <div><dt>الملخصات</dt><dd>{number(data.counts.summaries)}</dd></div>
                <div><dt>المحادثات</dt><dd>{number(data.counts.conversations)}</dd></div>
                <div><dt>البلاغات</dt><dd>{number(data.counts.feedback)}</dd></div>
              </dl>
            </Panel>
            <Panel title="أكثر أدواته استخدامًا" subtitle="من أحداث النشاط وسجلات AI">
              <UsageBars
                items={data.topTools.map((tool, index) => ({
                  label: tool.title,
                  value: tool.uses,
                  share: tool.share,
                  tone: ['#6ba8ff', '#8ed6a0', '#f4a6b9', '#d8b4fe', '#ffd83d'][index % 5],
                }))}
              />
            </Panel>
          </div>

          <div className="dev-grid-2">
            <Panel title="النشاط الأخير" subtitle="أحدث 10 أحداث، ضمن حدود الخصوصية">
              {data.activity.length === 0 ? (
                <EmptyBlock title="لا نشاط" icon={<Activity size={21} />} />
              ) : (
                <ul className="dev-feed">
                  {data.activity.slice(0, 10).map((item) => (
                    <li key={item.id}>
                      <span className="dev-feed-dot" />
                      <div className="min-w-0 flex-1">
                        <strong>{item.title}</strong>
                        <p>{item.detail ?? '—'}</p>
                        <small>{item.kind} · {formatDateTime(item.createdAt)}</small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="استهلاك AI الأخير" subtitle="أحدث 8 طلبات، دون محتوى المحادثات">
              {data.aiLogs.length === 0 ? (
                <EmptyBlock title="لا طلبات AI" icon={<Bot size={21} />} />
              ) : (
                <ul className="dev-feed">
                  {data.aiLogs.slice(0, 8).map((log) => (
                    <li key={log.id}>
                      <span className={`dev-feed-dot ${log.status === 'failed' ? 'is-bad' : ''}`} />
                      <div className="min-w-0 flex-1">
                        <strong dir="ltr">{log.task} · {log.model ?? '—'}</strong>
                        <p>{log.provider ?? '—'} · {number(log.tokensIn + log.tokensOut)} رمز · {money(log.costUsd)}</p>
                        <small>{log.status === 'success' ? 'ناجح' : 'فاشل'} · {formatDateTime(log.createdAt)}</small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {data.feedback.length > 0 && (
            <Panel title="بلاغات المستخدم" subtitle="آخر 8 بلاغات" action={<MessageSquareWarning size={18} />}>
              <ul className="dev-backup-list">
                {data.feedback.map((report) => (
                  <li key={report.id}>
                    <span>{report.title}</span>
                    <small>{report.category} · {report.status} · {formatDateTime(report.createdAt)}</small>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {!data.user.isDeveloper && (
            <Panel title="منطقة الحذف النهائي" subtitle="لا يمكن التراجع، وتُحذف السجلات والملفات المرتبطة">
              {!deleteOpen ? (
                <button type="button" className="dev-btn dev-btn-danger" onClick={() => setDeleteOpen(true)}>
                  <Trash2 size={15} /> حذف الحساب نهائيًا
                </button>
              ) : (
                <div className="dev-danger-zone">
                  <p>
                    لحذف <strong>{data.user.username}</strong>، اكتب اسم المستخدم في الحقل ثم اضغط تأكيد. سيُحذف
                    الحساب وكل ما يرتبط به من محتوى وملفات، ويبقى سجل إداري بالمعرّف فقط.
                  </p>
                  <input
                    value={confirmName}
                    onChange={(event) => setConfirmName(event.target.value)}
                    placeholder={data.user.username}
                    aria-label="تأكيد اسم المستخدم"
                  />
                  <div className="dev-form-actions">
                    <button type="button" className="dev-btn dev-btn-ghost" onClick={() => { setDeleteOpen(false); setConfirmName(''); }}>
                      إلغاء
                    </button>
                    <button
                      type="button"
                      className="dev-btn dev-btn-danger"
                      disabled={busy || confirmName !== data.user.username}
                      onClick={() => void remove()}
                    >
                      <Trash2 size={15} /> {busy ? 'جار الحذف…' : 'تأكيد الحذف النهائي'}
                    </button>
                  </div>
                </div>
              )}
            </Panel>
          )}
        </div>
      ) : null}
    </DeveloperLayout>
  );
}
