'use client';

import {
  ACTION_STATUS_LABELS,
  DECISION_STATUS_LABELS,
  SIGNIFICANCE_LABELS,
  type ActionStatus,
  type DecisionStatus,
  type DecisionSignificance,
  type Priority,
  type RiskLevel,
} from '@tda/shared';
import { cn } from '@/lib/utils';

/**
 * Status vocabulary.
 *
 * Status earns a hairline and a word, not a coloured pill. Only four tones
 * exist, and they always mean the same thing: red needs attention now, amber is
 * waiting on someone, green is settled, blue is live work in hand.
 */
export type Tone = 'alert' | 'warn' | 'good' | 'open' | 'neutral';

export const DECISION_TONE: Record<DecisionStatus, Tone> = {
  draft: 'neutral',
  submitted: 'open',
  under_analysis: 'open',
  ready_for_review: 'open',
  under_tda_review: 'warn',
  more_information_required: 'warn',
  approved: 'good',
  approved_with_conditions: 'good',
  rejected: 'alert',
  deferred: 'warn',
  escalated: 'alert',
  implementation: 'open',
  implemented: 'good',
  closed: 'neutral',
  withdrawn: 'neutral',
  superseded: 'neutral',
};

export const ACTION_TONE: Record<ActionStatus, Tone> = {
  not_started: 'open',
  in_progress: 'open',
  blocked: 'alert',
  complete: 'good',
  cancelled: 'neutral',
};

const BORDER: Record<Tone, string> = {
  alert: 'border-l-alert',
  warn: 'border-l-warn',
  good: 'border-l-good',
  open: 'border-l-blueprint',
  neutral: 'border-l-rule',
};

const TEXT: Record<Tone, string> = {
  alert: 'text-alert',
  warn: 'text-warn',
  good: 'text-good',
  open: 'text-blueprint',
  neutral: 'text-ink-muted',
};

const DOT: Record<Tone, string> = {
  alert: 'bg-alert',
  warn: 'bg-warn',
  good: 'bg-good',
  open: 'bg-blueprint',
  neutral: 'bg-ink-faint',
};

/** A table cell that carries the status as a left-edge rule. */
export function SignalCell({
  tone,
  className,
  children,
}: {
  tone: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return <td className={cn('signal', BORDER[tone], className)}>{children}</td>;
}

/** Inline status: a small dot and the word. No pill, no background. */
export function StatusLabel({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[tone])} aria-hidden />
      <span className={tone === 'neutral' ? 'text-ink-muted' : TEXT[tone]}>{children}</span>
    </span>
  );
}

export function DecisionStatusLabel({ status }: { status: DecisionStatus }) {
  return <StatusLabel tone={DECISION_TONE[status]}>{DECISION_STATUS_LABELS[status]}</StatusLabel>;
}

export function ActionStatusLabel({ status }: { status: ActionStatus }) {
  return <StatusLabel tone={ACTION_TONE[status]}>{ACTION_STATUS_LABELS[status]}</StatusLabel>;
}

export function riskTone(level: RiskLevel | null | undefined): Tone {
  if (level === 'critical' || level === 'high') return 'alert';
  if (level === 'medium') return 'warn';
  if (level === 'low' || level === 'very_low') return 'neutral';
  return 'neutral';
}

export function priorityTone(priority: Priority): Tone {
  if (priority === 'urgent') return 'alert';
  if (priority === 'high') return 'warn';
  return 'neutral';
}

/**
 * The decision reference. Monospace is reserved for this one thing across the
 * whole interface, because a reference is an identifier people read character
 * by character and quote to each other.
 */
export function Reference({
  children,
  className,
  size = 'sm',
}: {
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      className={cn(
        'font-mono font-medium tracking-tight text-ink',
        size === 'sm' && 'text-xs',
        size === 'md' && 'text-sm',
        size === 'lg' && 'text-lg',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Significance as a four-step gauge — a level is a magnitude, so show it as one. */
export function SignificanceGauge({
  significance,
  showLabel = true,
}: {
  significance: DecisionSignificance;
  showLabel?: boolean;
}) {
  const levels: DecisionSignificance[] = ['routine', 'significant', 'major', 'critical'];
  const index = levels.indexOf(significance);
  const tone: Tone = index >= 3 ? 'alert' : index === 2 ? 'warn' : 'open';

  return (
    <span className="inline-flex items-center gap-2" title={SIGNIFICANCE_LABELS[significance]}>
      <span className="flex gap-[2px]" aria-hidden>
        {levels.map((_, i) => (
          <span
            key={i}
            className={cn('h-3 w-[3px]', i <= index ? DOT[tone] : 'bg-rule')}
          />
        ))}
      </span>
      {showLabel ? (
        <span className="text-sm text-ink">
          {SIGNIFICANCE_LABELS[significance].replace(/^Level \d+ — /, '')}
        </span>
      ) : null}
      <span className="sr-only">{SIGNIFICANCE_LABELS[significance]}</span>
    </span>
  );
}

/** A due date that says how it is going, not just when it is. */
export function DueDate({ date, daysLeft }: { date: string | null; daysLeft: number | null }) {
  if (!date) return <span className="text-ink-muted">No date set</span>;

  const formatted = new Date(`${date.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });

  if (daysLeft === null) return <span>{formatted}</span>;
  if (daysLeft < 0) {
    return (
      <span className="font-medium text-alert">
        {formatted} · {Math.abs(daysLeft)}d overdue
      </span>
    );
  }
  if (daysLeft === 0) return <span className="font-medium text-warn">{formatted} · today</span>;
  if (daysLeft <= 7) return <span className="text-warn">{formatted} · {daysLeft}d</span>;
  return <span>{formatted}</span>;
}
