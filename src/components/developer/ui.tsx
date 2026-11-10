import type { ReactNode } from 'react';
import { Alert, Spinner } from '../ui.tsx';

export function DevHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="dev-page-head">
      <div className="min-w-0">
        {eyebrow && <p className="dev-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="dev-page-actions">{actions}</div>}
    </div>
  );
}

export function Kpi({
  label,
  value,
  hint,
  icon,
  tone = 'blue',
  delta,
  danger,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: 'blue' | 'mint' | 'pink' | 'yellow' | 'lavender';
  delta?: number | null;
  danger?: boolean;
}) {
  return (
    <div className={`dev-kpi dev-tone-${tone} ${danger ? 'is-danger' : ''}`}>
      <div className="dev-kpi-top">
        <span>{label}</span>
        {icon && <i>{icon}</i>}
      </div>
      <strong>{value}</strong>
      <div className="dev-kpi-foot">
        {delta !== undefined && delta !== null && (
          <span className={delta >= 0 ? 'is-up' : 'is-down'}>
            {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}%
          </span>
        )}
        {hint && <span>{hint}</span>}
      </div>
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`dev-panel ${className}`}>
      {(title || subtitle || action) && (
        <div className="dev-panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusBadge({
  tone,
  children,
  dot = false,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted';
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`dev-badge dev-badge-${tone}`}>
      {dot && <i />}
      {children}
    </span>
  );
}

export function LoadingBlock({ label = 'جار تحميل البيانات…' }: { label?: string }) {
  return (
    <div className="dev-loading">
      <Spinner className="size-5" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyBlock({ title, body, icon }: { title: string; body?: string; icon?: ReactNode }) {
  return (
    <div className="dev-empty">
      {icon && <i>{icon}</i>}
      <strong>{title}</strong>
      {body && <p>{body}</p>}
    </div>
  );
}

export function DevError({ children }: { children: ReactNode }) {
  return <Alert>{children}</Alert>;
}

export function Pager({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) {
    return <p className="dev-pager-note">إجمالي {total}</p>;
  }
  return (
    <div className="dev-pager">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        السابق
      </button>
      <span>
        صفحة {page} من {pages} · {total} سجل
      </span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        التالي
      </button>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="dev-switch"
      data-on={checked}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function DevTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: string; label: string; count?: number }>;
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="dev-segment" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={active === tab.key ? 'is-active' : ''}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.count !== undefined && <b>{tab.count}</b>}
        </button>
      ))}
    </div>
  );
}
