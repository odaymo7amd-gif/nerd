import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  BookOpen,
  CalendarDays,
  FolderOpen,
  GraduationCap,
  HeartHandshake,
  Home,
  LayoutGrid,
  Library,
  LifeBuoy,
  ListChecks,
  LogOut,
  MessagesSquare,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  UserRound,
  Wrench,
} from 'lucide-react';
import { Logo } from './Logo.tsx';
import { useSession } from '../lib/session.tsx';
import { api } from '../lib/api.ts';

const primaryNav = [
  { to: '/', label: 'الرئيسية', icon: Home },
  { to: '/content', label: 'مكتبتي', icon: FolderOpen },
  { to: '/assistant', label: 'محادثاتي', icon: MessagesSquare },
];

const studyNav = [
  { to: '/ask-teacher', label: 'اسأل المعلم', icon: GraduationCap },
  { to: '/summary', label: 'الملخصات', icon: Sparkles },
  { to: '/tests', label: 'الاختبارات', icon: ListChecks },
  { to: '/bank', label: 'بنك الأسئلة', icon: Library },
  { to: '/schedule', label: 'الجدول الدراسي', icon: CalendarDays },
  { to: '/books', label: 'الكتب الدراسية', icon: BookOpen },
  { to: '/search', label: 'البحث الشامل', icon: Search },
  { to: '/tools', label: 'كل الأدوات', icon: LayoutGrid },
];

const accountNav = [
  { to: '/profile', label: 'حسابي', icon: UserRound },
  { to: '/notifications', label: 'الإشعارات', icon: Bell },
  { to: '/feedback', label: 'الشكاوى والاقتراحات', icon: LifeBuoy },
  { to: '/settings', label: 'الإعدادات', icon: Settings },
];

const bottomNav = [
  { to: '/', label: 'الرئيسية', icon: Home, tone: 'purple' },
  { to: '/content', label: 'مكتبي', icon: FolderOpen, tone: 'mint' },
  { to: '/tools', label: 'الأدوات', icon: LayoutGrid, tone: 'blue' },
  { to: '/support', label: 'ادعم المطوّر', icon: HeartHandshake, tone: 'pink' },
] as const;

function matches(pathname: string, to: string) {
  if (to === '/') return pathname === '/';
  if (to === '/content') return pathname === '/content' || pathname.startsWith('/content/') || pathname.startsWith('/books');
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout, theme, setTheme } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const [maintenance, setMaintenance] = useState<{ enabled: boolean; message: string } | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ maintenance: { enabled: boolean; message: string } }>('/status')
      .then((data) => {
        if (!cancelled) setMaintenance(data.maintenance);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ unread: number }>('/notifications')
      .then((data) => {
        if (!cancelled) setUnread(data.unread);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (!user) return null;

  if (maintenance?.enabled && !user.isDeveloper) {
    return (
      <main className="maintenance-screen">
        <div className="maintenance-card">
          <span className="maintenance-mark" aria-hidden="true">
            <Wrench size={26} />
          </span>
          <span className="maintenance-eyebrow">صيانة مجدولة</span>
          <h1>نيرد يخضع لصيانة سريعة</h1>
          <p>{maintenance.message}</p>
          <button type="button" className="btn btn-soft" onClick={() => window.location.reload()}>
            <RefreshCw size={15} /> إعادة المحاولة
          </button>
          <small>حسابك وبياناتك محفوظة. سنعود قريبًا.</small>
        </div>
      </main>
    );
  }

  const initials = user.username.trim().slice(0, 2).toUpperCase();
  const showChatFab =
    location.pathname !== '/assistant' &&
    location.pathname !== '/support' &&
    !/^\/tests\/[^/]+\/take\/?$/.test(location.pathname);

  const renderNav = (items: typeof primaryNav) =>
    items.map((item) => (
      <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav-link">
        <item.icon size={17} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.to === '/notifications' && unread > 0 && (
          <span className="badge badge-pink px-1.5 py-0 text-[10px]">{unread}</span>
        )}
      </NavLink>
    ));

  return (
    <div className="app-shell mx-auto flex min-h-dvh w-full max-w-[1400px] gap-6 px-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 lg:gap-7 lg:pb-8 lg:pt-5">
      <aside className="sticky top-5 hidden h-[calc(100dvh-2.5rem)] w-[16.5rem] shrink-0 flex-col rounded-[28px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] p-3.5 shadow-[var(--shadow-sm)] backdrop-blur-xl lg:flex">
        <Link to="/" className="mb-4 block px-2 pt-1">
          <Logo />
        </Link>

        <Link
          to="/profile"
          className="mb-4 flex items-center gap-2.5 rounded-2xl bg-[var(--purple-soft)] px-2.5 py-2.5 transition hover:bg-[var(--surface-hover)]"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[11px] font-extrabold text-white">
            {initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold">{user.username}</span>
            <span className="block truncate text-[10px] text-[var(--muted)]">
              {user.isDeveloper ? 'مطوّر' : 'طالب'} · مساحتك الدراسية
            </span>
          </span>
        </Link>

        <div className="min-h-0 flex-1 overflow-y-auto pe-0.5">
          <nav className="space-y-1">{renderNav(primaryNav)}</nav>
          <p className="mb-1 mt-4 px-2 text-[10px] font-bold text-[var(--muted)]">أدوات الدراسة</p>
          <nav className="space-y-0.5">{renderNav(studyNav)}</nav>
          <p className="mb-1 mt-4 px-2 text-[10px] font-bold text-[var(--muted)]">حسابك</p>
          <nav className="space-y-0.5">{renderNav(accountNav)}</nav>
        </div>

        <div className="mt-3 space-y-1 border-t border-[var(--line)] pt-2">
          <NavLink to="/support" className="nav-link nav-link--support">
            <HeartHandshake size={17} />
            <span>ادعم المطوّر</span>
          </NavLink>
          <button type="button" onClick={() => void setTheme(theme === 'dark' ? 'light' : 'dark')} className="nav-link w-full">
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            <span>{theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
            className="nav-link w-full"
          >
            <LogOut size={17} />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-2 z-20 mb-4 rounded-[20px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] px-2.5 py-2 shadow-[var(--shadow-xs)] backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between gap-2">
            <Link to="/" aria-label="الرئيسية" className="min-w-0">
              <Logo size={34} />
            </Link>
            <div className="flex shrink-0 items-center gap-1.5">
              <Link to="/search" aria-label="البحث" className="icon-btn size-10">
                <Search size={17} />
              </Link>
              <Link to="/notifications" aria-label="الإشعارات" className="icon-btn relative size-10">
                <Bell size={17} />
                {unread > 0 && (
                  <span className="absolute -top-1.5 -end-1.5 grid min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[9px] font-extrabold text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </Link>
              <Link to="/settings" aria-label="الإعدادات" className="icon-btn size-10">
                <Settings size={17} />
              </Link>
              <Link
                to="/profile"
                aria-label="حسابي"
                className="grid size-10 place-items-center rounded-full bg-[var(--purple-soft)] text-[11px] font-extrabold text-[var(--purple-deep)]"
              >
                {initials}
              </Link>
            </div>
          </div>
          {location.pathname === '/' && (
            <p className="mt-1.5 truncate px-1 text-[10px] leading-5 text-[var(--muted)]">
              مرحبًا {user.username} <span aria-hidden="true">👋</span> — جاهز تتعلم شيء جديد اليوم؟
            </p>
          )}
        </header>

        <main className="space-y-5">{children}</main>
      </div>

      {showChatFab && (
        <Link to="/assistant" className="chat-fab" aria-label="فتح المحادثة الذكية">
          <span className="chat-fab-glow" aria-hidden="true" />
          <MessagesSquare size={25} strokeWidth={2.1} />
        </Link>
      )}

      <nav aria-label="التنقل الرئيسي" className="bottom-nav fixed inset-x-0 bottom-0 z-30 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 lg:hidden">
        <div className="bottom-nav-inner mx-auto">
          {bottomNav.map((item) => {
            const active = matches(location.pathname, item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                data-tone={item.tone}
                aria-current={active ? 'page' : undefined}
                className={`bottom-nav-item ${active ? 'is-active' : ''}`}
                style={{ '--nav-tone': `var(--${item.tone})` } as CSSProperties}
              >
                <span className="bottom-nav-icon">
                  <item.icon size={20} strokeWidth={active ? 2.3 : 1.9} />
                </span>
                <span className="bottom-nav-label">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
