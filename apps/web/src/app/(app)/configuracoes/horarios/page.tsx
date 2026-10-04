'use client';

import { type BusinessHour, WEEKDAY_LABELS } from '@gastrohub/shared';
import { Button } from '@gastrohub/ui/components/button';
import { Card, CardContent, CardFooter } from '@gastrohub/ui/components/card';
import { Input } from '@gastrohub/ui/components/input';
import { Skeleton } from '@gastrohub/ui/components/misc';
import { toast } from '@gastrohub/ui/components/sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Page } from '@/components/page';
import { apiPut, errorMessage } from '@/lib/api';
import { storeKeys, useBusinessHours } from '@/lib/stores';

export default function BusinessHoursPage() {
  const { data, isLoading } = useBusinessHours();
  const [hours, setHours] = useState<BusinessHour[]>([]);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (data) setHours(data);
  }, [data]);

  const save = useMutation({
    mutationFn: () => apiPut<BusinessHour[]>('/stores/current/hours', { hours }),
    onSuccess: (saved) => {
      queryClient.setQueryData(storeKeys.hours, saved);
      toast.success('Horários salvos');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = (index: number, patch: Partial<BusinessHour>) =>
    setHours((prev) => prev.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  const add = (weekday: number) =>
    setHours((prev) => [...prev, { weekday, opensAt: '18:00', closesAt: '23:00' }]);
  const remove = (index: number) => setHours((prev) => prev.filter((_, i) => i !== index));
  const copyToAll = (weekday: number) => {
    const source = hours.filter((h) => h.weekday === weekday);
    setHours(WEEKDAY_LABELS.flatMap((_, day) => source.map((h) => ({ ...h, weekday: day }))));
  };

  return (
    <Page
      title="Horários de funcionamento"
      description="Defina os turnos de cada dia. Turnos que passam da meia-noite (ex.: 18:00 às 02:00) são permitidos."
    >
      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <Card>
          <CardContent className="divide-y">
            {WEEKDAY_LABELS.map((label, weekday) => {
              const shifts = hours
                .map((h, index) => ({ ...h, index }))
                .filter((h) => h.weekday === weekday);
              return (
                <div key={label} className="flex flex-col gap-3 py-4 md:flex-row md:items-start">
                  <div className="w-40 shrink-0 pt-2 font-medium">{label}</div>
                  <div className="flex flex-1 flex-col gap-2">
                    {shifts.length === 0 && (
                      <p className="pt-2 text-sm text-muted-foreground">Fechado</p>
                    )}
                    {shifts.map((shift) => (
                      <div key={shift.index} className="flex items-center gap-2">
                        <Input
                          type="time"
                          className="w-32"
                          value={shift.opensAt}
                          onChange={(e) => update(shift.index, { opensAt: e.target.value })}
                          aria-label="Abre às"
                        />
                        <span className="text-sm text-muted-foreground">até</span>
                        <Input
                          type="time"
                          className="w-32"
                          value={shift.closesAt}
                          onChange={(e) => update(shift.index, { closesAt: e.target.value })}
                          aria-label="Fecha às"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(shift.index)}
                          aria-label="Remover turno"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => add(weekday)}>
                      <Plus /> Turno
                    </Button>
                    {shifts.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => copyToAll(weekday)}>
                        <Copy /> Copiar para todos
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
          <CardFooter className="justify-end border-t">
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              Salvar horários
            </Button>
          </CardFooter>
        </Card>
      )}
    </Page>
  );
}
