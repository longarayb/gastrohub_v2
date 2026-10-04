'use client';

import { SALES_CHANNELS, SALES_CHANNEL_LABELS, type SalesChannel } from '@app/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { MenuProductCard, MenuProductDetails } from '@app/ui/components/menu-preview';
import { Skeleton } from '@app/ui/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { useState } from 'react';
import { useCatalog } from '@/lib/menu';

/**
 * Shows a product as the customer sees it (card + details), resolved by the API for the
 * selected channel: effective complements, prices and availability.
 */
export function ProductPreviewDialog({
  productId,
  onOpenChange,
}: {
  productId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [channel, setChannel] = useState<SalesChannel>('DIGITAL_MENU');
  const { data: catalog, isLoading } = useCatalog(channel, !!productId);
  const category = catalog?.categories.find((c) => c.products.some((p) => p.id === productId));
  const product = category?.products.find((p) => p.id === productId);

  return (
    <Dialog open={!!productId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pré-visualização</DialogTitle>
          <DialogDescription>Como o cliente vê este produto.</DialogDescription>
        </DialogHeader>
        <Select value={channel} onValueChange={(v) => setChannel(v as SalesChannel)}>
          <SelectTrigger aria-label="Canal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SALES_CHANNELS.map((c) => (
              <SelectItem key={c} value={c}>
                {SALES_CHANNEL_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isLoading ? (
          <Skeleton className="h-80" />
        ) : product && category ? (
          <div className="space-y-4">
            <MenuProductCard product={product} />
            <MenuProductDetails product={product} category={category} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Este produto não aparece no canal selecionado.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
