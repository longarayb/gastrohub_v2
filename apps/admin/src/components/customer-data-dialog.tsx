'use client';

import { type CustomerDetailDto, customerDataSchema, formatCEP, formatPhone } from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { toast } from '@app/ui/components/sonner';
import { MaskedField, TextField, applyApiErrors, useZodForm } from '@/components/form';
import { apiPut, errorMessage } from '@/lib/api';
import { useRefresh } from '@/lib/queries';

/** Edits the organization data used for billing and the service invoice (NFS-e). */
export function CustomerDataDialog({
  customer,
  onOpenChange,
}: {
  customer: CustomerDetailDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!customer} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {/* Mounted with the data already in hand (form defaults, not a reset in an effect). */}
        {customer && <CustomerDataForm customer={customer} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CustomerDataForm({
  customer,
  onDone,
}: {
  customer: CustomerDetailDto;
  onDone: () => void;
}) {
  const refresh = useRefresh();
  const form = useZodForm(customerDataSchema, {
    name: customer.name,
    document: customer.document ?? '',
    legalName: customer.legalName ?? '',
    municipalRegistration: customer.municipalRegistration ?? '',
    invoiceEmail: customer.invoiceEmail ?? '',
    contactName: customer.contactName ?? '',
    contactEmail: customer.contactEmail ?? '',
    contactPhone: customer.contactPhone ? formatPhone(customer.contactPhone) : '',
    address: {
      cep: customer.address?.cep ? formatCEP(customer.address.cep) : '',
      street: customer.address?.street ?? '',
      number: customer.address?.number ?? '',
      complement: customer.address?.complement ?? '',
      neighborhood: customer.address?.neighborhood ?? '',
      city: customer.address?.city ?? '',
      state: customer.address?.state ?? '',
    },
    notes: customer.notes ?? '',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await apiPut(`/customers/${customer.id}`, values);
      await refresh();
      toast.success('Dados do cliente salvos');
      onDone();
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Dados do cliente</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="name" label="Nome do cliente" />
        <MaskedField control={form.control} name="document" label="CNPJ ou CPF" mask="document" />
        <TextField control={form.control} name="legalName" label="Razão social ou nome completo" />
        <TextField
          control={form.control}
          name="municipalRegistration"
          label="Inscrição municipal"
        />
        <TextField
          control={form.control}
          name="invoiceEmail"
          label="E-mail para nota fiscal"
          type="email"
        />
        <TextField control={form.control} name="contactName" label="Contato" />
        <MaskedField
          control={form.control}
          name="contactPhone"
          label="Telefone do contato"
          mask="phone"
        />
        <TextField
          control={form.control}
          name="contactEmail"
          label="E-mail do contato"
          type="email"
        />
        <MaskedField control={form.control} name="address.cep" label="CEP" mask="cep" />
        <TextField control={form.control} name="address.street" label="Rua" />
        <TextField control={form.control} name="address.number" label="Número" />
        <TextField control={form.control} name="address.complement" label="Complemento" />
        <TextField control={form.control} name="address.neighborhood" label="Bairro" />
        <TextField control={form.control} name="address.city" label="Cidade" />
        <TextField control={form.control} name="address.state" label="UF" maxLength={2} />
        <TextField control={form.control} name="notes" label="Observações internas" />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}
