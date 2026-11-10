import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout.tsx';
import { Alert, Field, SubmitButton } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirmPassword) {
      setError('كلمة المرور وتأكيدها غير متطابقين.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ message: string }>('/auth/reset-password', {
        token,
        password,
        confirmPassword,
      });
      setDone(response.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تعيين كلمة المرور.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="رابط غير صحيح" subtitle="الرابط المستخدم لا يحتوي رمز إعادة تعيين صالحًا.">
        <Alert>اطلب رابطًا جديدًا من صفحة استعادة كلمة المرور.</Alert>
        <Link to="/forgot-password" className="btn btn-primary mt-4 w-full">
          طلب رابط جديد
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="تعيين كلمة مرور جديدة"
      subtitle="اختر كلمة مرور قوية لم تستخدمها في مواقع أخرى."
      footer={
        <p className="muted">
          <Link to="/login" className="font-semibold text-[var(--accent)]">
            العودة إلى تسجيل الدخول
          </Link>
        </p>
      }
    >
      {done ? (
        <div className="space-y-4">
          <Alert tone="success">{done}</Alert>
          <Link to="/login" className="btn btn-primary w-full">
            تسجيل الدخول
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="كلمة المرور الجديدة" htmlFor="password" hint="8 أحرف على الأقل، وتحتوي حروفًا وأرقامًا.">
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="تأكيد كلمة المرور" htmlFor="confirmPassword">
            <input
              id="confirmPassword"
              type="password"
              className="input"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          <SubmitButton busy={busy}>{busy ? 'جار الحفظ…' : 'تعيين كلمة المرور'}</SubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}
