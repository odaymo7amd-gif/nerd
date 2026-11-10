import type { ReactNode } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Gauge,
  HeartHandshake,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquareWarning,
  Moon,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Users,
  Wrench,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../Logo.tsx';
import { useSession } from '../../lib/session.tsx';
import type { DeveloperContext, RangeKey } from '../../lib/developerTypes.ts';
import { Spinner } from '../ui.tsx';

export type DeveloperTab =
  | 'overview'
  | 'users'
  | 'analytics'
  | 'ai'
  | 'notifications'
  | 'ads'
  | 'tools'
  | 'health'
  | 'activity'
  | 'feedback'
  | 'settings';

const nav: Array<{ key: DeveloperTab; label: string; icon: typeof Gauge }> = [
  { key: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
  { key: 'users', label: 'المستخدمون', icon: Users },
  { key: 'analytics', label: 'التحليلات', icon: BarChart3 },
  { key: 'ai', label: 'مراقبة الذكاء الاصطناعي', icon: Bot },
  { key: 'notifications', label: 'الإشعارات', icon: Bell },
  { key: 'ads', label: 'الإعلانات الداخلية', icon: Megaphone },
  { key: 'tools', label: 'الأدوات والصيانة', icon: Wrench },
  { key: 'health', label: 'صحة النظام', icon: Activity },
  { key: 'activity', label: 'سجل النشاطات', icon: SlidersHorizontal },
  { key: 'feedback', label: 'الشكاوى والاقتراحات', icon: MessageSquareWarning },
  { key: 'settings', label: 'الإعدادات', icon: Settings },
];

export function DeveloperLayout({
  active,
  context,
  range,
  onRange,
  onTab,
  onRefresh,
  refreshing,
  children,
}: {
  active: DeveloperTab | 'user';
  context: DeveloperContext | null;
  range: RangeKey;
  onRange: (range: RangeKey) => void;
  onTab: (tab: DeveloperTab) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  children: ReactNode;
}) {
  const { theme, setTheme, logout, user } = useSession();
  const navigate = useNavigate();
  const showRange = ['overview', 'analytics', 'ai', 'activity'].includes(active);

  return (
    <div className="dev-shell" dir="rtl">
      <aside className="dev-sidebar">
        <div className="dev-brand">
          <Link to="/" aria-label="العودة إلى نيرد">
            <Logo size={38} />
          </Link>
          <span className="dev-brand-tag">
            <ShieldCheck size={12} /> لوحة المطوّر
          </span>
        </div>

        <div className="dev-admin-id">
          <span className="dev-avatar">{user?.username.slice(0, 2).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <strong>{context?.admin.username ?? user?.username}</strong>
            <small>وصول خاص · مطوّر رئيسي</small>
          </span>
        </div>

        <nav className="dev-nav" aria-label="أقسام لوحة المطوّر">
          {nav.map((item) => {
            const Icon = item.icon;
            const badge =
              item.key === 'feedback'
                ? context?.counts.unreadFeedback
                : item.key === 'notifications'
                  ? context?.counts.scheduledNotifications
                  : item.key === 'tools'
                    ? context?.counts.disabledTools
                    : undefined;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onTab(item.key)}
                className={active === item.key ? 'is-active' : ''}
                aria-current={active === item.key ? 'page' : undefined}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {badge ? <b>{badge}</b> : null}
              </button>
            );
          })}
        </nav>

        <div className="dev-sidebar-footer">
          <Link to="/support" className="dev-footer-link">
            <HeartHandshake size={15} /> صفحة الدعم
          </Link>
          <Link to="/" className="dev-footer-link">
            <ArrowRight size={15} /> العودة إلى التطبيق
          </Link>
          <button
            type="button"
            className="dev-footer-link"
            onClick={() => void setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            {theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
          </button>
          <button
            type="button"
            className="dev-footer-link danger"
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            <LogOut size={15} /> تسجيل الخروج
          </button>
        </div>
      </aside>

      <div className="dev-main">
        <header className="dev-topbar">
          <div className="dev-mobile-brand">
            <Logo size={31} />
            <span>لوحة المطوّر</span>
          </div>
          <div className="dev-topbar-actions">
            {showRange && (
              <label className="dev-range">
                <span>الفترة</span>
                <select value={range} onChange={(event) => onRange(event.target.value as RangeKey)}>
                  <option value="today">اليوم</option>
                  <option value="7d">آخر 7 أيام</option>
                  <option value="30d">آخر 30 يومًا</option>
                  <option value="90d">آخر 90 يومًا</option>
                  <option value="all">كل الفترات</option>
                </select>
              </label>
            )}
            <button type="button" className="dev-icon-btn" onClick={onRefresh} aria-label="تحديث البيانات">
              {refreshing ? <Spinner /> : <RefreshCw size={18} />}
            </button>
            <button
              type="button"
              className="dev-icon-btn"
              onClick={() => void setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="تبديل المظهر"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        <nav className="dev-mobile-nav" aria-label="أقسام لوحة المطوّر">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onTab(item.key)}
                className={active === item.key ? 'is-active' : ''}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {active === 'user' && (
          <button type="button" className="dev-back-users" onClick={() => onTab('users')}>
            <ArrowRight size={15} /> العودة إلى المستخدمين
          </button>
        )}

        <main className="dev-content">{children}</main>
        <footer className="dev-footer">
          <ShieldCheck size={13} /> مساحة إدارة داخلية محمية. لا تشارك هذا الرابط.
          {context?.maintenance.enabled && (
            <span className="dev-maintenance-chip">وضع الصيانة مفعّل</span>
          )}
        </footer>
      </div>
    </div>
  );
}
