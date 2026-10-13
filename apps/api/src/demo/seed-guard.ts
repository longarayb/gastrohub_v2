/** Hosts of a development database: this machine, or the `postgres` service of docker-compose.yml. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres']);

/**
 * Why the development seed must not run here, or null when it may. The seed empties the platform
 * tables (admins, customers, invoices): on a server it would erase real data.
 */
export function seedRefusal(nodeEnv: string | undefined, databaseUrl: string): string | null {
  if (nodeEnv === 'production') {
    return 'O seed de desenvolvimento não roda com NODE_ENV=production (ele apaga a plataforma inteira). No servidor, use demo-reset.';
  }
  let host: string;
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return 'DATABASE_URL inválido.';
  }
  if (!LOCAL_HOSTS.has(host)) {
    return `O seed de desenvolvimento só roda num banco local (DATABASE_URL aponta para ${host}).`;
  }
  return null;
}
