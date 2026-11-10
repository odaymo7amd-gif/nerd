import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout.tsx';
import { Alert, Field, SubmitButton } from '../components/ui.tsx';
import { useSession } from '../lib/session.tsx';
import { ApiError } from '../lib/api.ts';

export default function LoginPage() {
  const { login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password, remember);
      navigate(from, { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تسجيل الدخول.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="تسجيل الدخول"
      subtitle="أدخل بيانات حسابك للمتابعة إلى نيرد."
      footer={
        <p className="muted">
          ليس لديك حساب؟{' '}
          <Link to="/register" className="font-semibold text-[var(--accent)]">
            أنشئ حسابًا جديدًا
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="البريد الإلكتروني" htmlFor="email">
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="student@example.com"
            autoComplete="email"
            dir="ltr"
            required
          />
        </Field>
        <Field label="كلمة المرور" htmlFor="password">
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </Field>
        <div className="flex items-center justify-between gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="size-4 accent-[var(--color-brand-600)]"
            />
            <span>تذكر تسجيل الدخول</span>
          </label>
          <Link to="/forgot-password" className="text-[var(--accent)]">
            نسيت كلمة المرور؟
          </Link>
        </div>
        <SubmitButton busy={busy}>{busy ? 'جار تسجيل الدخول…' : 'تسجيل الدخول'}</SubmitButton>
      </form>
    </AuthLayout>
  );
}
