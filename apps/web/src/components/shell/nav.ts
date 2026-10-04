import { Permission } from '@app/shared';
import {
  BookOpen,
  Building2,
  ChefHat,
  Clock,
  LayoutDashboard,
  ListPlus,
  type LucideIcon,
  Users,
} from 'lucide-react';

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
    label: 'Cardápio',
    items: [
      {
        href: '/cardapio',
        label: 'Produtos',
        icon: BookOpen,
        permissions: [Permission.MENU_READ],
      },
      {
        href: '/cardapio/complementos',
        label: 'Complementos',
        icon: ListPlus,
        permissions: [Permission.MENU_READ],
      },
      {
        href: '/cardapio/setores',
        label: 'Setores de produção',
        icon: ChefHat,
        permissions: [Permission.MENU_MANAGE],
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
