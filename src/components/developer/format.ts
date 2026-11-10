export function number(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('ar-JO').format(value);
}

export function decimal(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('ar-JO', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '0 $';
  return `${new Intl.NumberFormat('ar-JO', { maximumFractionDigits: 4 }).format(value)} $`;
}

export function duration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return '—';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${number(days)} ي ${hours} س`;
  if (hours) return `${hours} س ${minutes} د`;
  if (minutes) return `${minutes} د`;
  return `${Math.round(seconds)} ث`;
}

export function shortDate(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat('ar-JO', { day: 'numeric', month: 'short' }).format(date);
}

export function toLocalDateTimeInput(value: string | null | undefined): string {
  if (!value) return '';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** datetime-local قيمة محلية في المتصفح؛ نحوّلها إلى ISO قبل إرسالها للخادم. */
export function toIsoOrNull(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function sourceLabel(source: string): string {
  if (source === 'admin') return 'إجراء إداري';
  if (source === 'ai') return 'ذكاء اصطناعي';
  if (source === 'error') return 'خطأ نظام';
  return 'نشاط مستخدم';
}

export const categoryLabels: Record<string, string> = {
  technical: 'مشكلة تقنية',
  suggestion: 'اقتراح تطوير',
  ai: 'مشكلة في الذكاء الاصطناعي',
  account: 'مشكلة في الحساب',
  tool: 'مشكلة في أداة',
  other: 'أخرى',
};

export const feedbackStatusLabels: Record<string, string> = {
  new: 'جديد',
  reviewing: 'قيد المراجعة',
  in_progress: 'قيد الحل',
  resolved: 'تم الحل',
  closed: 'مغلق',
};

export const audienceLabels: Record<string, string> = {
  all: 'كل المستخدمين',
  active: 'المستخدمون النشطون',
  inactive: 'المستخدمون غير النشطين',
  new: 'المستخدمون الجدد',
  user: 'مستخدم محدد',
};

export const connectionLabels: Record<string, string> = {
  verified: 'اتصال متحقق',
  unverified: 'مهيأ وغير متحقق',
  failed: 'فشل آخر فحص',
  unconfigured: 'غير مهيأ',
};
