import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, X } from 'lucide-react';
import { Alert } from './ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import type { AiStatus } from '../lib/aiTypes.ts';
import { AI_VERIFICATION_PHRASE, verifyAiKey } from '../lib/aiApi.ts';
import {
  markAiPromptShown,
  maskAiKey,
  saveAiKey,
  useAiKey,
  wasAiPromptShown,
} from '../lib/aiKey.ts';
import { useSession } from '../lib/session.tsx';

type Mode = 'first' | 'activate' | 'change';

interface AiAccessValue {
  hasKey: boolean;
  maskedKey: string;
  openActivation: (mode?: Mode) => void;
  /** يعيد true إن كان هناك مفتاح محفوظ، وإلا يفتح نافذة التفعيل ويعيد false. */
  requireKey: () => boolean;
}

const AiAccessContext = createContext<AiAccessValue | null>(null);

export function useAiAccess(): AiAccessValue {
  const value = useContext(AiAccessContext);
  if (!value) throw new Error('useAiAccess يجب أن يُستخدم داخل AiAccessProvider');
  return value;
}

export function AiAccessProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const key = useAiKey();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('activate');
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [serverMode, setServerMode] = useState(false);
  const [statusChecked, setStatusChecked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<number | null>(null);

  const openActivation = useCallback((nextMode: Mode = 'activate') => {
    setMode(nextMode);
    setValue('');
    setShow(false);
    setError(null);
    setSuccess(null);
    setBusy(false);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);

  // نعرف أولًا هل المزوّدون مهيأون على الخادم؛ عندها لا نطلب مفتاحًا من المستخدم.
  useEffect(() => {
    if (!user) {
      setStatusChecked(true);
      return;
    }
    let cancelled = false;
    setStatusChecked(false);
    api
      .get<AiStatus>('/ai/status')
      .then((status) => {
        if (!cancelled) setServerMode(status.keySource === 'server');
      })
      .catch(() => {
        if (!cancelled) setServerMode(false);
      })
      .finally(() => {
        if (!cancelled) setStatusChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // تظهر مرة واحدة فقط لمن لا يملك تفعيلًا، بعد أول تسجيل دخول مكتمل
  useEffect(() => {
    if (!user || !user.onboarded || !statusChecked || serverMode) return;
    if (key || wasAiPromptShown()) return;
    const timer = window.setTimeout(() => {
      markAiPromptShown();
      openActivation('first');
    }, 900);
    return () => window.clearTimeout(timer);
  }, [user, key, openActivation, statusChecked, serverMode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [open, close]);

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const hasAiAccess = key !== null || serverMode;

  const requireKey = useCallback(() => {
    if (hasAiAccess) return true;
    openActivation('activate');
    return false;
  }, [hasAiAccess, openActivation]);

  async function submit() {
    if (busy) return;
    const trimmed = value.trim();
    if (!trimmed) {
      setError('الصق مفتاح Groq أولًا.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await verifyAiKey(trimmed);
      try {
        saveAiKey(trimmed);
      } catch (storageError) {
        setError((storageError as Error).message);
        return;
      }
      setValue('');
      setSuccess(`تم التفعيل — كتب النموذج عبارة «${AI_VERIFICATION_PHRASE}».`);
      closeTimer.current = window.setTimeout(() => setOpen(false), 1400);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'تعذّر التحقق من المفتاح. تحقق من اتصالك وحاول مرة أخرى.',
      );
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === 'change'
      ? 'تغيير مفتاح Groq'
      : mode === 'first'
        ? 'فعّل الذكاء الاصطناعي في نيرد'
        : 'تفعيل الذكاء الاصطناعي';

  return (
    <AiAccessContext.Provider
      value={{ hasKey: hasAiAccess, maskedKey: maskAiKey(key), openActivation, requireKey }}
    >
      {children}

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-activation-title"
            className="card w-full max-w-md p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="grid size-10 place-items-center rounded-2xl bg-[var(--surface-hover)] text-[var(--accent)]">
                  <KeyRound size={20} />
                </span>
                <h2 id="ai-activation-title" className="text-lg font-bold leading-6">
                  {title}
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="btn btn-ghost -me-2 -mt-1 px-2 py-1"
                aria-label="إغلاق"
              >
                <X size={18} />
              </button>
            </div>

            <p className="muted mb-3 text-sm leading-6">
              {mode === 'change'
                ? 'أضف مفتاح Groq جديدًا. لن يُستبدل المفتاح القديم إلا بعد نجاح التحقق من الجديد، وإن فشل يبقى القديم فعّالًا.'
                : 'أضف مفتاح Groq API الخاص بك لتفعيل ميزات الذكاء الاصطناعي داخل التطبيق: تلخيص الكتب، وإنشاء الأسئلة، والمساعد الذكي. مفتاحك يبقى على جهازك، ولا تستخدم ميزات الذكاء الاصطناعي مفتاحًا آخر بدلًا عنه.'}
            </p>

            <p className="muted mb-3 rounded-[13px_9px_15px_10px] border-2 border-[var(--line-soft)] bg-[var(--surface-hover)] p-3 text-xs leading-6">
              طريقة التحقق: نطلب من النموذج كتابة العبارة
              <span className="mx-1 font-semibold text-[var(--text)]">«{AI_VERIFICATION_PHRASE}»</span>
              بنفسه. إن كتبها فالمفتاح فعّال، وإن لم يكتبها فالمفتاح غير فعّال أو استُهلك رصيده
              ويحتاج إلى تغيير.
            </p>

            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-soft mb-4 w-full"
            >
              <ExternalLink size={16} />
              الحصول على مفتاح Groq
            </a>

            <label className="label" htmlFor="ai-key-input">
              مفتاح API الخاص بك
            </label>
            <div className="relative">
              <input
                id="ai-key-input"
                ref={inputRef}
                className="input pe-11 font-mono text-sm"
                type={show ? 'text' : 'password'}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder="gsk_..."
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => setShow((current) => !current)}
                className="absolute end-1 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-hover)]"
                aria-label={show ? 'إخفاء المفتاح' : 'إظهار المفتاح'}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {error && (
              <div className="mt-3">
                <Alert>{error}</Alert>
              </div>
            )}
            {success && (
              <div className="mt-3">
                <Alert tone="success">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 size={16} /> {success}
                  </span>
                </Alert>
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary mt-4 w-full"
              onClick={() => void submit()}
              disabled={busy || !value.trim()}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {busy ? 'جارٍ التحقق من المفتاح…' : mode === 'change' ? 'تحقّق واحفظ المفتاح الجديد' : 'تفعيل الذكاء الاصطناعي'}
            </button>

            <button type="button" className="btn btn-ghost mt-2 w-full" onClick={close} disabled={busy}>
              لاحقًا
            </button>

            <p className="muted mt-3 text-center text-[11px] leading-5">
              يُحفظ المفتاح في متصفح هذا الجهاز فقط، ولا يُرفع إلى قاعدة بيانات نيرد ولا يُزامن مع أجهزة
              أخرى. التخزين المحلي للمتصفح غير مشفّر؛ استخدم جهازًا تثق به.
            </p>
          </div>
        </div>
      )}
    </AiAccessContext.Provider>
  );
}
