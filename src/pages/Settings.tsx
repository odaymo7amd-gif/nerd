import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Check, Info, LifeBuoy, LockKeyhole, LogOut, Moon, Palette, ShieldAlert, ShieldCheck, Sun } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, Field, PageHeader, SubmitButton } from '../components/ui.tsx';
import { AiSettingsSection } from '../components/AiSettingsSection.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';

export default function SettingsPage() {
  const { user, setUser, theme, setTheme, logout } = useSession();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState(user?.notificationsEnabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function toggleNotifications(value: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setNotifications(value);
    try {
      const data = await api.patch<{ user: NonNullable<typeof user> }>('/settings', {
        notificationsEnabled: value,
      });
      setUser(data.user);
      setNotice(value ? 'تم تفعيل الإشعارات.' : 'تم إيقاف الإشعارات.');
    } catch (caught) {
      setNotifications(!value);
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حفظ الإعداد.');
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwordBusy) return;
    setPasswordBusy(true);
    setPasswordError(null);
    setNotice(null);
    try {
      const response = await api.post<{ message: string }>('/auth/change-password', passwords);
      setNotice(response.message);
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (caught) {
      setPasswordError(caught instanceof ApiError ? caught.message : 'تعذّر تغيير كلمة المرور.');
    } finally {
      setPasswordBusy(false);
    }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault();
    if (deleteBusy) return;
    if (!window.confirm('سيتم حذف حسابك وكل بياناتك نهائيًا. هل أنت متأكد؟')) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.del('/account', { password: deletePassword });
      setUser(null);
      navigate('/login', { replace: true });
    } catch (caught) {
      setDeleteError(caught instanceof ApiError ? caught.message : 'تعذّر حذف الحساب.');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="حسابك"
        title="الإعدادات"
        subtitle="مفتاح الذكاء الاصطناعي، المظهر، الإشعارات، والأمان — كل شيء في مكان واحد."
      />

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="section-icon">
            <Palette size={17} />
          </span>
          <h2 className="text-lg font-bold">المظهر</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void setTheme('light')}
            aria-pressed={theme === 'light'}
            className="theme-choice"
          >
            <span className="theme-preview" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">ورق كريمي</span>
              <span className="muted block text-[11px]">الوضع النهاري الافتراضي</span>
            </span>
            {theme === 'light' && <Check size={17} className="shrink-0 text-[var(--accent)]" />}
          </button>
          <button
            type="button"
            onClick={() => void setTheme('dark')}
            aria-pressed={theme === 'dark'}
            className="theme-choice"
          >
            <span className="theme-preview is-dark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">سبورة داكنة</span>
              <span className="muted block text-[11px]">أسهل على العين ليلًا</span>
            </span>
            {theme === 'dark' && <Check size={17} className="shrink-0 text-[var(--accent)]" />}
          </button>
        </div>
        <p className="muted mt-2 flex items-center gap-1.5 text-xs">
          {theme === 'dark' ? <Moon size={13} /> : <Sun size={13} />}
          يُحفظ اختيارك في حسابك ويُطبَّق تلقائيًا عند الدخول من أي جهاز.
        </p>
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="section-icon">
            <Bell size={17} />
          </span>
          <h2 className="text-lg font-bold">الإشعارات</h2>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-[14px_10px_16px_9px] border-2 border-[var(--line)] bg-[var(--surface-solid)] px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">إشعارات الدراسة والمهام</p>
            <p className="muted text-[11px]">تنبيهات داخل التطبيق عند اكتمال الكتب والملخصات.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={notifications}
            aria-label="تفعيل إشعارات الدراسة والمهام"
            data-on={notifications}
            disabled={busy}
            className="switch disabled:opacity-50"
            onClick={() => void toggleNotifications(!notifications)}
          />
        </div>
        <p className="muted mt-2 text-xs">
          تُحفظ الإشعارات داخل التطبيق. إشعارات النظام على الهاتف تُضاف مع نسخة Android في المرحلة السابعة.
        </p>
      </section>

      <AiSettingsSection />

      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="section-icon">
            <LockKeyhole size={17} />
          </span>
          <h2 className="text-lg font-bold">تغيير كلمة المرور</h2>
        </div>
        {passwordError && <Alert>{passwordError}</Alert>}
        <form onSubmit={changePassword} className="mt-3 space-y-3">
          <Field label="كلمة المرور الحالية" htmlFor="currentPassword">
            <input
              id="currentPassword"
              type="password"
              className="input"
              value={passwords.currentPassword}
              onChange={(event) =>
                setPasswords((current) => ({ ...current, currentPassword: event.target.value }))
              }
              autoComplete="current-password"
              required
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="كلمة المرور الجديدة" htmlFor="newPassword">
              <input
                id="newPassword"
                type="password"
                className="input"
                value={passwords.newPassword}
                onChange={(event) =>
                  setPasswords((current) => ({ ...current, newPassword: event.target.value }))
                }
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="تأكيد كلمة المرور" htmlFor="confirmPassword">
              <input
                id="confirmPassword"
                type="password"
                className="input"
                value={passwords.confirmPassword}
                onChange={(event) =>
                  setPasswords((current) => ({ ...current, confirmPassword: event.target.value }))
                }
                autoComplete="new-password"
                required
              />
            </Field>
          </div>
          <SubmitButton busy={passwordBusy} className="btn btn-primary sm:w-48">
            {passwordBusy ? 'جار التحديث…' : 'تحديث كلمة المرور'}
          </SubmitButton>
        </form>
      </section>

      <section className="card p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="section-icon">
            <ShieldCheck size={17} />
          </span>
          <h2 className="text-lg font-bold">الخصوصية والحساب</h2>
        </div>
        <p className="muted mb-3 text-sm">
          بياناتك (الكتب، الملخصات، الاختبارات) مرتبطة بحسابك فقط، ولا يستطيع طالب آخر الوصول إليها. لا
          يطّلع المشرف على كلمات المرور المخزَّنة لأنها مشفّرة أحاديًا.
        </p>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
          className="btn btn-ghost"
        >
          <LogOut size={16} />
          تسجيل الخروج
        </button>

        <details className="danger-zone mt-4 rounded-[15px_11px_17px_10px] border-2 px-3.5 py-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--color-bad)]">
            <ShieldAlert size={15} />
            حذف الحساب نهائيًا
          </summary>
          <p className="muted mt-2 text-xs">
            يُحذف الحساب مع كل البيانات المرتبطة به (الكتب، الملخصات، الأسئلة، الاختبارات، الجدول). لا يمكن
            التراجع عن هذه العملية.
          </p>
          {deleteError && (
            <div className="mt-2">
              <Alert>{deleteError}</Alert>
            </div>
          )}
          <form onSubmit={deleteAccount} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="أدخل كلمة المرور للتأكيد" htmlFor="deletePassword">
                <input
                  id="deletePassword"
                  type="password"
                  className="input"
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                  required
                />
              </Field>
            </div>
            <SubmitButton busy={deleteBusy} className="btn btn-ghost sm:w-40" disabled={!deletePassword}>
              {deleteBusy ? 'جار الحذف…' : 'حذف الحساب'}
            </SubmitButton>
          </form>
        </details>
      </section>

      <section className="card p-5 text-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className="section-icon">
            <Info size={17} />
          </span>
          <h2 className="text-lg font-bold">معلومات التطبيق</h2>
        </div>
        <dl className="space-y-1.5">
          <div className="flex justify-between gap-3 rounded-[12px_9px_13px_8px] border-2 border-[var(--line-soft)] px-3 py-2">
            <dt className="muted">التطبيق</dt>
            <dd className="font-semibold">NERD – نيرد</dd>
          </div>
          <div className="flex justify-between gap-3 rounded-[12px_9px_13px_8px] border-2 border-[var(--line-soft)] px-3 py-2">
            <dt className="muted">الإصدار</dt>
            <dd dir="ltr" className="font-semibold">0.7.0</dd>
          </div>
          <div className="flex justify-between gap-3 rounded-[12px_9px_13px_8px] border-2 border-[var(--line-soft)] px-3 py-2">
            <dt className="muted">اللغة</dt>
            <dd className="font-semibold">العربية (RTL)</dd>
          </div>
          <div className="flex justify-between gap-3 rounded-[12px_9px_13px_8px] border-2 border-[var(--line-soft)] px-3 py-2">
            <dt className="muted">قاعدة البيانات</dt>
            <dd className="font-semibold">SQLite على الخادم</dd>
          </div>
        </dl>
        <p className="muted mt-3 text-xs leading-6">
          اقرأ{' '}
          <Link to="/privacy" className="underline">
            سياسة الخصوصية
          </Link>{' '}
          و{' '}
          <Link to="/terms" className="underline">
            شروط الاستخدام
          </Link>
          . مفتاح الذكاء الاصطناعي يبقى في متصفح هذا الجهاز ولا يُحفظ على الخادم.
        </p>
        <Link to="/feedback" className="btn btn-soft mt-3">
          <LifeBuoy size={16} /> الشكاوى والاقتراحات
        </Link>
      </section>
    </AppShell>
  );
}
