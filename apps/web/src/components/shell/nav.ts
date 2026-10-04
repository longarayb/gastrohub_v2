import { Permission } from '@app/shared';
import { Building2, Clock, LayoutDashboard, type LucideIcon, Users } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Any of these permissions grants access. Empty = everyone. */
  permissions?: Permission[];
  /** Keyboard shortcut hint shown in the menu. */
  shortcut?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Operação',
    items: [
      {
        href: '/painel',
        label: 'Painel',
        icon: LayoutDashboard,
        permissions: [Permission.REPORTS_READ],
      },
    ],
  },
  {
    label: 'Configurações',
    items: [
      {
        href: '/configuracoes/empresa',
        label: 'Empresa',
        icon: Building2,
        permissions: [Permission.STORE_MANAGE],
      },
      {
        href: '/configuracoes/horarios',
        label: 'Horários',
        icon: Clock,
        permissions: [Permission.STORE_MANAGE],
      },
      {
        href: '/configuracoes/usuarios',
        label: 'Usuários',
        icon: Users,
        permissions: [Permission.USERS_MANAGE],
      },
    ],
  },
];
