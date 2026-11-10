import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, Field, FullPageLoader, PageHeader, StatTile, SubmitButton } from '../components/ui.tsx';
import { api, ApiError, formatBytes, formatDate, formatDateTime } from '../lib/api.ts';
import type { AdminLog, AdminOverview, AdminSubject, AdminUser, AiUsage, Feature } from '../lib/types.ts';

type Tab = 'overview' | 'users' | 'subjects' | 'features' | 'ai' | 'logs';

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'نظرة عامة' },
  { key: 'users', label: 'المستخدمون' },
  { key: 'subjects', label: 'المواد والمناهج' },
  { key: 'features', label: 'الميزات' },
  { key: 'ai', label: 'استهلاك الذكاء الاصطناعي' },
  { key: 'logs', label: 'سجل النشاطات' },
];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <AppShell>
      <PageHeader
        eyebrow="مشرف"
        title="لوحة الإدارة"
        subtitle="الصلاحيات تُتحقق في الخادم: الطالب العادي لا يستطيع الوصول إلى هذه البيانات."
      />

      <div className="segment max-w-full overflow-x-auto" role="tablist" aria-label="أقسام لوحة الإدارة">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className="segment-btn whitespace-nowrap"
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {tab === 'overview' && <OverviewTab onError={setError} />}
      {tab === 'users' && <UsersTab onError={setError} onNotice={setNotice} />}
      {tab === 'subjects' && <SubjectsTab onError={setError} onNotice={setNotice} />}
      {tab === 'features' && <FeaturesTab onError={setError} onNotice={setNotice} />}
      {tab === 'ai' && <AiTab onError={setError} />}
      {tab === 'logs' && <LogsTab onError={setError} />}
    </AppShell>
  );
}

function OverviewTab({ onError }: { onError: (message: string) => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AdminOverview>('/admin/overview')
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((caught) => onError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الإحصائيات.'));
    return () => {
      cancelled = true;
    };
  }, [onError]);

  if (!data) return <FullPageLoader label="جار تحميل الإحصائيات…" />;

  const cards = [
    { label: 'إجمالي المستخدمين', value: String(data.counts.users) },
    { label: 'نشطون آخر 7 أيام', value: String(data.counts.active7d) },
    { label: 'المشرفون', value: String(data.counts.admins) },
    { label: 'الكتب المرفوعة', value: String(data.counts.books) },
    { label: 'الاختبارات', value: String(data.counts.tests) },
    { label: 'طلبات الذكاء الاصطناعي', value: String(data.counts.aiRequests) },
    { label: 'حجم التخزين', value: formatBytes(data.counts.storageBytes) },
    { label: 'تكلفة الذكاء الاصطناعي', value: `${data.counts.aiCostUsd.toFixed(2)} $` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {cards.map((card) => (
          <StatTile key={card.label} label={card.label} value={card.value} />
        ))}
      </div>

      <div className="card p-5">
        <h3 className="mb-2 text-base font-bold">تسجيلات جديدة (آخر 14 يومًا)</h3>
        {data.signups.length === 0 ? (
          <p className="muted text-sm">لا توجد بيانات بعد.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.signups.map((row) => (
              <li key={row.day} className="flex justify-between">
                <span className="muted">{row.day}</span>
                <span className="font-semibold">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-5">
        <h3 className="mb-2 text-base font-bold">إعدادات المنصة المحفوظة</h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {Object.entries(data.settings).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-2 rounded-[12px_9px_13px_8px] border-2 border-[var(--line-soft)] px-3 py-2">
              <dt className="muted" dir="ltr">
                {key}
              </dt>
              <dd dir="ltr">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="muted mt-3 text-xs">
          تُضبط قيم المزوّد والحدود من متغيرات بيئة الخادم حاليًا. واجهة تعديلها من لوحة المشرف ما زالت
          قيد البناء، مع إدارة الوحدات والدروس.
        </p>
      </div>
    </div>
  );
}

function UsersTab({
  onError,
  onNotice,
}: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(
    (search: string) => {
      api
        .get<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(search)}`)
        .then((payload) => setUsers(payload.users))
        .catch((caught) => onError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل المستخدمين.'));
    },
    [onError],
  );

  useEffect(() => {
    load('');
  }, [load]);

  async function update(id: number, body: { isActive?: boolean; role?: 'student' | 'admin' }) {
    if (busyId) return;
    setBusyId(id);
    try {
      await api.patch(`/admin/users/${id}`, body);
      load(query);
      onNotice('تم تحديث الحساب.');
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'تعذّر تحديث الحساب.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          load(query.trim());
        }}
      >
        <input
          className="input"
          placeholder="ابحث بالاسم أو البريد…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" className="btn btn-ghost shrink-0">
          بحث
        </button>
      </form>

      {!users ? (
        <FullPageLoader label="جار تحميل المستخدمين…" />
      ) : users.length === 0 ? (
        <p className="muted text-sm">لا نتائج.</p>
      ) : (
        <ul className="space-y-2">
          {users.map((user) => (
            <li key={user.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {user.username}{' '}
                    <span className="badge ms-1">{user.role === 'admin' ? 'مشرف' : 'طالب'}</span>
                    {!user.isActive && (
                      <span className="badge ms-1" style={{ color: 'var(--color-bad)', borderColor: 'var(--color-bad)' }}>
                        معطّل
                      </span>
                    )}
                  </p>
                  <p className="muted text-xs" dir="ltr">
                    {user.email}
                  </p>
                  <p className="muted mt-1 text-[11px]">
                    مسجّل {formatDate(user.createdAt)} • آخر نشاط{' '}
                    {user.lastActiveAt ? formatDateTime(user.lastActiveAt) : 'لم يسجل دخوله'}
                    {user.gradeName ? ` • ${user.gradeName}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost min-h-8 px-2.5 text-[11px]"
                    disabled={busyId === user.id}
                    onClick={() => void update(user.id, { isActive: !user.isActive })}
                  >
                    {user.isActive ? 'تعطيل' : 'تفعيل'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost min-h-8 px-2.5 text-[11px]"
                    disabled={busyId === user.id}
                    onClick={() => {
                      const next = user.role === 'admin' ? 'student' : 'admin';
                      if (
                        window.confirm(
                          next === 'admin'
                            ? `منح ${user.username} صلاحية مشرف كاملة؟`
                            : `سحب صلاحية المشرف من ${user.username}؟`,
                        )
                      ) {
                        void update(user.id, { role: next });
                      }
                    }}
                  >
                    {user.role === 'admin' ? 'سحب الإشراف' : 'منح الإشراف'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted text-xs">
        لا تُعرض كلمات المرور لأنها مخزَّنة كتشفير أحادي (scrypt) ولا يمكن استرجاعها.
      </p>
    </div>
  );
}

function SubjectsTab({
  onError,
  onNotice,
}: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [subjects, setSubjects] = useState<AdminSubject[] | null>(null);
  const [form, setForm] = useState({ name: '', code: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ subjects: AdminSubject[] }>('/admin/subjects')
      .then((payload) => setSubjects(payload.subjects))
      .catch((caught) => onError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل المواد.'));
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  async function addSubject() {
    if (busy || !form.name.trim() || !form.code.trim()) return;
    setBusy(true);
    try {
      const curriculumId = subjects?.[0]?.curriculumId;
      if (!curriculumId) throw new ApiError(400, 'لا يوجد منهاج لتعريف المادة عليه.');
      await api.post('/admin/subjects', {
        name: form.name.trim(),
        code: form.code.trim(),
        curriculumId,
      });
      setForm({ name: '', code: '' });
      load();
      onNotice('تمت إضافة المادة.');
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'تعذّر إضافة المادة.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(subject: AdminSubject) {
    try {
      await api.patch(`/admin/subjects/${subject.id}`, { isActive: !subject.isActive });
      load();
      onNotice(subject.isActive ? 'تم تعطيل المادة.' : 'تم تفعيل المادة.');
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'تعذّر تحديث المادة.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="mb-3 text-base font-bold">إضافة مادة</h3>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
          <Field label="اسم المادة" htmlFor="subjectName">
            <input
              id="subjectName"
              className="input"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="مثال: الرياضيات"
            />
          </Field>
          <Field label="الرمز" htmlFor="subjectCode">
            <input
              id="subjectCode"
              className="input"
              value={form.code}
              onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
              placeholder="MATH"
              dir="ltr"
            />
          </Field>
          <SubmitButton
            type="button"
            busy={busy}
            onClick={() => void addSubject()}
            className="btn btn-primary sm:w-32"
          >
            إضافة
          </SubmitButton>
        </div>
        <p className="muted mt-2 text-xs">
          تُضاف المادة إلى أول منهاج نشط. إدارة المناهج المتعددة والوحدات والدروس ما زالت قيد البناء.
        </p>
      </div>

      {!subjects ? (
        <FullPageLoader label="جار تحميل المواد…" />
      ) : (
        <ul className="space-y-2">
          {subjects.map((subject) => (
            <li key={subject.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">
                  {subject.name} <span className="badge ms-1">{subject.code}</span>
                  {!subject.isActive && (
                    <span className="badge ms-1" style={{ color: 'var(--color-bad)', borderColor: 'var(--color-bad)' }}>
                      معطّلة
                    </span>
                  )}
                </p>
                <p className="muted text-xs">
                  {subject.curriculumName} • الوحدات: {subject.unitsCount}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost min-h-8 px-2.5 text-[11px]"
                onClick={() => void toggle(subject)}
              >
                {subject.isActive ? 'تعطيل' : 'تفعيل'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FeaturesTab({
  onError,
  onNotice,
}: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [features, setFeatures] = useState<Feature[] | null>(null);

  const load = useCallback(() => {
    api
      .get<{ features: Feature[] }>('/admin/features')
      .then((payload) => setFeatures(payload.features))
      .catch((caught) => onError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الميزات.'));
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(feature: Feature) {
    try {
      await api.patch(`/admin/features/${feature.key}`, { enabled: !feature.enabled });
      load();
      onNotice('تم تحديث حالة الميزة.');
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'تعذّر تحديث الميزة.');
    }
  }

  if (!features) return <FullPageLoader label="جار تحميل الميزات…" />;

  return (
    <ul className="space-y-2">
      {features.map((feature) => (
        <li key={feature.key} className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-semibold">
              {feature.title} <span className="badge ms-1">المرحلة {feature.phase}</span>
            </p>
            <p className="muted text-xs">{feature.description}</p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-brand-600)]"
              checked={feature.enabled}
              onChange={() => void toggle(feature)}
            />
            مفعّلة
          </label>
        </li>
      ))}
      <p className="muted text-xs">
        تنبيه: تفعيل ميزة لا تُبنَ واجهتها بعد يجعلها تظهر كمتاحة دون شاشة تعمل؛ لذلك تُترك مغلقة حتى تكتمل
        مرحلتها.
      </p>
    </ul>
  );
}

function AiTab({ onError }: { onError: (message: string) => void }) {
  const [data, setData] = useState<AiUsage | null>(null);

  useEffect(() => {
    api
      .get<AiUsage>('/admin/ai-usage')
      .then(setData)
      .catch((caught) => onError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الاستهلاك.'));
  }, [onError]);

  if (!data) return <FullPageLoader label="جار تحميل بيانات الاستهلاك…" />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="عدد الطلبات" value={data.totals.requests} tint="blue" />
        <StatTile label="إجمالي الرموز" value={data.totals.tokens} tint="lavender" />
        <StatTile label="التكلفة التقديرية" value={`${data.totals.costUsd.toFixed(3)} $`} tint="mint" />
      </div>

      {data.logs.length === 0 ? (
        <div className="card p-5 text-sm">
          <p className="font-semibold">لا توجد طلبات ذكاء اصطناعي مسجلة.</p>
          <p className="muted mt-1">
            تُسجَّل هنا كل عملية ذكاء اصطناعي ناجحة أو فاشلة: المستخدم، النوع، النموذج، الرموز، التكلفة،
            والحالة. استخدم الأداة أو الملخص أو الاختبار ليظهر أول سجل.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {data.logs.map((log) => (
            <li key={log.id} className="card p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">
                  {log.task} • {log.model ?? '—'}
                </span>
                <span className="muted text-xs">{formatDateTime(log.createdAt)}</span>
              </div>
              <p className="muted mt-1 text-xs">
                {log.username ?? 'مستخدم محذوف'} • {log.tokensIn}/{log.tokensOut} رمز •{' '}
                {log.costUsd.toFixed(4)} $ • {log.status}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LogsTab({ onError }: { onError: (message: string) => void }) {
  const [logs, setLogs] = useState<AdminLog[] | null>(null);

  useEffect(() => {
    api
      .get<{ logs: AdminLog[] }>('/admin/logs')
      .then((payload) => setLogs(payload.logs))
      .catch((caught) => onError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل السجل.'));
  }, [onError]);

  if (!logs) return <FullPageLoader label="جار تحميل السجل…" />;

  if (logs.length === 0) {
    return (
      <div className="card p-5 text-sm">
        <p className="font-semibold">لا توجد إجراءات إدارية مسجلة بعد.</p>
        <p className="muted mt-1">
          تُسجَّل هنا العمليات الحساسة (تعطيل حساب، تغيير صلاحية، تعديل مادة، تفعيل/تعطيل ميزة) مع وقتها
          والمشرف المسؤول.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {logs.map((log) => (
        <li key={log.id} className="card p-3.5 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="font-semibold">{log.action}</span>
            <span className="muted text-xs">{formatDateTime(log.createdAt)}</span>
          </div>
          <p className="muted mt-1 text-xs">
            {log.adminName ?? 'مشرف محذوف'} • {log.detail ?? ''} {log.target ? `(${log.target})` : ''}
          </p>
        </li>
      ))}
    </ul>
  );
}
