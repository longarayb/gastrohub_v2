'use client';

import type { BusinessHour } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardFooter } from '@app/ui/components/card';
import { Skeleton } from '@app/ui/components/misc';
import { toast } from '@app/ui/components/sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ScheduleEditor } from '@/components/menu/menu-fields';
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

  return (
    <Page
      title="Horários de funcionamento"
      description="Defina os turnos de cada dia. Turnos que passam da meia-noite (ex.: 18:00 às 02:00) contam para o dia em que começam. O 'Acabou' do cardápio dura até o fim do último turno do dia."
    >
      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <Card>
          <CardContent>
            <ScheduleEditor value={hours} onChange={setHours} />
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
