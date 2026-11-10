import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  FileText,
  FolderOpen,
  Images,
  Loader2,
  Plus,
  Presentation,
  RefreshCw,
  Search,
  Sparkles,
  Video,
  MessageSquare,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, EmptyState, PageHeader, StatTile } from '../components/ui.tsx';
import { api, ApiError, formatBytes, formatDateTime } from '../lib/api.ts';
import type {
  ContentListItem,
  ContentListResponse,
  ContentSourceType,
  ContentStatus,
  ContentStats,
} from '../lib/contentTypes.ts';

const statusLabels: Record<ContentStatus, string> = {
  draft: 'مسودة',
  pending: 'في الانتظار',
  extracting: 'قيد المعالجة',
  ready: 'جاهز',
  needs_review: 'يحتاج مراجعة',
  failed: 'تعذّرت المعالجة',
};

const sourceIcons = {
  images: Images,
  video: Video,
  text: FileText,
  pdf: FileText,
} as const;

const sourceTints: Record<ContentSourceType, string> = {
  images: '--blue',
  video: '--lavender',
  text: '--mint',
  pdf: '--pink',
};

function statusClass(status: ContentStatus): string {
  if (status === 'ready') return 'badge badge-mint';
  if (status === 'failed') return 'badge badge-pink';
  if (status === 'needs_review') return 'badge badge-yellow';
  if (status === 'draft') return 'badge';
  return 'badge badge-blue';
}

export default function ContentLibraryPage() {
  const [contents, setContents] = useState<ContentListItem[] | null>(null);
  const [stats, setStats] = useState<ContentStats | null>(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | ContentSourceType>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    try {
      const data = await api.get<ContentListResponse>('/contents');
      setContents(data.contents);
      setStats(data.stats);
      if (!quiet) setError(null);
    } catch (caught) {
      if (!quiet) setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل مكتبتك.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const processing = contents?.some((item) => item.status === 'pending' || item.status === 'extracting') ?? false;
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => void load(true), 3500);
    return () => window.clearInterval(timer);
  }, [processing, load]);

  const filtered = useMemo(() => {
    const list = contents ?? [];
    const term = query.trim();
    return list.filter((item) => {
      if (source !== 'all' && item.sourceType !== source) return false;
      if (!term) return true;
      return [item.title, item.subjectName, item.gradeName, item.sourceTypeLabel]
        .filter(Boolean)
        .some((value) => String(value).includes(term));
    });
  }, [contents, query, source]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="مكتبتك الدراسية"
        title="مكتبتي"
        subtitle="ارفع المحتوى مرة واحدة، ثم أنشئ منه امتحانات وملخصات ومحادثات في أي وقت."
        actions={
          <Link to="/content/new" className="btn btn-primary w-full sm:w-auto">
            <Plus size={16} />
            محتوى جديد
          </Link>
        }
      />

      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile tint="blue" label="كل المحتوى" value={stats ? String(stats.total) : '…'} />
        <StatTile tint="mint" label="جاهز للدراسة" value={stats ? String(stats.ready) : '…'} />
        <StatTile tint="yellow" label="يحتاج مراجعة" value={stats ? String(stats.review) : '…'} />
        <StatTile tint="pink" label="قيد المعالجة" value={stats ? String(stats.processing) : '…'} />
      </div>

      <div className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-end">
        <label className="relative block flex-1">
          <span className="label">ابحث في مكتبتك</span>
          <Search size={16} className="pointer-events-none absolute start-3 top-[38px] text-[var(--muted)]" />
          <input
            className="input ps-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="عنوان الدرس أو المادة…"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {([
            ['all', 'الكل'],
            ['images', 'صور'],
            ['video', 'فيديو'],
            ['text', 'نص'],
            ['pdf', 'PDF'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-pressed={source === value}
              onClick={() => setSource(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" onClick={() => void load()} disabled={!contents}>
          <RefreshCw size={14} /> تحديث
        </button>
      </div>

      {!contents ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="card p-4">
              <div className="skeleton h-36 rounded-xl" />
              <div className="skeleton mt-3 h-4 w-2/3 rounded" />
              <div className="skeleton mt-2 h-3 w-1/2 rounded" />
            </div>
          ))}
        </div>
      ) : contents.length === 0 ? (
        <EmptyState
          title="مكتبتك فارغة بعد"
          body="ابدأ بمحتوى واحد: صوّر صفحات درس، أو الصق نصًا، أو ارفع فيديو. ستستطيع استخدامه بعد ذلك في كل الأدوات."
          icon={<FolderOpen size={26} />}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="لا يوجد محتوى مطابق"
          body="جرّب كلمة أخرى أو أزل تصفية النوع. محتواك كله محفوظ في المكتبة."
          icon={<Search size={26} />}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => {
            const Icon = sourceIcons[item.sourceType];
            const busy = item.status === 'pending' || item.status === 'extracting';
            return (
              <Link key={item.id} to={`/content/${item.id}`} className="book-card group flex flex-col overflow-hidden p-0">
                <div className="relative aspect-[16/10] overflow-hidden border-b border-[var(--line-soft)] bg-[var(--surface-hover)]">
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover transition duration-300 group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="grid size-full place-items-center bg-[color-mix(in_srgb,var(--tile,var(--yellow))_22%,var(--surface))]" style={{ '--tile': `var(${sourceTints[item.sourceType]})` } as CSSProperties}>
                      <Icon size={42} className="text-[var(--accent)] opacity-70" />
                    </div>
                  )}
                  <span className={`absolute start-2 top-2 ${statusClass(item.status)}`}>
                    {busy && <Loader2 size={12} className="animate-spin" />}
                    {statusLabels[item.status]}
                  </span>
                  <span
                    className="absolute end-2 top-2 badge bg-[var(--surface-solid)]"
                    style={{ '--tile': `var(${sourceTints[item.sourceType]})` } as CSSProperties}
                  >
                    <Icon size={12} /> {item.sourceTypeLabel}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-2 p-3.5">
                  <div>
                    <h2 className="line-clamp-2 text-base font-bold leading-7">{item.title}</h2>
                    <p className="muted mt-0.5 text-[11px]">
                      {[item.subjectName, item.gradeName].filter(Boolean).join(' · ') || 'بدون مادة محددة'}
                    </p>
                  </div>

                  <div className="muted flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                    <span>{item.pagesCount} صفحة</span>
                    {item.durationSeconds ? <span>{Math.max(1, Math.round(item.durationSeconds / 60))} دقيقة فيديو</span> : null}
                    <span>{formatBytes(item.sizeBytes)}</span>
                    <span>{formatDateTime(item.updatedAt)}</span>
                  </div>

                  {item.status === 'needs_review' && (
                    <p className="rounded-lg bg-[color-mix(in_srgb,var(--yellow)_35%,var(--surface))] px-2 py-1 text-[11px] leading-5">
                      {item.errorMessage ?? 'بعض الصفحات غير واضحة وتحتاج مراجعة.'}
                    </p>
                  )}
                  {item.status === 'failed' && (
                    <p className="rounded-lg bg-[color-mix(in_srgb,var(--pink)_35%,var(--surface))] px-2 py-1 text-[11px] leading-5">
                      {item.errorMessage ?? 'تعذّرت معالجة هذا المحتوى.'}
                    </p>
                  )}
                  {item.needsRefresh && (
                    <p className="text-[11px] font-semibold text-[var(--accent)]">
                      النتائج السابقة أُنشئت من نسخة قديمة ({item.staleResults}) — أعد إنشاءها إن أردت.
                    </p>
                  )}

                  <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-[var(--line-soft)] pt-2">
                    <span className="badge text-[10px]">
                      <Presentation size={11} /> {item.counts.tests} اختبار
                    </span>
                    <span className="badge text-[10px]">
                      <Sparkles size={11} /> {item.counts.summaries} ملخص
                    </span>
                    <span className="badge text-[10px]">
                      <MessageSquare size={11} /> {item.counts.conversations} محادثة
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <section className="card flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 font-bold">
            <BookOpen size={17} className="text-[var(--accent)]" />
            عندك كتاب كامل بصيغة PDF؟
          </h2>
          <p className="muted mt-1 text-xs leading-6">
            رفع الكتاب ما زال متاحًا كخيار إضافي للمكتبة الكبيرة. أما الدراسة اليومية فالأسرع أن تبدأ بصفحات الدرس.
          </p>
        </div>
        <Link to="/books/upload" className="btn btn-soft shrink-0">
          <FileText size={16} /> رفع كتاب كامل
        </Link>
      </section>
    </AppShell>
  );
}
