import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  FileText,
  FolderOpen,
  ListChecks,
  MessagesSquare,
  Search,
  Sparkles,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, EmptyState, PageHeader } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';

interface SearchItem {
  id: number;
  title: string;
  subtitle: string | null;
  href: string;
  meta: string | null;
}

interface SearchGroup {
  key: string;
  label: string;
  count: number;
  items: SearchItem[];
}

interface SearchResponse {
  query: string;
  total: number;
  groups: SearchGroup[];
}

const icons: Record<string, typeof FolderOpen> = {
  contents: FolderOpen,
  books: BookOpen,
  summaries: Sparkles,
  tests: ListChecks,
  questions: FileText,
  conversations: MessagesSquare,
};

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get('q') ?? '';
  const [query, setQuery] = useState(initial);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .get<SearchResponse>(`/search?q=${encodeURIComponent(trimmed)}`, controller.signal)
        .then((response) => {
          setData(response);
          setParams(trimmed ? { q: trimmed } : {}, { replace: true });
        })
        .catch((caught) => {
          if ((caught as Error).name === 'AbortError') return;
          setError(caught instanceof ApiError ? caught.message : 'تعذّر إجراء البحث.');
        })
        .finally(() => setLoading(false));
    }, 280);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, setParams]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="كل شيء في مكان واحد"
        title="البحث الشامل"
        subtitle="ابحث في محتواك وكتبك وملخصاتك واختباراتك وأسئلتك ومحادثاتك — دون مغادرة التطبيق."
      />

      <div className="card p-4">
        <label className="relative block">
          <span className="label">ابحث</span>
          <Search size={18} className="pointer-events-none absolute start-3 top-[38px] text-[var(--muted)]" />
          <input
            className="input ps-10 text-base"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="اكتب كلمة أو عنوانًا… مثال: الطاقة، الفعل، الوحدة الثانية"
            autoFocus
            maxLength={120}
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="muted text-[11px]">
            {query.trim().length < 2
              ? 'اكتب حرفين على الأقل ليبدأ البحث.'
              : loading
                ? 'جار البحث…'
                : data
                  ? `${data.total} نتيجة في ${data.groups.length} أقسام`
                  : ''}
          </p>
          {query && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuery('')}>
              مسح البحث
            </button>
          )}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {query.trim().length < 2 ? (
        <div className="card p-4">
          <h2 className="section-title">ماذا يمكنك أن تجد؟</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['محتواي الدراسي', 'عناوين الدروس والملاحظات والنصوص'],
              ['الملخصات', 'عناوين الملخصات ونصوصها'],
              ['الاختبارات والأسئلة', 'عناوين الاختبارات ونصوص بنك الأسئلة'],
              ['المحادثات', 'عناوين المحادثات وآخر رسالة'],
              ['الكتب', 'عناوين الكتب المرفوعة'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-[12px_9px_13px_8px] border-2 border-dashed border-[var(--line-soft)] p-3">
                <p className="text-sm font-bold">{title}</p>
                <p className="muted mt-0.5 text-[11px] leading-5">{body}</p>
              </div>
            ))}
          </div>
        </div>
      ) : data && data.groups.length === 0 && !loading ? (
        <EmptyState
          title="لا نتائج مطابقة"
          body="جرّب كلمة أقصر أو مرادفًا آخر. البحث يشمل بيانات حسابك فقط، ولا يبحث في حسابات الآخرين."
          icon={<Search className="w-12" />}
        />
      ) : (
        <div className="space-y-4">
          {data?.groups.map((group) => {
            const Icon = icons[group.key] ?? Search;
            return (
              <section key={group.key} className="card p-3 sm:p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="section-title mb-0 inline-flex items-center gap-2">
                    <span className="section-icon">
                      <Icon size={15} />
                    </span>
                    {group.label}
                  </h2>
                  <span className="badge">{group.count}</span>
                </div>
                <ul className="divide-y-2 divide-dashed divide-[var(--line-soft)]">
                  {group.items.map((item) => (
                    <li key={`${group.key}-${item.id}`}>
                      <Link
                        to={item.href}
                        className="flex items-start justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-bold leading-6">{item.title}</span>
                          {item.subtitle && (
                            <span className="muted mt-0.5 block text-[11px] leading-5">{item.subtitle}</span>
                          )}
                        </span>
                        {item.meta && <span className="badge shrink-0">{item.meta}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
