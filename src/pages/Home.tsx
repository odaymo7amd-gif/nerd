import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  BookText,
  Clock3,
  FileText,
  Flame,
  FolderOpen,
  GraduationCap,
  Languages,
  LayoutGrid,
  Plus,
  Search,
  Sparkles,
  Star,
  Target,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, FullPageLoader } from '../components/ui.tsx';
import { NerdMascot } from '../components/NerdMascot.tsx';
import { AdBanner } from '../components/AdBanner.tsx';
import { api, ApiError, formatDateTime, formatMinutes } from '../lib/api.ts';
import type { HomePayload, ProfilePayload } from '../lib/types.ts';
import type { ContentListItem, ContentListResponse } from '../lib/contentTypes.ts';

function ContentIcon({ sourceType }: { sourceType: ContentListItem['sourceType'] }) {
  if (sourceType === 'video') return <BookOpen size={18} />;
  if (sourceType === 'images') return <FolderOpen size={18} />;
  return <FileText size={18} />;
}

export default function HomePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<HomePayload | null>(null);
  const [counts, setCounts] = useState<ProfilePayload['counts'] | null>(null);
  const [contents, setContents] = useState<ContentListItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<HomePayload>('/home')
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الصفحة الرئيسية.');
      });

    api
      .get<ProfilePayload>('/profile')
      .then((profile) => {
        if (!cancelled) setCounts(profile.counts);
      })
      .catch(() => undefined);

    api
      .get<ContentListResponse>('/contents')
      .then((payload) => {
        if (!cancelled) setContents(payload.contents);
      })
      .catch(() => {
        if (!cancelled) setContents([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) {
    return <AppShell>{error ? <Alert>{error}</Alert> : <FullPageLoader label="جار تجهيز مساحتك…" />}</AppShell>;
  }

  const latest = contents?.[0] ?? null;
  const recent = contents?.slice(0, 3) ?? [];
  const goalPercent =
    data.stats.dailyGoalMinutes > 0
      ? Math.min(100, Math.round((data.stats.studyMinutes / data.stats.dailyGoalMinutes) * 100))
      : 0;

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (term) navigate(`/search?q=${encodeURIComponent(term)}`);
  }

  return (
    <AppShell>
      <div className="home-page">
        <section className="home-hero">
          <div className="home-hero-copy">
            <span className="home-hero-pill">
              <Sparkles size={12} /> {data.greeting}
            </span>
            <h1>شو بدك تتعلم اليوم؟</h1>
            <p>{data.motivation}</p>
            <div className="home-hero-actions">
              <Link to="/content/new" className="btn">
                <Plus size={15} /> ابدأ الدراسة
              </Link>
              <Link to={latest ? `/content/${latest.id}` : '/content'} className="btn btn-secondary">
                {latest ? 'تابع آخر درس' : 'استكشف مكتبتك'}
              </Link>
            </div>
          </div>
          <div className="home-hero-art" aria-hidden="true">
            <NerdMascot className="w-full" />
          </div>
        </section>

        <AdBanner />

        <form onSubmit={submitSearch} className="home-search" role="search">
          <Search size={20} className="shrink-0 text-[var(--accent)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث عن درس أو اسأل عن أي شيء..."
            aria-label="ابحث عن درس أو اسأل عن أي شيء"
            maxLength={120}
          />
          <button type="submit" aria-label="ابدأ البحث">
            <span>ابحث</span>
            <ArrowLeft size={16} />
          </button>
        </form>

        <section className="home-tools" aria-labelledby="home-tools-title">
          <Link to="/ask-teacher" className="ask-teacher-card">
            <span className="ask-teacher-icon" aria-hidden="true">
              <GraduationCap size={29} />
            </span>
            <span className="ask-teacher-copy">
              <span className="ask-teacher-eyebrow">معلّمك الذكي</span>
              <strong>اسأل المعلم</strong>
              <small>افهم أي موضوع بطريقة تفاعلية</small>
            </span>
            <span className="ask-teacher-cta" aria-hidden="true">
              <span>ابدأ</span>
              <ArrowLeft size={18} />
            </span>
          </Link>

          <div className="language-grid">
            <Link to="/english-grammar" className="language-card language-card--en">
              <span className="language-icon" aria-hidden="true">
                <span className="language-code">EN</span>
                <Languages size={15} />
              </span>
              <span className="language-copy">
                <strong>تعلّم الإنجليزية</strong>
                <small>قواعد وتمارين تفاعلية</small>
              </span>
              <ArrowLeft size={16} className="language-arrow" aria-hidden="true" />
            </Link>
            <Link to="/arabic-grammar" className="language-card language-card--ar">
              <span className="language-icon" aria-hidden="true">
                <span className="language-code language-code--ar">ع</span>
                <BookText size={15} />
              </span>
              <span className="language-copy">
                <strong>تعلّم اللغة العربية</strong>
                <small>قواعد وتعبير وتمارين</small>
              </span>
              <ArrowLeft size={16} className="language-arrow" aria-hidden="true" />
            </Link>
          </div>

          <Link to="/tools" className="all-tools-entry">
            <span className="all-tools-entry-icon" aria-hidden="true">
              <LayoutGrid size={21} />
            </span>
            <span className="min-w-0 flex-1">
              <strong>كل الأدوات</strong>
              <small>اكتشف بقية أدوات نيرد الدراسية في مكان واحد</small>
            </span>
            <ArrowLeft size={17} className="shrink-0" aria-hidden="true" />
          </Link>
        </section>

        <section className="goal-strip" aria-label="ملخص تقدمك">
          <div>
            <strong>{goalPercent}%</strong>
            <span>من هدف اليوم · {formatMinutes(data.stats.dailyGoalMinutes)}</span>
          </div>
          <div>
            <strong className="inline-flex items-center gap-1">
              <Flame size={15} className="text-[var(--accent)]" /> {data.stats.streakDays}
            </strong>
            <span>أيام متتابعة</span>
          </div>
          <div>
            <strong className="inline-flex items-center gap-1">
              <Star size={15} className="text-[#a77d14]" /> {data.stats.points}
            </strong>
            <span>نقطة دراسية</span>
          </div>
        </section>

        <section>
          <div className="home-section-head">
            <h2>تابع دراستك</h2>
            <Link to="/content">
              مكتبتي <ArrowLeft size={14} />
            </Link>
          </div>

          {latest ? (
            <div className="continue-card">
              <span className="continue-icon">
                <ContentIcon sourceType={latest.sourceType} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold">{latest.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--muted)]">
                  <span>{latest.sourceTypeLabel}</span>
                  <span>·</span>
                  <span>{latest.subjectName ?? 'بدون مادة محددة'}</span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock3 size={11} /> {formatDateTime(latest.updatedAt)}
                  </span>
                </p>
              </div>
              <Link to={`/content/${latest.id}`} className="btn btn-soft btn-sm shrink-0">
                متابعة
              </Link>
            </div>
          ) : (
            <div className="card flex flex-col items-center gap-2 px-5 py-6 text-center">
              <span className="empty-art">
                <FolderOpen size={25} />
              </span>
              <p className="text-sm font-bold">ابدأ بأول محتوى دراسي</p>
              <p className="max-w-sm text-xs leading-6 text-[var(--muted)]">
                ارفع صورة درس أو PDF أو الصق نصًا، وسيظهر هنا آخر ما درسته.
              </p>
              <Link to="/content/new" className="btn btn-primary btn-sm mt-1">
                <Plus size={14} /> أضف محتوى
              </Link>
            </div>
          )}
        </section>

        <section>
          <div className="home-section-head">
            <h2>مكتبتك الدراسية</h2>
            <Link to="/content">
              عرض الكل <ArrowLeft size={14} />
            </Link>
          </div>

          {recent.length > 0 ? (
            <div className="library-list">
              {recent.map((item) => (
                <Link key={item.id} to={`/content/${item.id}`} className="library-row">
                  <span className="library-type">
                    <ContentIcon sourceType={item.sourceType} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{item.title}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">
                      {item.subjectName ?? item.sourceTypeLabel} · {formatDateTime(item.updatedAt)}
                    </span>
                  </span>
                  <span className={`badge shrink-0 ${item.status === 'ready' ? 'badge-mint' : 'badge-yellow'}`}>
                    {item.status === 'ready' ? 'جاهز' : item.status === 'failed' ? 'يحتاج مراجعة' : 'قيد المعالجة'}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="card p-4">
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-sm font-bold">مكتبتك في انتظار أول ملف</p>
                  <p className="mt-1 text-xs leading-6 text-[var(--muted)]">كل ما تضيفه سيظهر هنا للوصول السريع.</p>
                </div>
                <Link to="/content/new" className="btn btn-soft btn-sm shrink-0">
                  <Plus size={14} /> إضافة محتوى
                </Link>
              </div>
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Link to="/summary" className="badge">
              <Sparkles size={11} /> {counts?.summaries ?? 0} ملخص
            </Link>
            <Link to="/tests" className="badge badge-pink">
              <Target size={11} /> {counts?.tests ?? 0} اختبار
            </Link>
            <Link to="/books" className="badge badge-blue">
              <BookOpen size={11} /> {counts?.books ?? 0} كتاب
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
