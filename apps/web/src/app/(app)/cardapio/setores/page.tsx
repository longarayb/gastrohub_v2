'use client';

import { Permission, type SectorDto } from '@app/shared';
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
import { EmptyState, Page } from '@/components/page';
import { apiDelete, apiPatch, apiPost, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { menuKeys, useInvalidateMenu, useSectors } from '@/lib/menu';

function SectorRow({ sector, canManage }: { sector: SectorDto; canManage: boolean }) {
  const invalidate = useInvalidateMenu();
  const [name, setName] = useState(sector.name);
  const [deleting, setDeleting] = useState(false);

  const save = async (patch: Partial<SectorDto>) => {
    try {
      await apiPatch(`/menu/sectors/${sector.id}`, {
        name: patch.name ?? sector.name,
        isDefault: patch.isDefault ?? false,
        isActive: sector.isActive,
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
        description="Os produtos deste setor passam a usar o setor padrão."
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
      className="max-w-3xl"
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
    </Page>
  );
}
