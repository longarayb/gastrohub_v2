'use client';

import {
  type AddressInput,
  type CustomerDto,
  fetchAddressByCEP,
  formatCEP,
  formatPhone,
  isValidCEP,
  onlyDigits,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Input } from '@app/ui/components/input';
import { toast } from '@app/ui/components/sonner';
import { cn } from '@app/ui/lib/utils';
import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { Field } from '@/components/form';
import { useCustomerSearch } from '@/lib/orders';

export interface CustomerState {
  customerId: string | null;
  name: string;
  phone: string;
  /** Saved address chosen, or 'new' to type one. */
  addressId: string | 'new';
  address: AddressInput;
  /** Saved addresses of the selected customer. */
  addresses: CustomerDto['addresses'];
}

export const EMPTY_ADDRESS: AddressInput = {
  cep: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  reference: '',
};

export const EMPTY_CUSTOMER: CustomerState = {
  customerId: null,
  name: '',
  phone: '',
  addressId: 'new',
  address: EMPTY_ADDRESS,
  addresses: [],
};

function TextInput({
  label,
  value,
  onChange,
  error,
  className,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  className?: string;
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'>) {
  const id = useId();
  return (
    <Field label={label} error={error} htmlFor={id} className={className}>
      <Input
        id={id}
        {...props}
        value={value}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** Customer (phone search + new) and, for delivery, the address (saved or new with CEP lookup). */
export function CustomerSection({
  value,
  onChange,
  withAddress,
  errors,
}: {
  value: CustomerState;
  onChange: (value: CustomerState) => void;
  withAddress: boolean;
  errors: Record<string, string>;
}) {
  const digits = onlyDigits(value.phone);
  const search = useCustomerSearch(value.customerId ? '' : digits.length >= 4 ? digits : '');
  const matches = value.customerId ? [] : (search.data ?? []);
  const lastCep = useRef('');

  const setAddress = (patch: Partial<AddressInput>) =>
    onChange({ ...value, address: { ...value.address, ...patch } });

  const cep = value.address.cep;
  useEffect(() => {
    const clean = onlyDigits(cep ?? '');
    if (!isValidCEP(clean) || clean === lastCep.current) return;
    lastCep.current = clean;
    fetchAddressByCEP(clean)
      .then((addr) => {
        if (!addr) return toast.error('CEP não encontrado');
        onChange({
          ...value,
          address: {
            ...value.address,
            street: addr.street || value.address.street,
            neighborhood: addr.neighborhood || value.address.neighborhood,
            city: addr.city,
            state: addr.state,
          },
        });
      })
      .catch(() => toast.error('Não foi possível consultar o CEP'));
    // Only the CEP triggers the lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cep]);

  function pick(c: CustomerDto) {
    const main = c.addresses[0];
    onChange({
      customerId: c.id,
      name: c.name,
      phone: formatPhone(c.phone),
      addresses: c.addresses,
      addressId: main?.id ?? 'new',
      address: main
        ? {
            cep: formatCEP(main.cep),
            street: main.street,
            number: main.number,
            complement: main.complement,
            neighborhood: main.neighborhood,
            city: main.city,
            state: main.state,
            reference: main.reference,
          }
        : EMPTY_ADDRESS,
    });
  }

  function chooseAddress(id: string | 'new') {
    const saved = value.addresses.find((a) => a.id === id);
    onChange({
      ...value,
      addressId: id,
      address: saved
        ? {
            cep: formatCEP(saved.cep),
            street: saved.street,
            number: saved.number,
            complement: saved.complement,
            neighborhood: saved.neighborhood,
            city: saved.city,
            state: saved.state,
            reference: saved.reference,
          }
        : EMPTY_ADDRESS,
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="relative">
          <TextInput
            label="Telefone"
            inputMode="tel"
            placeholder="(11) 98765-4321"
            value={value.phone}
            error={errors['customer.phone']}
            onChange={(phone) =>
              onChange(
                value.customerId
                  ? { ...EMPTY_CUSTOMER, phone: formatPhone(phone) }
                  : { ...value, phone: formatPhone(phone) },
              )
            }
          />
          {matches.length > 0 && (
            <ul
              className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md"
              aria-label="Clientes encontrados"
            >
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => pick(c)}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatPhone(c.phone)} · {c.orderCount}{' '}
                      {c.orderCount === 1 ? 'pedido' : 'pedidos'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-end gap-1">
          <TextInput
            label="Nome"
            className="flex-1"
            value={value.name}
            error={errors['customer.name'] ?? errors.customer}
            disabled={!!value.customerId}
            onChange={(name) => onChange({ ...value, name })}
          />
          {value.customerId && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Trocar cliente"
              onClick={() => onChange(EMPTY_CUSTOMER)}
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      {withAddress && (
        <div className="space-y-3">
          {value.addresses.length > 0 && (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Endereço">
              {value.addresses.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={value.addressId === a.id}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-left text-xs',
                    value.addressId === a.id ? 'border-primary bg-primary/10' : 'hover:bg-accent',
                  )}
                  onClick={() => chooseAddress(a.id)}
                >
                  {a.label ? `${a.label}: ` : ''}
                  {a.street}, {a.number} · {a.neighborhood}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={value.addressId === 'new'}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs',
                  value.addressId === 'new' ? 'border-primary bg-primary/10' : 'hover:bg-accent',
                )}
                onClick={() => chooseAddress('new')}
              >
                Novo endereço
              </button>
            </div>
          )}
          {value.addressId === 'new' && (
            <div className="grid grid-cols-6 gap-3">
              <TextInput
                label="CEP"
                className="col-span-2"
                inputMode="numeric"
                value={value.address.cep ?? ''}
                error={errors['deliveryAddress.cep'] ?? errors.deliveryAddress}
                onChange={(v) => setAddress({ cep: formatCEP(v) })}
              />
              <TextInput
                label="Rua"
                className="col-span-4"
                value={value.address.street ?? ''}
                error={errors['deliveryAddress.street']}
                onChange={(v) => setAddress({ street: v })}
              />
              <TextInput
                label="Número"
                className="col-span-2"
                value={value.address.number ?? ''}
                error={errors['deliveryAddress.number']}
                onChange={(v) => setAddress({ number: v })}
              />
              <TextInput
                label="Complemento"
                className="col-span-4"
                value={value.address.complement ?? ''}
                onChange={(v) => setAddress({ complement: v })}
              />
              <TextInput
                label="Bairro"
                className="col-span-3"
                value={value.address.neighborhood ?? ''}
                error={errors['deliveryAddress.neighborhood']}
                onChange={(v) => setAddress({ neighborhood: v })}
              />
              <TextInput
                label="Cidade"
                className="col-span-2"
                value={value.address.city ?? ''}
                error={errors['deliveryAddress.city']}
                onChange={(v) => setAddress({ city: v })}
              />
              <TextInput
                label="UF"
                className="col-span-1"
                maxLength={2}
                value={value.address.state ?? ''}
                error={errors['deliveryAddress.state']}
                onChange={(v) => setAddress({ state: v.toUpperCase() })}
              />
              <TextInput
                label="Referência"
                className="col-span-6"
                value={value.address.reference ?? ''}
                onChange={(v) => setAddress({ reference: v })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
