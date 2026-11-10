import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, LifeBuoy, Mail, MapPin, School, Settings, ShieldCheck } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, Field, FullPageLoader, PageHeader, StatTile, SubmitButton } from '../components/ui.tsx';
import { api, ApiError, formatDate, formatMinutes } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import type { ProfilePayload } from '../lib/types.ts';

export default function ProfilePage() {
  const { setUser } = useSession();
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ProfilePayload>('/profile')
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setUsername(payload.user.username);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الملف الشخصي.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveUsername(event: FormEvent) {
    event.preventDefault();
    if (busy || !data) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await api.patch<ProfilePayload>('/profile', { username: username.trim() });
      setData(payload);
      setUser(payload.user);
      setNotice('تم تحديث اسم المستخدم.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حفظ التعديل.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <AppShell>
        {error ? <Alert>{error}</Alert> : <FullPageLoader label="جار تحميل الملف…" />}
      </AppShell>
    );
  }

  const initials = data.user.username.slice(0, 2).toUpperCase();
  const { stats, counts, curriculum } = data;

  return (
    <AppShell>
      <PageHeader
        eyebrow="ملفك"
        title="حسابي"
        subtitle="بياناتك الدراسية وإحصائياتك في مكان واحد."
      />

      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid size-16 place-items-center rounded-[18px_13px_20px_12px] border-[2.5px] border-[var(--line)] bg-[var(--yellow)] text-xl font-extrabold text-[#25251f] shadow-[3px_3px_0_var(--shadow-color)]">
            {initials}
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold">{data.user.username}</h2>
            <p className="muted flex items-center gap-1.5 text-sm" dir="ltr">
              <Mail size={14} />
              {data.user.email}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="badge">
                <ShieldCheck size={12} />
                {data.user.isDeveloper ? 'مطوّر' : 'طالب'}
              </span>
              <span className="badge">عضو منذ {formatDate(data.user.createdAt)}</span>
              {!data.user.onboarded && <span className="badge">لم يكتمل إعداد الحساب</span>}
            </div>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <InfoRow icon={<MapPin size={15} />} label="الدولة" value={curriculum.countryName} />
          <InfoRow icon={<School size={15} />} label="المنهاج" value={curriculum.curriculumName} />
          <InfoRow icon={<School size={15} />} label="الصف الدراسي" value={curriculum.gradeName} />
          <InfoRow icon={<School size={15} />} label="الفصل الدراسي" value={curriculum.semesterName} />
        </dl>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Link to="/onboarding" className="btn btn-ghost w-full sm:w-auto">
            تعديل البيانات الدراسية
          </Link>
          <Link to="/settings" className="btn btn-soft w-full sm:w-auto">
            <Settings size={16} /> الإعدادات ومفتاح الذكاء الاصطناعي
          </Link>
          <Link to="/feedback" className="btn btn-ghost w-full sm:w-auto">
            <LifeBuoy size={16} /> الشكاوى والاقتراحات
          </Link>
        </div>
      </section>

      {data.user.isDeveloper && (
        <section className="card overflow-hidden p-0">
          <Link
            to="/developer"
            className="flex items-center gap-3 bg-[color-mix(in_srgb,var(--purple-soft)_62%,var(--surface))] px-4 py-3.5 transition hover:bg-[var(--surface-hover)]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-[13px] border-2 border-[var(--line)] bg-[var(--surface)] text-[var(--accent)] shadow-[2px_2px_0_var(--shadow-color)]">
              <ShieldCheck size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-sm">لوحة المطوّر</strong>
              <small className="muted block text-[11px] leading-5">
                إدارة المستخدمين والأدوات والذكاء الاصطناعي والإشعارات
              </small>
            </span>
            <ArrowLeft size={17} className="shrink-0 text-[var(--accent)]" />
          </Link>
        </section>
      )}

      <section className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <StatTile tint="blue" label="ساعات الدراسة" value={formatMinutes(stats.studyMinutes)} />
        <StatTile tint="mint" label="اختبارات مكتملة" value={String(stats.testsCompleted)} />
        <StatTile tint="lavender" label="أسئلة محفوظة" value={String(counts.questions)} />
        <StatTile tint="yellow" label="نقاطك" value={String(stats.points)} />
      </section>

      <section className="card p-5">
        <h3 className="mb-3 text-lg font-bold">المواد التي تدرسها</h3>
        {data.subjects.length === 0 ? (
          <p className="muted text-sm">
            لم تحدد موادًا بعد.{' '}
            <Link to="/onboarding" className="text-[var(--accent)]">
              اختر موادك
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.subjects.map((subject) => (
              <span key={subject.id} className="badge">
                {subject.name}
              </span>
            ))}
          </div>
        )}

        <div className="mt-5 grid gap-3 border-t border-[var(--border)] pt-4 text-sm sm:grid-cols-4">
          <p>
            <span className="muted">محتواي الدراسي: </span>
            {counts.contents}
          </p>
          <p>
            <span className="muted">الكتب المرفوعة: </span>
            {counts.books}
          </p>
          <p>
            <span className="muted">الملخصات: </span>
            {counts.summaries}
          </p>
          <p>
            <span className="muted">الاختبارات: </span>
            {counts.tests}
          </p>
        </div>
      </section>

      <section className="card p-5">
        <h3 className="mb-3 text-lg font-bold">تعديل اسم المستخدم</h3>
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        <form onSubmit={saveUsername} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="اسم المستخدم" htmlFor="username">
              <input
                id="username"
                className="input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                minLength={3}
                maxLength={40}
                required
              />
            </Field>
          </div>
          <SubmitButton busy={busy} className="btn btn-primary sm:w-40">
            {busy ? 'جار الحفظ…' : 'حفظ'}
          </SubmitButton>
        </form>
        <p className="muted mt-3 text-xs">
          البريد الإلكتروني لا يمكن تغييره من هنا حاليًا؛ يلزم تأكيد ملكية البريد الجديد قبل التغيير.
        </p>
      </section>
    </AppShell>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string | null }) {
  return (
    <div className="rounded-[12px_9px_13px_8px] border-2 border-[var(--line-soft)] bg-[var(--surface-hover)] px-3 py-2.5">
      <dt className="muted flex items-center gap-1.5 text-[11px]">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold">{value ?? 'غير محدد'}</dd>
    </div>
  );
}
