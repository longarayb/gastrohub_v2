import type {
  CatalogDto,
  CategoryDto,
  ModifierGroupDto,
  PauseInput,
  ProductDetailDto,
  ProductListItemDto,
  ProductListQuery,
  SalesChannel,
  SectorDto,
} from '@app/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from './api';

export const menuKeys = {
  all: ['menu'] as const,
  sectors: ['menu', 'sectors'] as const,
  categories: ['menu', 'categories'] as const,
  groups: ['menu', 'groups'] as const,
  products: (query: ProductListQuery = {}) => ['menu', 'products', query] as const,
  product: (id: string) => ['menu', 'product', id] as const,
  catalog: (channel: SalesChannel) => ['menu', 'catalog', channel] as const,
};

export const useSectors = () =>
  useQuery({ queryKey: menuKeys.sectors, queryFn: () => apiGet<SectorDto[]>('/menu/sectors') });

export const useCategories = () =>
  useQuery({
    queryKey: menuKeys.categories,
    queryFn: () => apiGet<CategoryDto[]>('/menu/categories'),
  });

export const useModifierGroups = () =>
  useQuery({
    queryKey: menuKeys.groups,
    queryFn: () => apiGet<ModifierGroupDto[]>('/menu/modifier-groups'),
  });

export const useProducts = (query: ProductListQuery) =>
  useQuery({
    queryKey: menuKeys.products(query),
    queryFn: () =>
      apiGet<ProductListItemDto[]>('/menu/products', {
        q: query.q,
        categoryId: query.categoryId,
        status: query.status,
        channel: query.channel,
        sectorId: query.sectorId,
      }),
    placeholderData: (previous) => previous,
  });

export const useProduct = (id: string | null) =>
  useQuery({
    queryKey: menuKeys.product(id ?? ''),
    queryFn: () => apiGet<ProductDetailDto>(`/menu/products/${id}`),
    enabled: !!id,
  });

export const useCatalog = (channel: SalesChannel, enabled = true) =>
  useQuery({
    queryKey: menuKeys.catalog(channel),
    queryFn: () => apiGet<CatalogDto>('/menu/catalog', { channel }),
    enabled,
  });

/** Invalidates every menu query (lists, details, catalog). */
export function useInvalidateMenu() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: menuKeys.all });
}

export type PauseTarget =
  | { kind: 'category'; id: string }
  | { kind: 'product'; id: string }
  | { kind: 'size'; productId: string; sizeId: string }
  | { kind: 'option'; id: string };

function pausePath(target: PauseTarget): string {
  switch (target.kind) {
    case 'category':
      return `/menu/categories/${target.id}`;
    case 'product':
      return `/menu/products/${target.id}`;
    case 'size':
      return `/menu/products/${target.productId}/sizes/${target.sizeId}`;
    case 'option':
      return `/menu/modifier-options/${target.id}`;
  }
}

export function pauseItem(target: PauseTarget, mode: PauseInput['mode']) {
  return apiPost(`${pausePath(target)}/pause`, { mode });
}

export function resumeItem(target: PauseTarget) {
  return apiPost(`${pausePath(target)}/resume`);
}
