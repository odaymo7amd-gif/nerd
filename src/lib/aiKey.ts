// مفتاح Groq الخاص بالمستخدم — يُحفظ في متصفح هذا الجهاز فقط (localStorage).
// لا يُرسل إلى قاعدة البيانات ولا يُربط بالحساب على الخادم؛ يُرسل مع كل طلب AI في ترويسة
// مؤقتة ويُنسى بعد الطلب. التخزين المحلي غير مشفّر، ولا تدّعي هذه الطبقة غير ذلك.

import { useSyncExternalStore } from 'react';

const KEY_STORAGE = 'nerd.ai.groq.key.v1';
const PROMPT_STORAGE = 'nerd.ai.prompted.v1';
const CHANGE_EVENT = 'nerd-ai-key-change';

function readStoredKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(KEY_STORAGE)?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

export function getAiKey(): string | null {
  return readStoredKey();
}

export function hasAiKey(): boolean {
  return getAiKey() !== null;
}

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function saveAiKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY_STORAGE, key.trim());
    notify();
  } catch {
    // المتصفح قد يمنع التخزين (وضع خاص/سياسة) — نُبلّغ المستخدم من الواجهة
    throw new Error('تعذّر حفظ المفتاح في هذا المتصفح. تأكد من السماح بالتخزين المحلي ثم أعد المحاولة.');
  }
}

export function clearAiKey(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* لا شيء لنُخفيه هنا: الحذف فشل، والواجهة تعيد القراءة الفعلية */
  }
  notify();
}

/** هل عُرضت نافذة التفعيل مرة واحدة على هذا الجهاز؟ (كي لا تظهر في كل تسجيل دخول) */
export function wasAiPromptShown(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(PROMPT_STORAGE) === '1';
  } catch {
    return true;
  }
}

export function markAiPromptShown(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROMPT_STORAGE, '1');
  } catch {
    /* غير حرج */
  }
}

/** عرض مختصر لا يكشف المفتاح: البادئة فقط ثم نقاط. */
export function maskAiKey(key: string | null): string {
  if (!key) return '—';
  const prefixMatch = key.match(/^[a-zA-Z]{2,5}_/);
  return `${prefixMatch ? prefixMatch[0] : ''}••••••••••••`;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY_STORAGE || event.key === null) callback();
  };
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}

export function useAiKey(): string | null {
  return useSyncExternalStore(subscribe, readStoredKey, () => null);
}
