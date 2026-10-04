'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { formatBRL, formatCEP, formatCNPJ, formatCPF, formatPhone, onlyDigits } from '@app/shared';
import { Input } from '@app/ui/components/input';
import { Label } from '@app/ui/components/label';
import { cn } from '@app/ui/lib/utils';
import { useId } from 'react';
import {
  type Control,
  type DefaultValues,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
  useController,
  useForm,
} from 'react-hook-form';
import type { z } from 'zod';
import { ApiError } from '@/lib/api';

/** react-hook-form + Zod with input/output types inferred from the schema. */
export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  defaultValues?: DefaultValues<z.input<S>>,
): UseFormReturn<z.input<S>, unknown, z.output<S>> {
  return useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema as never) as never,
    defaultValues,
    // Validate on the first submit, then on every change. Validating on blur made error
    // messages appear between mousedown and mouseup when leaving a field to click a link,
    // shifting the layout and swallowing the click.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
}

/** Copies API validation errors (400 with details) onto form fields. Returns true if any was applied. */
export function applyApiErrors<T extends FieldValues>(
  form: UseFormReturn<T, unknown, unknown>,
  error: unknown,
): boolean {
  if (!(error instanceof ApiError)) return false;
  const fields = Object.entries(error.fieldErrors);
  for (const [path, message] of fields) {
    form.setError(path as FieldPath<T>, { message });
  }
  return fields.length > 0;
}

export function Field({
  label,
  error,
  hint,
  className,
  children,
  htmlFor,
}: {
  label?: string;
  error?: string;
  hint?: string;
  className?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

type TextFieldProps<T extends FieldValues> = {
  control: Control<T, unknown, unknown>;
  name: FieldPath<T>;
  label?: string;
  hint?: string;
  className?: string;
} & Omit<React.ComponentProps<typeof Input>, 'name' | 'defaultValue'>;

/** Text input bound to react-hook-form. */
export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  className,
  ...props
}: TextFieldProps<T>) {
  const id = useId();
  const { field, fieldState } = useController({ control, name });
  return (
    <Field
      label={label}
      error={fieldState.error?.message}
      hint={hint}
      className={className}
      htmlFor={id}
    >
      <Input
        id={id}
        {...props}
        {...field}
        value={(field.value as string | number | undefined) ?? ''}
        aria-invalid={!!fieldState.error}
      />
    </Field>
  );
}

/** Numeric input bound to react-hook-form (stores a number, empty -> 0). */
export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  className,
  ...props
}: Omit<TextFieldProps<T>, 'type'>) {
  const id = useId();
  const { field, fieldState } = useController({ control, name });
  return (
    <Field
      label={label}
      error={fieldState.error?.message}
      hint={hint}
      className={className}
      htmlFor={id}
    >
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        {...props}
        name={field.name}
        ref={field.ref}
        onBlur={field.onBlur}
        value={(field.value as number | undefined) ?? ''}
        onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        aria-invalid={!!fieldState.error}
      />
    </Field>
  );
}

/** Percentage input shown as "%" and stored in basis points (12% -> 1200). */
export function PercentField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  className,
  ...props
}: Omit<TextFieldProps<T>, 'type'>) {
  const id = useId();
  const { field, fieldState } = useController({ control, name });
  return (
    <Field
      label={label}
      error={fieldState.error?.message}
      hint={hint}
      className={className}
      htmlFor={id}
    >
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={0.5}
        min={0}
        {...props}
        name={field.name}
        ref={field.ref}
        onBlur={field.onBlur}
        value={((field.value as number | undefined) ?? 0) / 100}
        onChange={(e) => field.onChange(Math.round(Number(e.target.value || 0) * 100))}
        aria-invalid={!!fieldState.error}
      />
    </Field>
  );
}

const MASKS = {
  cpf: formatCPF,
  cnpj: formatCNPJ,
  phone: formatPhone,
  cep: formatCEP,
  document: (v: string) => (onlyDigits(v).length > 11 ? formatCNPJ(v) : formatCPF(v)),
} as const;

/** Input with a Brazilian mask; stores the formatted value (schemas strip formatting). */
export function MaskedField<T extends FieldValues>({
  mask,
  ...props
}: TextFieldProps<T> & { mask: keyof typeof MASKS }) {
  const id = useId();
  const { field, fieldState } = useController({ control: props.control, name: props.name });
  const format = MASKS[mask];
  const { control: _c, name: _n, label, hint, className, ...inputProps } = props;
  return (
    <Field
      label={label}
      error={fieldState.error?.message}
      hint={hint}
      className={className}
      htmlFor={id}
    >
      <Input
        id={id}
        inputMode="numeric"
        {...inputProps}
        name={field.name}
        ref={field.ref}
        onBlur={field.onBlur}
        value={format(String(field.value ?? ''))}
        onChange={(e) => field.onChange(format(e.target.value))}
        aria-invalid={!!fieldState.error}
      />
    </Field>
  );
}

/** Currency input storing integer cents. Typing "1234" shows "R$ 12,34". */
export function MoneyInput({
  value,
  onChange,
  className,
  ...props
}: { value: number | null | undefined; onChange: (cents: number) => void } & Omit<
  React.ComponentProps<typeof Input>,
  'value' | 'onChange'
>) {
  return (
    <Input
      inputMode="numeric"
      {...props}
      className={cn('tabular text-right', className)}
      value={formatBRL(value ?? 0)}
      onChange={(e) => onChange(Number(onlyDigits(e.target.value) || '0'))}
      onFocus={(e) => e.target.select()}
    />
  );
}

export function MoneyField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  className,
  ...props
}: Omit<TextFieldProps<T>, 'type'>) {
  const id = useId();
  const { field, fieldState } = useController({ control, name });
  return (
    <Field
      label={label}
      error={fieldState.error?.message}
      hint={hint}
      className={className}
      htmlFor={id}
    >
      <MoneyInput
        id={id}
        {...props}
        name={field.name}
        ref={field.ref}
        onBlur={field.onBlur}
        value={field.value as number}
        onChange={field.onChange}
        aria-invalid={!!fieldState.error}
      />
    </Field>
  );
}
