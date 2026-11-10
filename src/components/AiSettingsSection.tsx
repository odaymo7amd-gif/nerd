import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Alert } from './ui.tsx';
import { useAiAccess } from './AiAccess.tsx';
import { api, ApiError } from '../lib/api.ts';
import { AI_VERIFICATION_PHRASE, verifyAiKey } from '../lib/aiApi.ts';
import { clearAiKey, useAiKey } from '../lib/aiKey.ts';
import type { AiStatus } from '../lib/aiTypes.ts';

export function AiSettingsSection() {
  const key = useAiKey();
  const { maskedKey, openActivation } = useAiAccess();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AiStatus>('/ai/status')
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function testConnection() {
    if (!key || testing) return;
    setTesting(true);
    setMessage(null);
    try {
      const result = await verifyAiKey(key);
      setMessage({
        tone: 'success',
        text: `الاتصال ناجح — كتب النموذج «${result.phrase || AI_VERIFICATION_PHRASE}» عبر ${result.provider} (${result.model}). المفتاح فعّال.`,
      });
    } catch (caught) {
      setMessage({
        tone: 'error',
        text:
          caught instanceof ApiError
            ? caught.message
            : 'تعذّر اختبار الاتصال. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.',
      });
    } finally {
      setTesting(false);
    }
  }

  function removeKey() {
    if (!window.confirm('حذف مفتاح Groq من هذا الجهاز؟ ستتوقف ميزات الذكاء الاصطناعي فقط، ولن تُحذف كتبك أو ملخصاتك أو اختباراتك.')) {
      return;
    }
    clearAiKey();
    setMessage({
      tone: 'success',
      text: 'حُذف المفتاح من هذا الجهاز. ميزات الذكاء الاصطناعي معطّلة الآن، وبقية التطبيق تعمل كما هي.',
    });
  }

  const serverMode = status?.keySource === 'server';
  const serverProviders = status?.providers?.filter((provider) => provider.configured) ?? [];

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <KeyRound size={18} className="text-[var(--accent)]" />
        <h2 className="text-lg font-bold">إعدادات الذكاء الاصطناعي</h2>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="muted">حالة التفعيل:</span>
        {serverMode || key ? (
          <span className="badge badge-mint">مفعّل</span>
        ) : (
          <span className="badge">غير مفعّل</span>
        )}
        {status && <span className="muted text-xs">· المزوّد: {status.provider}{status.model ? ` · النموذج: ${status.model}` : ''}</span>}
      </div>

      {message && (
        <div className="mb-3">
          <Alert tone={message.tone === 'success' ? 'success' : 'error'}>{message.text}</Alert>
        </div>
      )}

      {serverMode ? (
        <div className="rounded-[16px_11px_18px_12px] border-2 border-[var(--line-soft)] bg-[var(--surface-hover)] p-4">
          <p className="text-sm font-bold">الذكاء الاصطناعي مهيأ من الخادم</p>
          <p className="muted mt-1 text-xs leading-6">
            لا تحتاج إلى إدخال مفتاح API. يدير المشرف المزوّدين والنماذج ويوزّع الطلبات بينهم
            تلقائيًا، مع مزوّد احتياطي عند تعطّل أحدهم.
          </p>
          {serverProviders.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {serverProviders.map((provider) => (
                <span key={provider.id} className="badge badge-blue" title={provider.model ?? undefined}>
                  {provider.label}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : key ? (
        <>
          <p className="muted mb-3 text-sm">
            المفتاح المحفوظ: <code dir="ltr">{maskedKey}</code> — يُحفظ في هذا المتصفح فقط ولا يُعرض كاملًا.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-soft" onClick={() => void testConnection()} disabled={testing}>
              {testing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {testing ? 'جارٍ الاختبار…' : 'اختبار الاتصال'}
            </button>
            <button type="button" className="btn btn-soft" onClick={() => openActivation('change')}>
              <KeyRound size={16} /> تغيير مفتاح API
            </button>
            <button type="button" className="btn btn-ghost btn-sm text-[var(--color-bad)]" onClick={removeKey}>
              <Trash2 size={16} /> حذف مفتاح API
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted mb-3 text-sm leading-6">
            ميزات الذكاء الاصطناعي (التلخيص، توليد الأسئلة، المساعد) تحتاج مفتاح Groq الخاص بك. بقية
            التطبيق — الكتب، الاختبارات المحفوظة، بنك الأسئلة، الملف الشخصي — تعمل بلا مفتاح.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => openActivation('activate')}>
            <KeyRound size={16} /> إضافة مفتاح API
          </button>
        </>
      )}

      <p className="muted mt-3 rounded-[13px_9px_15px_10px] border-2 border-[var(--line-soft)] bg-[var(--surface-hover)] p-3 text-[11px] leading-5">
        <CheckCircle2 size={12} className="me-1 inline" />
        التحقق يطلب من النموذج كتابة «{AI_VERIFICATION_PHRASE}» بنفسه: إن كتبها فالمفتاح فعّال، وإن
        لم يكتبها فالمفتاح غير فعّال أو استُهلك رصيده ويحتاج إلى تغيير. الاختبار يستهلك رموزًا
        قليلة من مفتاحك.
      </p>

      <p className="muted mt-2 text-[11px] leading-5">
        لا يُحفظ المفتاح في قاعدة بيانات نيرد ولا يُزامن مع أجهزة أخرى، ويُرسل فقط مع طلباتك إلى
        الخادم ثم إلى Groq. إذا سجّلت الدخول من جهاز آخر فستحتاج إلى إضافة مفتاحك هناك مرة واحدة.
      </p>
    </section>
  );
}
