'use client';

import {
  ROLE_LABELS,
  type Role,
  assignableRoles,
  createUserSchema,
  formatDateTime,
  formatPhone,
  updateUserSchema,
} from '@gastrohub/shared';
import { Badge } from '@gastrohub/ui/components/badge';
import { Button } from '@gastrohub/ui/components/button';
import { Card } from '@gastrohub/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gastrohub/ui/components/dialog';
import { Skeleton, Switch } from '@gastrohub/ui/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gastrohub/ui/components/select';
import { toast } from '@gastrohub/ui/components/sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gastrohub/ui/components/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Field, MaskedField, TextField, applyApiErrors, useZodForm } from '@/components/form';
import { Page } from '@/components/page';
import { apiGet, apiPatch, apiPost, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/auth';

interface StoreUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
}

const usersKey = ['users'] as const;

function RoleSelect({
  value,
  onChange,
  error,
}: {
  value: Role | undefined;
  onChange: (role: Role) => void;
  error?: string;
}) {
  const session = useSession();
  return (
    <Field label="Papel" error={error}>
      <Select value={value} onValueChange={(v) => onChange(v as Role)}>
        <SelectTrigger>
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent>
          {assignableRoles(session.role).map((role) => (
            <SelectItem key={role} value={role}>
              {ROLE_LABELS[role]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(createUserSchema, {
    name: '',
    email: '',
    phone: '',
    role: 'WAITER',
    password: '',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await apiPost('/users', values);
      await queryClient.invalidateQueries({ queryKey: usersKey });
      toast.success('Usuário adicionado');
      form.reset();
      onOpenChange(false);
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo usuário</DialogTitle>
          <DialogDescription>
            Se o e-mail já tiver conta no GastroHub, ele ganha acesso a esta unidade.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <TextField control={form.control} name="name" label="Nome" autoFocus />
          <TextField control={form.control} name="email" label="E-mail" type="email" />
          <MaskedField
            control={form.control}
            name="phone"
            label="Celular (opcional)"
            mask="phone"
          />
          <Controller
            control={form.control}
            name="role"
            render={({ field, fieldState }) => (
              <RoleSelect
                value={field.value as Role}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <TextField
            control={form.control}
            name="password"
            label="Senha inicial"
            type="password"
            autoComplete="new-password"
            hint="O usuário pode trocar depois"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose }: { user: StoreUser; onClose: () => void }) {
  const queryClient = useQueryClient();
  const session = useSession();
  const canChangeRole = assignableRoles(session.role).includes(user.role);
  const form = useZodForm(updateUserSchema, {
    name: user.name,
    phone: user.phone ? formatPhone(user.phone) : '',
    role: user.role,
    isActive: user.isActive,
    password: '',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await apiPatch(`/users/${user.id}`, values);
      await queryClient.invalidateQueries({ queryKey: usersKey });
      toast.success('Usuário atualizado');
      onClose();
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <TextField control={form.control} name="name" label="Nome" />
          <MaskedField control={form.control} name="phone" label="Celular" mask="phone" />
          {canChangeRole && (
            <Controller
              control={form.control}
              name="role"
              render={({ field, fieldState }) => (
                <RoleSelect
                  value={field.value as Role}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
          )}
          <TextField
            control={form.control}
            name="password"
            label="Nova senha (opcional)"
            type="password"
            autoComplete="new-password"
          />
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <label className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm font-medium">Acesso ativo</span>
                <Switch checked={!!field.value} onCheckedChange={field.onChange} />
              </label>
            )}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StoreUser | null>(null);
  const { data: users, isLoading } = useQuery({
    queryKey: usersKey,
    queryFn: () => apiGet<StoreUser[]>('/users'),
  });

  return (
    <Page
      title="Usuários"
      description="Quem tem acesso a esta unidade e com qual papel"
      actions={
        <Button onClick={() => setCreating(true)}>
          <UserPlus /> Novo usuário
        </Button>
      }
    >
      <Card className="py-0">
        {isLoading ? (
          <Skeleton className="h-60" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead className="hidden md:table-cell">Último acesso</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <p className="font-medium">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Nunca'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? 'success' : 'outline'}>
                      {user.isActive ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditing(user)}
                      aria-label="Editar"
                    >
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      {editing && <EditUserDialog user={editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}
