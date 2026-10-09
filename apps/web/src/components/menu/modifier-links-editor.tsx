'use client';

import type { ModifierGroupDto, ModifierLinkDto, ModifierLinkInput } from '@app/shared';
import { validateLinkLimits } from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Input } from '@app/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { ArrowDown, ArrowUp, EyeOff, Pencil, RotateCcw, Trash2 } from 'lucide-react';

type Link = Required<ModifierLinkInput>;

function LimitsInputs({
  link,
  onChange,
}: {
  link: Link;
  onChange: (patch: Partial<Link>) => void;
}) {
  const error = validateLinkLimits(link.minSelect, link.maxSelect);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-1">
        mín.
        <Input
          type="number"
          min={0}
          className="h-8 w-16"
          value={link.minSelect}
          onChange={(e) => onChange({ minSelect: Number(e.target.value) })}
        />
      </label>
      <label className="flex items-center gap-1">
        máx.
        <Input
          type="number"
          min={1}
          className="h-8 w-16"
          value={link.maxSelect}
          onChange={(e) => onChange({ maxSelect: Number(e.target.value) })}
        />
      </label>
      {link.minSelect > 0 ? (
        <Badge>Obrigatório</Badge>
      ) : (
        <Badge variant="secondary">Opcional</Badge>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

/**
 * Edits modifier links of a category or product. For products, `inherited` lists the
 * category links, which can be customized (override) or switched off (isDisabled).
 */
export function ModifierLinksEditor({
  value,
  onChange,
  groups,
  inherited = [],
}: {
  value: ModifierLinkInput[];
  onChange: (value: Link[]) => void;
  groups: ModifierGroupDto[];
  inherited?: ModifierLinkDto[];
}) {
  const links: Link[] = value.map((l) => ({
    groupId: l.groupId,
    minSelect: l.minSelect ?? 0,
    maxSelect: l.maxSelect ?? 1,
    isDisabled: l.isDisabled ?? false,
  }));
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? 'Grupo removido';
  const inheritedIds = new Set(inherited.map((l) => l.groupId));
  const used = new Set([...links.map((l) => l.groupId), ...inheritedIds]);
  const available = groups.filter((g) => !used.has(g.id));

  const update = (index: number, patch: Partial<Link>) =>
    onChange(links.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const remove = (groupId: string) => onChange(links.filter((l) => l.groupId !== groupId));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= links.length) return;
    const next = [...links];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  const ownLinks = links
    .map((link, index) => ({ link, index }))
    .filter(({ link }) => !link.isDisabled);
  const inheritedRows = inherited.map((l) => ({
    inheritedLink: l,
    override: links.find((own) => own.groupId === l.groupId),
  }));

  return (
    <div className="space-y-3">
      {inheritedRows.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase">
            Herdados da categoria
          </p>
          {inheritedRows.map(({ inheritedLink, override }) => {
            const disabled = override?.isDisabled;
            return (
              <div
                key={inheritedLink.groupId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3"
              >
                <div className={disabled ? 'opacity-50' : ''}>
                  <p className="text-sm font-medium">{inheritedLink.groupName}</p>
                  <p className="text-xs text-muted-foreground">
                    {disabled
                      ? 'Desligado neste produto'
                      : override
                        ? 'Personalizado neste produto (veja abaixo)'
                        : `mín. ${inheritedLink.minSelect} · máx. ${inheritedLink.maxSelect}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {override ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(inheritedLink.groupId)}
                    >
                      <RotateCcw /> Usar o da categoria
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onChange([
                            ...links,
                            {
                              groupId: inheritedLink.groupId,
                              minSelect: inheritedLink.minSelect,
                              maxSelect: inheritedLink.maxSelect,
                              isDisabled: false,
                            },
                          ])
                        }
                      >
                        <Pencil /> Personalizar
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onChange([
                            ...links,
                            {
                              groupId: inheritedLink.groupId,
                              minSelect: 0,
                              maxSelect: 1,
                              isDisabled: true,
                            },
                          ])
                        }
                      >
                        <EyeOff /> Desligar
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {ownLinks.length > 0 && (
        <div className="space-y-2">
          {inherited.length > 0 && (
            <p className="text-xs font-medium text-muted-foreground uppercase">Deste produto</p>
          )}
          {ownLinks.map(({ link, index }) => (
            <div
              key={link.groupId}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <div className="flex flex-col">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => move(index, -1)}
                  aria-label="Subir"
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => move(index, 1)}
                  aria-label="Descer"
                >
                  <ArrowDown />
                </Button>
              </div>
              <div className="min-w-40 flex-1">
                <p className="text-sm font-medium">{groupName(link.groupId)}</p>
                {inheritedIds.has(link.groupId) && (
                  <p className="text-xs text-muted-foreground">Sobrepõe o vínculo da categoria</p>
                )}
              </div>
              <LimitsInputs link={link} onChange={(patch) => update(index, patch)} />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(link.groupId)}
                aria-label="Remover grupo"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}

      {available.length > 0 ? (
        <Select
          value=""
          onValueChange={(groupId) =>
            onChange([...links, { groupId, minSelect: 0, maxSelect: 1, isDisabled: false }])
          }
        >
          {/* The placeholder alone does not name the button (axe). */}
          <SelectTrigger className="w-full sm:w-72" aria-label="Adicionar grupo de complementos">
            <SelectValue placeholder="+ Adicionar grupo de complementos" />
          </SelectTrigger>
          <SelectContent>
            {available.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum grupo cadastrado. Crie grupos em Cardápio › Complementos.
          </p>
        )
      )}
    </div>
  );
}
