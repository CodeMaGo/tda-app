'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 whitespace-nowrap',
  {
    variants: {
      variant: {
        // One primary action per screen. Everything else is quieter.
        primary: 'bg-blueprint text-white hover:bg-blueprint-dark',
        secondary: 'border border-rule bg-paper text-ink hover:bg-wash',
        ghost: 'text-ink-muted hover:bg-wash hover:text-ink',
        danger: 'bg-alert text-white hover:bg-alert/90',
        link: 'text-blueprint underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-6 text-base',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? <Spinner /> : null}
        {children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Field wrapper                                                       */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
        {required ? <span className="ml-1 text-alert">*</span> : null}
      </label>
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

const fieldStyles =
  'w-full rounded-sm border border-rule bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint disabled:bg-wash disabled:text-ink-muted aria-[invalid=true]:border-alert';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldStyles, 'h-9', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 4, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={cn(fieldStyles, 'resize-y leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(fieldStyles, 'h-9 pr-8', className)} {...props}>
    {children}
  </select>
));
Select.displayName = 'Select';

/* ------------------------------------------------------------------ */
/* Multi-select                                                        */
/* ------------------------------------------------------------------ */

/**
 * Checkbox list rather than a tag combobox. Decision forms pick from short,
 * known sets (teams, technologies, colleagues) where seeing every option at
 * once is faster than typing to filter.
 */
export function CheckboxGroup({
  options,
  value,
  onChange,
  columns = 2,
  emptyMessage = 'Nothing to choose from yet.',
}: {
  options: { value: string; label: string; hint?: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  columns?: 1 | 2 | 3;
  emptyMessage?: string;
}) {
  if (options.length === 0) {
    return <p className="text-sm text-ink-muted">{emptyMessage}</p>;
  }

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div
      className={cn(
        'grid gap-x-5 gap-y-1.5',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
      )}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-start gap-2 py-0.5 text-sm text-ink"
        >
          <input
            type="checkbox"
            checked={value.includes(option.value)}
            onChange={() => toggle(option.value)}
            className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-blueprint"
          />
          <span>
            {option.label}
            {option.hint ? (
              <span className="ml-1.5 text-xs text-ink-muted">{option.hint}</span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'alert' | 'good';
  title?: string;
  children: React.ReactNode;
}) {
  const tones = {
    info: 'border-l-blueprint bg-blueprint-wash',
    warn: 'border-l-warn bg-warn-wash',
    alert: 'border-l-alert bg-alert-wash',
    good: 'border-l-good bg-good-wash',
  } as const;

  return (
    <div className={cn('border border-rule border-l-[3px] px-4 py-3 text-sm', tones[tone])}>
      {title ? <p className="mb-1 font-semibold text-ink">{title}</p> : null}
      <div className="text-ink">{children}</div>
    </div>
  );
}

/**
 * Empty states are an invitation to act, not an apology. Each one names the
 * next step rather than saying "no data found".
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="border border-dashed border-rule bg-paper px-6 py-10 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-prose text-sm text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-rule/60', className)} aria-hidden />;
}
