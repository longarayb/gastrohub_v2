import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../lib/utils';

const TONES = {
  info: { bar: 'border-accent-blue', icon: 'text-accent-blue', Icon: Info },
  attention: { bar: 'border-signal-attention', icon: 'text-signal-attention', Icon: TriangleAlert },
  critical: { bar: 'border-signal-critical', icon: 'text-signal-critical', Icon: CircleAlert },
  success: { bar: 'border-signal-positive', icon: 'text-signal-positive', Icon: CircleCheck },
} as const;

export type NoticeTone = keyof typeof TONES;

/**
 * Notice on a page or dialog (information, attention, error, success): text in full contrast,
 * the tone on the 4 px bar and the icon (never color alone). `role="alert"` for errors that
 * appear after an action; the default is a polite status.
 */
export function Notice({
  tone = 'info',
  title,
  icon,
  role,
  className,
  children,
}: {
  tone?: NoticeTone;
  title?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  role?: 'alert' | 'status' | 'note';
  className?: string;
  children?: React.ReactNode;
}) {
  const style = TONES[tone];
  const Icon = icon ?? style.Icon;
  return (
    <div
      role={role ?? 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border-l-4 bg-muted p-3 text-sm text-foreground',
        style.bar,
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', style.icon)} aria-hidden />
      <div className="min-w-0 space-y-0.5">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={cn(title && 'text-muted-foreground')}>{children}</div>}
      </div>
    </div>
  );
}
