/** Removes accents (Unicode combining marks) after canonical decomposition. */
function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

/** "Pizzaria do João!" -> "pizzaria-do-joao" */
export function slugify(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Case- and accent-insensitive normalization for search. */
export function normalizeSearch(value: string): string {
  return stripAccents(value).toLowerCase().trim();
}
