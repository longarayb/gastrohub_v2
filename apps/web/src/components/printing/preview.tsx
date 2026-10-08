'use client';

import { type PaperWidth, type PrintDocument, renderText } from '@app/shared';
import { Skeleton } from '@app/ui/components/misc';
import { cn } from '@app/ui/lib/utils';
import { usePrintPreview } from '@/lib/printing';

/** What goes to the paper, as the printer would print it (same text the agent encodes). */
export function PaperPreview({
  document,
  paperWidth,
  className,
}: {
  document: PrintDocument;
  paperWidth: number;
  className?: string;
}) {
  const lines = renderText(document, (paperWidth === 58 ? 58 : 80) as PaperWidth);
  return (
    <pre
      aria-label={`Prévia: ${document.title}`}
      className={cn(
        'overflow-x-auto rounded-md border bg-qr-background p-3 font-mono text-xs leading-snug text-qr-foreground',
        className,
      )}
    >
      {lines.join('\n')}
    </pre>
  );
}

export function JobPreview({ jobId }: { jobId: string }) {
  const { data, isLoading } = usePrintPreview(jobId);
  if (isLoading || !data) return <Skeleton className="h-40" />;
  return <PaperPreview document={data.document} paperWidth={data.paperWidth} />;
}
