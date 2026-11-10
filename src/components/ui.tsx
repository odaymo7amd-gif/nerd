import type { ReactNode } from 'react';
import { Logo } from './Logo.tsx';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="جار التحميل"
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export function FullPageLoader({ label = 'جار التحميل…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-[26px] bg-[var(--purple-soft)] p-3 shadow-[var(--shadow-sm)]">
        <Logo size={64} showText={false} />
      </div>
      <div>
        <p className="logo-word text-xl font-extrabold tracking-[0.18em]">NERD</p>
        <p className="mt-0.5 text-sm font-bold">دراستك أسهل، ومراجعتك أذكى</p>
      </div>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-[var(--line-soft)]" aria-hidden="true">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--accent)]" />
      </div>
    </div>
  );
}

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  return (
    <div role="alert" className={`alert alert-${tone}`}>
      {children}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs font-semibold text-[var(--color-bad)]">{error}</p>
      ) : hint ? (
        <p className="muted mt-1 text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  busy,
  children,
  className = 'btn btn-primary w-full',
  onClick,
  type = 'submit',
  disabled,
}: {
  busy?: boolean;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  type?: 'submit' | 'button';
  disabled?: boolean;
}) {
  return (
    <button type={type} onClick={onClick} className={className} disabled={busy || disabled}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Progress({
  value,
  max,
  tone = 'accent',
}: {
  value: number;
  max: number;
  tone?: 'accent' | 'ok' | 'danger';
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="progress-fill"
        data-tone={tone === 'ok' ? 'ok' : tone === 'danger' ? 'danger' : undefined}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`page-header ${className ?? ''}`}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="section-title">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ title, body, icon }: { title: string; body: string; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-9 text-center">
      <div className="empty-art">{icon}</div>
      <p className="font-bold">{title}</p>
      <p className="muted max-w-sm text-sm leading-7">{body}</p>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon,
  tint = 'yellow',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tint?: 'yellow' | 'blue' | 'mint' | 'pink' | 'lavender';
}) {
  return (
    <div className="stat-tile flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="muted text-[11px] leading-5">{label}</p>
        <p className="stat-value mt-0.5">{value}</p>
        {hint && <p className="muted mt-0.5 text-[10px] leading-4">{hint}</p>}
      </div>
      {icon && (
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-[10px] border-2 border-[var(--line)] text-[#25251f] shadow-[2px_2px_0_var(--shadow-color)] ${
            tint === 'blue'
              ? 'bg-[color-mix(in_srgb,var(--blue)_55%,var(--surface))]'
              : tint === 'mint'
                ? 'bg-[color-mix(in_srgb,var(--mint)_55%,var(--surface))]'
                : tint === 'pink'
                  ? 'bg-[color-mix(in_srgb,var(--pink)_55%,var(--surface))]'
                  : tint === 'lavender'
                    ? 'bg-[color-mix(in_srgb,var(--lavender)_55%,var(--surface))]'
                    : 'bg-[color-mix(in_srgb,var(--yellow)_60%,var(--surface))]'
          }`}
        >
          {icon}
        </span>
      )}
    </div>
  );
}

export function PhaseBadge({ phase }: { phase: number }) {
  return <span className="badge">المرحلة {phase}</span>;
}
