import { useEffect, useState } from 'react';
import {
  BookMarked,
  BookOpen,
  Calculator,
  CalendarDays,
  ClipboardCheck,
  GraduationCap,
  Languages,
  ListChecks,
  MessagesSquare,
  PenLine,
  Search,
  Sparkles,
  Trophy,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { Alert, FullPageLoader, PageHeader, PhaseBadge } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import type { Feature } from '../lib/types.ts';

const tints: Record<string, string> = {
  books: '--blue',
  summary: '--lavender',
  tests: '--mint',
  'question-bank': '--yellow',
  'ai-chat': '--pink',
  teacher: '--lavender',
  solver: '--blue',
  grader: '--mint',
  schedule: '--pink',
  expression: '--yellow',
  'english-grammar': '--blue',
  'arabic-grammar': '--mint',
  'daily-challenge': '--yellow',
  'global-search': '--lavender',
  notifications: '--mint',
};

const icons: Record<string, LucideIcon> = {
  books: BookOpen,
  summary: Sparkles,
  tests: ListChecks,
  'question-bank': BookMarked,
  'ai-chat': MessagesSquare,
  teacher: GraduationCap,
  solver: Calculator,
  grader: ClipboardCheck,
  schedule: CalendarDays,
  expression: PenLine,
  'english-grammar': Languages,
  'arabic-grammar': PenLine,
  'daily-challenge': Trophy,
  'global-search': Search,
  notifications: MessagesSquare,
};

export default function ToolsPage() {
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ features: Feature[] }>('/features')
      .then((data) => {
        if (!cancelled) setFeatures(data.features);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الأدوات.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!features) {
    return (
      <AppShell>
        {error ? <Alert>{error}</Alert> : <FullPageLoader label="جار تحميل الأدوات…" />}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="أدوات الدراسة"
        subtitle="كل أداة تظهر بحالتها الحقيقية: متاحة فقط بعد بنائها واختبارها فعليًا."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {features.map((feature) => {
          const Icon = icons[feature.key] ?? Sparkles;
          const tint = tints[feature.key] ?? '--yellow';
          return (
            <div
              key={feature.key}
              className="card card-hover feature-tile flex flex-col gap-3 p-4"
              data-available={feature.enabled}
              style={{ '--tile': `var(${tint})` } as CSSProperties}
            >
              <div className="flex items-start gap-3">
                <span className="feature-icon">
                  <Icon size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{feature.title}</p>
                    <span className={`badge shrink-0 ${feature.enabled ? 'badge-mint' : ''}`}>
                      {feature.enabled ? 'متاحة' : feature.maintenanceMessage ? 'صيانة' : 'قيد البناء'}
                    </span>
                  </div>
                  <p className="muted mt-1 text-xs leading-6">{feature.description}</p>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between gap-2">
                <PhaseBadge phase={feature.phase} />
                {feature.enabled && feature.href ? (
                  <a href={feature.href} className="btn btn-soft btn-sm">
                    فتح الأداة
                  </a>
                ) : (
                  <span className="muted max-w-[70%] text-[11px] leading-5">
                    {feature.maintenanceMessage ?? 'لم تُبنَ هذه الأداة بعد'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
