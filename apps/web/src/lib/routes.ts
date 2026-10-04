import { Permission, type Role, hasAnyPermission, hasPermission } from '@app/shared';
import { NAV } from '../components/shell/nav';

/** Permissions required by each protected route prefix (any of them grants access). */
const ROUTE_PERMISSIONS: { prefix: string; permissions: Permission[] }[] = NAV.flatMap((g) =>
  g.items
    .filter((item) => item.permissions?.length)
    .map((item) => ({ prefix: item.href, permissions: item.permissions! })),
);

/** Whether `role` may open `pathname`. Routes without a rule (e.g. /conta/senha) are open. */
export function canAccess(role: Role | null | undefined, pathname: string): boolean {
  const rule = ROUTE_PERMISSIONS.filter(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  ).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return !rule || hasAnyPermission(role, rule.permissions);
}

/** Main screen of each role. */
export function homeFor(role: Role): string {
  if (hasPermission(role, Permission.REPORTS_READ)) return '/painel';
  if (hasPermission(role, Permission.STORE_MANAGE)) return '/configuracoes/empresa';
  return '/conta/senha';
}

/**
 * Validates the `?next=` redirect target: only same-origin absolute paths the role can open.
 * Anything else (external URLs, `//host`, `/\host`, forbidden pages) falls back to the role home.
 */
export function safeNext(next: string | null | undefined, role: Role): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return homeFor(role);
  }
  const path = next.split(/[?#]/)[0] ?? '/';
  if (path === '/' || path === '/login' || !canAccess(role, path)) return homeFor(role);
  return next;
}
