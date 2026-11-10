import { Link } from 'react-router-dom';
import {
  Bell,
  BookOpen,
  BookText,
  CalendarDays,
  ChevronLeft,
  FolderOpen,
  GraduationCap,
  Languages,
  LayoutGrid,
  Library,
  ListChecks,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { useSession } from '../lib/session.tsx';

const groups = [
  {
    title: 'تعلّم وذاكر',
    items: [
      { to: '/ask-teacher', label: 'اسأل المعلم', hint: 'حوّل سؤالك إلى درس', icon: GraduationCap, bg: 'var(--purple-soft)', ink: 'var(--accent)' },
      { to: '/english-grammar', label: 'تعلّم الإنجليزية', hint: 'قواعد وشرح وامتحان', icon: Languages, bg: 'var(--blue)', ink: '#31557f' },
      { to: '/arabic-grammar', label: 'تعلّم اللغة العربية', hint: 'نحو وبلاغة وامتحان', icon: BookText, bg: 'var(--mint)', ink: '#2d5c3d' },
      { to: '/summary', label: 'الملخصات', hint: 'راجع دروسك بسرعة', icon: Sparkles, bg: 'var(--yellow)', ink: '#7a5b12' },
      { to: '/tests', label: 'الاختبارات', hint: 'اختبر نفسك من محتواك', icon: ListChecks, bg: 'var(--pink)', ink: '#77324b' },
      { to: '/bank', label: 'بنك الأسئلة', hint: 'تدرّب على الأسئلة', icon: Library, bg: 'var(--mint)', ink: '#2d5c3d' },
      { to: '/schedule', label: 'الجدول الدراسي', hint: 'نظّم وقت المراجعة', icon: CalendarDays, bg: 'var(--blue)', ink: '#31557f' },
      { to: '/books', label: 'الكتب الدراسية', hint: 'كتبك الكاملة', icon: BookOpen, bg: 'var(--surface-hover)', ink: 'var(--accent)' },
    ],
  },
  {
    title: 'مكتبتك',
    items: [
      { to: '/content', label: 'كل المحتوى', hint: 'دروسك وملفاتك', icon: FolderOpen, bg: 'var(--purple-soft)', ink: 'var(--accent)' },
      { to: '/content/new', label: 'إضافة محتوى', hint: 'صورة أو PDF أو نص', icon: LayoutGrid, bg: 'var(--mint)', ink: '#2d5c3d' },
      { to: '/search', label: 'البحث الشامل', hint: 'ابحث في كل شيء', icon: Search, bg: 'var(--blue)', ink: '#31557f' },
    ],
  },
  {
    title: 'حسابك',
    items: [
      { to: '/profile', label: 'حسابي', hint: 'بياناتك وإحصائياتك', icon: UserRound, bg: 'var(--purple-soft)', ink: 'var(--accent)' },
      { to: '/notifications', label: 'الإشعارات', hint: 'آخر التحديثات', icon: Bell, bg: 'var(--pink)', ink: '#77324b' },
      { to: '/settings', label: 'الإعدادات', hint: 'المظهر والذكاء الاصطناعي', icon: Settings, bg: 'var(--surface-hover)', ink: 'var(--accent)' },
    ],
  },
];

export default function MorePage() {
  const { user } = useSession();
  const admin = user?.role === 'admin';

  return (
    <AppShell>
      <section className="more-hero">
        <p className="eyebrow">كل شيء في مكان واحد</p>
        <h1 className="page-title">المزيد</h1>
        <p className="page-subtitle">الأدوات التي تحتاجها للمراجعة والتنظيم، مرتبة دون زحام.</p>
      </section>

      {groups.map((group) => (
        <section key={group.title}>
          <div className="home-section-head">
            <h2>{group.title}</h2>
          </div>
          <div className="more-grid">
            {group.items.map((item) => (
              <Link key={item.to} to={item.to} className="more-link">
                <span className="more-link-icon" style={{ '--more-bg': item.bg, '--more-ink': item.ink } as React.CSSProperties}>
                  <item.icon size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{item.label}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">{item.hint}</span>
                </span>
                <ChevronLeft size={15} className="shrink-0 text-[var(--muted)]" />
              </Link>
            ))}
            {group.title === 'حسابك' && admin && (
              <Link to="/admin" className="more-link">
                <span className="more-link-icon" style={{ '--more-bg': 'var(--blue)', '--more-ink': '#31557f' } as React.CSSProperties}>
                  <ShieldCheck size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">لوحة الإدارة</span>
                  <span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">إدارة المنصة</span>
                </span>
                <ChevronLeft size={15} className="shrink-0 text-[var(--muted)]" />
              </Link>
            )}
          </div>
        </section>
      ))}
    </AppShell>
  );
}
