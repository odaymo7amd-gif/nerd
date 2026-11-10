import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout.tsx';
import { Alert, Field, SubmitButton } from '../components/ui.tsx';
import { useSession } from '../lib/session.tsx';
import { ApiError } from '../lib/api.ts';

export default function RegisterPage() {
  const { register } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (form.password !== form.confirmPassword) {
      setError('كلمة المرور وتأكيدها غير متطابقين.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        confirmPassword: form.confirmPassword,
      });
      navigate('/onboarding', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إنشاء الحساب.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="إنشاء حساب جديد"
      subtitle="حساب واحد لكل الطالب، بياناتك وملفاتك خاصة بك."
      footer={
        <p className="muted">
          لديك حساب؟{' '}
          <Link to="/login" className="font-semibold text-[var(--accent)]">
            تسجيل الدخول
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="اسم المستخدم" htmlFor="username">
          <input
            id="username"
            className="input"
            value={form.username}
            onChange={(event) => update('username', event.target.value)}
            placeholder="مثال: أحمد"
            autoComplete="nickname"
            required
          />
        </Field>
        <Field label="البريد الإلكتروني" htmlFor="email">
          <input
            id="email"
            type="email"
            className="input"
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            placeholder="student@example.com"
            autoComplete="email"
            dir="ltr"
            required
          />
        </Field>
        <Field label="كلمة المرور" htmlFor="password" hint="8 أحرف على الأقل، وتحتوي حروفًا وأرقامًا.">
          <input
            id="password"
            type="password"
            className="input"
            value={form.password}
            onChange={(event) => update('password', event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        <Field label="تأكيد كلمة المرور" htmlFor="confirmPassword">
          <input
            id="confirmPassword"
            type="password"
            className="input"
            value={form.confirmPassword}
            onChange={(event) => update('confirmPassword', event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        <SubmitButton busy={busy}>{busy ? 'جار إنشاء الحساب…' : 'إنشاء الحساب'}</SubmitButton>
      </form>
    </AuthLayout>
  );
}
