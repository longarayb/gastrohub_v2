'use client';

import { Permission, type SectorDto, sectorLimitsError } from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Card } from '@app/ui/components/card';
import { ConfirmDialog } from '@app/ui/components/confirm-dialog';
import { Input } from '@app/ui/components/input';
import { Skeleton } from '@app/ui/components/misc';
import { toast } from '@app/ui/components/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChefHat, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DragHandle, SortableList } from '@/components/menu/sortable-list';
import { KdsDevicesCard } from '@/components/kds/devices-card';
import { EmptyState, Page } from '@/components/page';
import { apiDelete, apiPatch, apiPost, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { menuKeys, useInvalidateMenu, useSectors } from '@/lib/menu';

function SectorRow({ sector, canManage }: { sector: SectorDto; canManage: boolean }) {
  const invalidate = useInvalidateMenu();
  const [name, setName] = useState(sector.name);
  const [warn, setWarn] = useState(String(sector.warnAfterMinutes));
  const [late, setLate] = useState(String(sector.lateAfterMinutes));
  const [deleting, setDeleting] = useState(false);
  const limitsChanged =
    Number(warn) !== sector.warnAfterMinutes || Number(late) !== sector.lateAfterMinutes;

  const save = async (patch: Partial<SectorDto>) => {
    try {
      await apiPatch(`/menu/sectors/${sector.id}`, {
        name: patch.name ?? sector.name,
        isDefault: patch.isDefault ?? false,
        isActive: sector.isActive,
        warnAfterMinutes: patch.warnAfterMinutes ?? sector.warnAfterMinutes,
        lateAfterMinutes: patch.lateAfterMinutes ?? sector.lateAfterMinutes,
      });
      await invalidate();
      toast.success('Setor atualizado');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async () => {
    try {
      await apiDelete(`/menu/sectors/${sector.id}`);
      await invalidate();
      toast.success('Setor excluído');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex items-center gap-2 border-b bg-card px-2 py-2 last:border-b-0">
      {canManage && <DragHandle label={`Arrastar ${sector.name}`} />}
      <Input
        value={name}
        disabled={!canManage}
        onChange={(e) => setName(e.target.value)}
        className="max-w-xs"
        aria-label="Nome do setor"
      />
      {name !== sector.name && name.trim() && (
        <Button size="sm" onClick={() => save({ name })}>
          <Check /> Salvar
        </Button>
      )}
      <div className="flex-1" />
      <label
        className="flex items-center gap-1 text-xs text-muted-foreground"
        title="Tempo para o ticket ficar amarelo no KDS"
      >
        <span className="size-2 rounded-full bg-warning" aria-hidden />
        <Input
          type="number"
          min={1}
          value={warn}
          disabled={!canManage}
          aria-label={`Alerta amarelo de ${sector.name} (minutos)`}
          className="h-8 w-16"
          onChange={(e) => setWarn(e.target.value)}
        />
      </label>
      <label
        className="flex items-center gap-1 text-xs text-muted-foreground"
        title="Tempo para o ticket ficar vermelho no KDS"
      >
        <span className="size-2 rounded-full bg-destructive" aria-hidden />
        <Input
          type="number"
          min={2}
          value={late}
          disabled={!canManage}
          aria-label={`Alerta vermelho de ${sector.name} (minutos)`}
          className="h-8 w-16"
          onChange={(e) => setLate(e.target.value)}
        />
        min
      </label>
      {limitsChanged && (
        <Button
          size="sm"
          onClick={() => {
            const error = sectorLimitsError(Number(warn), Number(late));
            if (error) return toast.error(error);
            void save({ warnAfterMinutes: Number(warn), lateAfterMinutes: Number(late) });
          }}
        >
          <Check /> Salvar
        </Button>
      )}
      {sector.isDefault ? (
        <Badge>Setor padrão</Badge>
      ) : (
        canManage && (
          <Button variant="ghost" size="sm" onClick={() => save({ isDefault: true })}>
            <Star /> Tornar padrão
          </Button>
        )
      )}
      {canManage && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Excluir ${sector.name}`}
          onClick={() => setDeleting(true)}
        >
          <Trash2 />
        </Button>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Excluir setor?"
        description="Os produtos deste setor passam a usar o setor padrão. Setores que já receberam pedidos não podem ser excluídos: desative-os."
        confirmLabel="Excluir"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}

export default function SectorsPage() {
  const { can } = useAuth();
  const canManage = can(Permission.MENU_MANAGE);
  const canManageScreens = can(Permission.STORE_MANAGE);
  const invalidate = useInvalidateMenu();
  const queryClient = useQueryClient();
  const { data: sectors, isLoading } = useSectors();
  const [name, setName] = useState('');

  const create = async () => {
    if (!name.trim()) return;
    try {
      await apiPost('/menu/sectors', { name });
      setName('');
      await invalidate();
      toast.success('Setor criado');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const reorder = async (ids: string[]) => {
    const previous = sectors;
    queryClient.setQueryData<SectorDto[]>(menuKeys.sectors, (old) =>
      ids.map((id) => old!.find((s) => s.id === id)!),
    );
    try {
      await apiPost('/menu/sectors/reorder', { ids });
    } catch (error) {
      queryClient.setQueryData(menuKeys.sectors, previous);
      toast.error(errorMessage(error));
    }
  };

  return (
    <Page
      title="Setores de produção"
      description="Para onde cada item vai na cozinha: tela do KDS e impressão por setor (ex.: Cozinha, Bar, Pizzaria)"
      className="max-w-4xl"
    >
      {canManage && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do novo setor"
            aria-label="Nome do novo setor"
          />
          <Button type="submit">
            <Plus /> Adicionar
          </Button>
        </form>
      )}
      <Card className="gap-0 overflow-hidden py-0">
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : sectors?.length ? (
          <SortableList
            items={sectors}
            onReorder={reorder}
            disabled={!canManage}
            renderItem={(sector) => (
              <SectorRow
                key={`${sector.id}:${sector.name}`}
                sector={sector}
                canManage={canManage}
              />
            )}
          />
        ) : (
          <div className="p-6">
            <EmptyState
              icon={ChefHat}
              title="Nenhum setor"
              description="Crie setores como Cozinha, Bar e Pizzaria."
            />
          </div>
        )}
      </Card>
      {canManageScreens && sectors && <KdsDevicesCard sectors={sectors} />}
    </Page>
  );
}
