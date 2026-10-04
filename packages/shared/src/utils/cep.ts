import { onlyDigits } from './documents.js';

export function normalizeCEP(value: string): string {
  return onlyDigits(value).slice(0, 8);
}

export function isValidCEP(value: string): boolean {
  return /^\d{8}$/.test(onlyDigits(value));
}

/** "01310100" -> "01310-100" (formats partial input). */
export function formatCEP(value: string): string {
  const d = normalizeCEP(value);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export interface ViaCepAddress {
  cep: string;
  street: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  ibgeCode: string;
}

interface ViaCepResponse {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  ibge: string;
  erro?: boolean | string;
}

/**
 * Looks up an address on ViaCEP. Returns `null` when the CEP does not exist.
 * Works in the browser and in Node (global fetch).
 */
export async function fetchAddressByCEP(
  cep: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ViaCepAddress | null> {
  if (!isValidCEP(cep)) return null;
  const res = await fetchImpl(`https://viacep.com.br/ws/${normalizeCEP(cep)}/json/`);
  if (!res.ok) return null;
  const data = (await res.json()) as ViaCepResponse;
  if (data.erro) return null;
  return {
    cep: normalizeCEP(data.cep),
    street: data.logradouro,
    complement: data.complemento,
    neighborhood: data.bairro,
    city: data.localidade,
    state: data.uf,
    ibgeCode: data.ibge,
  };
}
