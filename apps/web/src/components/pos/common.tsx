'use client';

import { cn } from '@app/ui/lib/utils';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

/** Keyboard shortcut hint shown on buttons (F4, 1, Enter...). */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'rounded border bg-muted px-1 font-sans text-[10px] font-medium text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * QR Code drawn as SVG modules with the theme's QR tokens (always dark on light, which
 * scanners need), so it also prints on thermal paper.
 */
export function QrCode({
  value,
  className,
  label = 'QR Code PIX',
}: {
  value: string;
  className?: string;
  /** Accessible name (default: the PIX QR Code). */
  label?: string;
}) {
  const path = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    let d = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { d, size };
  }, [value]);
  const margin = 2;
  const view = path.size + margin * 2;
  return (
    <svg
      viewBox={`${-margin} ${-margin} ${view} ${view}`}
      className={cn('bg-qr-background text-qr-foreground', className)}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <path d={path.d} fill="currentColor" />
    </svg>
  );
}

/**
 * Browser printing (D012): renders `children` into a body-level `.print-area`, the only thing
 * the print stylesheet shows, and opens the print dialog once it is mounted.
 */
export function PrintPortal({
  children,
  onDone,
}: {
  children: React.ReactNode;
  /** Called after the print dialog closes. */
  onDone: () => void;
}) {
  const [node, setNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.createElement('div');
    el.className = 'print-area';
    document.body.appendChild(el);
    setNode(el);
    return () => el.remove();
  }, []);

  useEffect(() => {
    if (!node) return;
    const after = () => onDone();
    window.addEventListener('afterprint', after, { once: true });
    // Let the portal content render before opening the dialog.
    const timer = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', after);
    };
  }, [node, onDone]);

  return node
    ? createPortal(<div className="w-receipt font-mono text-xs">{children}</div>, node)
    : null;
}

/** One line of a receipt: label on the left, value on the right. */
export function ReceiptRow({
  label,
  value,
  strong,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className={cn('flex justify-between gap-2', strong && 'font-bold')}>
      <span>{label}</span>
      <span className="tabular text-right">{value}</span>
    </div>
  );
}

export function ReceiptDivider() {
  return <div className="my-1 border-t border-dashed border-current" />;
}
