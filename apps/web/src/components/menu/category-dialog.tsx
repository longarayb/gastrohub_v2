'use client';

import {
  type BusinessHour,
  type CategoryDto,
  type ModifierLinkInput,
  SALES_CHANNELS,
  type SalesChannel,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Input } from '@app/ui/components/input';
import { Label } from '@app/ui/components/label';
import { Switch } from '@app/ui/components/misc';
import { toast } from '@app/ui/components/sonner';
import { Textarea } from '@app/ui/components/textarea';
import { cn } from '@app/ui/lib/utils';
import { ArrowDown, ArrowUp, Pizza, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';
import { apiPatch, apiPost, apiPut, errorMessage } from '@/lib/api';
import { useInvalidateMenu, useModifierGroups } from '@/lib/menu';
import { ChannelsField, ScheduleEditor } from './menu-fields';
import { ModifierLinksEditor } from './modifier-links-editor';

interface SizeRow {
  id?: string;
  name: string;
  maxFlavors: number;
  slices: number | null;
}

const DEFAULT_PIZZA_SIZES: SizeRow[] = [
  { name: 'Broto', maxFlavors: 1, slices: 4 },
  { name: 'Média', maxFlavors: 2, slices: 6 },
  { name: 'Grande', maxFlavors: 3, slices: 8 },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-t pt-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function CategoryDialog({
  category,
  open,
  onOpenChange,
}: {
  /** null = create */
  category: CategoryDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invalidate = useInvalidateMenu();
  const { data: groups = [] } = useModifierGroups();
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [kind, setKind] = useState<'STANDARD' | 'PIZZA'>(category?.kind ?? 'STANDARD');
  const [channels, setChannels] = useState<SalesChannel[]>(
    category?.channels ?? [...SALES_CHANNELS],
  );
  const [limitSchedule, setLimitSchedule] = useState((category?.schedules.length ?? 0) > 0);
  const [schedules, setSchedules] = useState<BusinessHour[]>(category?.schedules ?? []);
  const [links, setLinks] = useState<ModifierLinkInput[]>(category?.modifierLinks ?? []);
  const [sizes, setSizes] = useState<SizeRow[]>(
    category?.sizes.length ? category.sizes : DEFAULT_PIZZA_SIZES,
  );
  const [saving, setSaving] = useState(false);
  const kindLocked = !!category && category.productCount > 0;

  const updateSize = (index: number, patch: Partial<SizeRow>) =>
    setSizes((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const moveSize = (index: number, delta: number) =>
    setSizes((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        name,
        description,
        kind,
        channels,
        schedules: limitSchedule ? schedules : [],
        modifierLinks: links,
      };
      const saved = category
        ? await apiPatch<CategoryDto>(`/menu/categories/${category.id}`, body)
        : await apiPost<CategoryDto>('/menu/categories', body);
      if (kind === 'PIZZA') {
        await apiPut(`/menu/categories/${saved.id}/sizes`, {
          sizes: sizes.map((s) => ({ ...s, slices: s.slices || null })),
        });
      }
      await invalidate();
      toast.success(category ? 'Categoria atualizada' : 'Categoria criada');
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{category ? 'Editar categoria' : 'Nova categoria'}</DialogTitle>
          <DialogDescription>
            Complementos vinculados aqui valem para todos os produtos da categoria.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="category-name">Nome</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="category-description">Descrição (opcional)</Label>
            <Textarea
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid gap-2">
            <Label>Tipo</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['STANDARD', UtensilsCrossed, 'Itens', 'Lanches, pratos, bebidas, sobremesas'],
                  ['PIZZA', Pizza, 'Pizza', 'Tamanhos com até N sabores e borda'],
                ] as const
              ).map(([value, Icon, title, text]) => (
                <button
                  key={value}
                  type="button"
                  disabled={kindLocked}
                  onClick={() => setKind(value)}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 text-left disabled:cursor-not-allowed disabled:opacity-60',
                    kind === value && 'border-primary bg-primary/5',
                  )}
                >
                  <Icon className="mt-0.5 size-5 text-primary" />
                  <span>
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="text-xs text-muted-foreground">{text}</span>
                  </span>
                </button>
              ))}
            </div>
            {kindLocked && (
              <p className="text-xs text-muted-foreground">
                O tipo não pode mudar enquanto a categoria tiver produtos.
              </p>
            )}
          </div>

          {kind === 'PIZZA' && (
            <Section
              title="Tamanhos"
              description="Compartilhados por todos os sabores. O preço de cada sabor por tamanho é definido no sabor."
            >
              {sizes.map((size, index) => (
                <div key={size.id ?? index} className="flex flex-wrap items-center gap-2">
                  <div className="flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => moveSize(index, -1)}
                      aria-label="Subir"
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => moveSize(index, 1)}
                      aria-label="Descer"
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                  <Input
                    className="w-40"
                    value={size.name}
                    onChange={(e) => updateSize(index, { name: e.target.value })}
                    aria-label="Nome do tamanho"
                  />
                  <label className="flex items-center gap-1 text-sm">
                    até
                    <Input
                      type="number"
                      min={1}
                      max={8}
                      className="w-16"
                      value={size.maxFlavors}
                      onChange={(e) => updateSize(index, { maxFlavors: Number(e.target.value) })}
                    />
                    sabores
                  </label>
                  <label className="flex items-center gap-1 text-sm">
                    <Input
                      type="number"
                      min={1}
                      className="w-16"
                      value={size.slices ?? ''}
                      onChange={(e) =>
                        updateSize(index, {
                          slices: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    />
                    fatias
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setSizes((prev) => prev.filter((_, i) => i !== index))}
                    aria-label="Remover tamanho"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSizes((prev) => [...prev, { name: '', maxFlavors: 1, slices: null }])
                }
              >
                <Plus /> Tamanho
              </Button>
              {category && (
                <p className="text-xs text-muted-foreground">
                  Remover um tamanho apaga os preços dos sabores nesse tamanho. Pedidos antigos não
                  mudam.
                </p>
              )}
            </Section>
          )}

          <Section
            title={kind === 'PIZZA' ? 'Complementos da pizza' : 'Complementos'}
            description={
              kind === 'PIZZA'
                ? 'Aplicados uma vez por pizza (ex.: borda), com preço por tamanho definido no grupo.'
                : 'Herdados por todos os produtos; cada produto pode personalizar ou desligar.'
            }
          >
            <ModifierLinksEditor value={links} onChange={setLinks} groups={groups} />
          </Section>

          <Section title="Onde vender">
            <ChannelsField value={channels} onChange={setChannels} />
          </Section>

          <Section title="Quando vender">
            <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <span>
                <span className="block text-sm font-medium">Somente em horários específicos</span>
                <span className="text-xs text-muted-foreground">
                  Ex.: almoço executivo de segunda a sexta, 11:00 às 15:00. Desligado = todo o
                  horário da loja.
                </span>
              </span>
              <Switch checked={limitSchedule} onCheckedChange={setLimitSchedule} />
            </label>
            {limitSchedule && (
              <ScheduleEditor value={schedules} onChange={setSchedules} emptyLabel="Não vende" />
            )}
          </Section>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={save} loading={saving}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
