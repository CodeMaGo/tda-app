'use client';

import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

type Tone = 'good' | 'alert' | 'info';

interface Toast {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
}

interface ToastApi {
  /** Confirmation uses the past tense of the action: "Publish" produces "Published". */
  confirm: (title: string, description?: string) => void;
  problem: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const Context = React.createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = React.useCallback(
    (tone: Tone, title: string, description?: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, title, description }]);
      // Problems stay put; the person may need to read them twice.
      if (tone !== 'alert') setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const api = React.useMemo<ToastApi>(
    () => ({
      confirm: (title, description) => push('good', title, description),
      problem: (title, description) => push('alert', title, description),
      info: (title, description) => push('info', title, description),
    }),
    [push],
  );

  return (
    <Context.Provider value={api}>
      {children}
      <div
        className="no-print pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex animate-slide-up items-start gap-3 border border-rule border-l-[3px] bg-paper px-4 py-3 shadow-raised',
              toast.tone === 'good' && 'border-l-good',
              toast.tone === 'alert' && 'border-l-alert',
              toast.tone === 'info' && 'border-l-blueprint',
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{toast.title}</p>
              {toast.description ? (
                <p className="mt-0.5 text-sm text-ink-muted">{toast.description}</p>
              ) : null}
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="text-ink-faint hover:text-ink"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Context.Provider>
  );
}

export function useToast(): ToastApi {
  const value = React.useContext(Context);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
