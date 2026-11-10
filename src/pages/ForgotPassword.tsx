import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout.tsx';
import { Alert, Field, SubmitButton } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';

interface ForgotResponse {
  ok: boolean;
  message: string;
  deliveryConfigured: boolean;
  deliveryReason?: string;
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForgotResponse | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await api.post<ForgotResponse>('/auth/forgot-password', { email: email.trim() });
      setResult(response);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إرسال الطلب.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="استعادة كلمة المرور"
      subtitle="أدخل بريدك الإلكتروني وسنرسل رابط إعادة التعيين."
      footer={
        <p className="muted">
          <Link to="/login" className="font-semibold text-[var(--accent)]">
            العودة إلى تسجيل الدخول
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        {result && <Alert tone="info">{result.message}</Alert>}
        {result && !result.deliveryConfigured && (
          <Alert tone="error">
            لم يُضبط مزوّد البريد على الخادم بعد، لذلك لم تُسلَّم الرسالة فعليًا. يلزم ضبط
            <span dir="ltr" className="mx-1 font-mono text-xs">
              EMAIL_API_KEY
            </span>
            و
            <span dir="ltr" className="mx-1 font-mono text-xs">
              EMAIL_FROM
            </span>
            لتفعيل التسليم. رابط إعادة التعيين سُجِّل في سجل الخادم للاختبار.
          </Alert>
        )}
        <Field label="البريد الإلكتروني" htmlFor="email">
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="student@example.com"
            dir="ltr"
            required
          />
        </Field>
        <SubmitButton busy={busy}>{busy ? 'جار الإرسال…' : 'إرسال رابط الاستعادة'}</SubmitButton>
      </form>
    </AuthLayout>
  );
}
