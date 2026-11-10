import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Logo } from './Logo.tsx';
import { NerdMascot } from './NerdMascot.tsx';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-center gap-6 px-4 py-8">
      <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_1fr]">
        <div className="hidden lg:block">
          <Logo size={56} />
          <div className="relative mt-4">
            <NerdMascot className="hero-mascot w-40" />
          </div>
          <h2 className="mt-2 font-display text-3xl font-extrabold leading-snug">
            مساعدك الدراسي الذكي
            <span className="block">
              <span className="inline bg-[linear-gradient(transparent_58%,var(--highlight)_58%,var(--highlight)_94%,transparent_94%)]">
                لكل صفحة في كتابك.
              </span>
            </span>
          </h2>
          <p className="muted mt-3 max-w-md text-sm leading-7">
            ارفع كتبك الدراسية، وأنشئ ملخصات وأسئلة واختبارات من محتوى المنهاج نفسه، وتابع تقدمك في مكان
            واحد. مبني أولًا للمنهاج الأردني.
          </p>
          <ul className="mt-5 space-y-2 text-sm">
            {[
              'كتبك وملخصاتك محفوظة في حسابك الخاص فقط.',
              'الإجابات مرتبطة بصفحات الكتاب ومصادره.',
              'واجهة عربية كاملة تعمل على الهاتف واللوحي والحاسوب.',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1 grid size-4 shrink-0 place-items-center rounded-full border-2 border-[var(--line)] bg-[var(--mint)] text-[#25251f]">
                  <Check size={9} strokeWidth={3.5} />
                </span>
                <span className="muted leading-7">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card relative p-5 sm:p-7">
          <div className="mb-5 lg:hidden">
            <Logo size={40} />
          </div>
          <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
          <p className="muted mt-1 mb-5 text-sm">{subtitle}</p>
          {children}
          {footer && <div className="mt-5 border-t border-[var(--border)] pt-4 text-sm">{footer}</div>}
          <p className="muted mt-4 text-center text-[11px] leading-5">
            باستخدامك نيرد فإنك توافق على{' '}
            <Link to="/terms" className="underline">
              شروط الاستخدام
            </Link>{' '}
            و{' '}
            <Link to="/privacy" className="underline">
              سياسة الخصوصية
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
