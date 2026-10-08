import { Permission } from '@app/shared';
import {
  Bike,
  BookOpen,
  Building2,
  ChefHat,
  Clock,
  LayoutDashboard,
  LayoutGrid,
  ListPlus,
  MapPinned,
  Navigation,
  Printer,
  MonitorPlay,
  ReceiptText,
  Smartphone,
  TicketPercent,
  type LucideIcon,
  Users,
  Wallet,
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
      {
        href: '/pedidos',
        label: 'Pedidos',
        icon: ReceiptText,
        permissions: [Permission.ORDERS_READ],
      },
      {
        href: '/caixa',
        label: 'Caixa',
        icon: Wallet,
        permissions: [Permission.CASH_OPERATE],
      },
      {
        href: '/mesas',
        label: 'Mesas',
        icon: LayoutGrid,
        permissions: [Permission.TABLES_OPERATE, Permission.TABLES_MANAGE],
      },
      {
        // Opens the kitchen display (its own full-screen layout, outside the shell).
        href: '/kds',
        label: 'Tela da cozinha',
        icon: MonitorPlay,
        permissions: [Permission.KDS_OPERATE],
      },
      {
        // Courier app (phone): only the courier's own route (LGPD).
        href: '/entregas',
        label: 'Minhas entregas',
        icon: Navigation,
        permissions: [Permission.COURIER_APP],
      },
      {
        href: '/entregadores',
        label: 'Entregadores',
        icon: Bike,
        permissions: [Permission.DELIVERY_OPERATE],
      },
      {
        href: '/areas-entrega',
        label: 'Áreas de entrega',
        icon: MapPinned,
        permissions: [Permission.DELIVERY_OPERATE],
      },
      {
        href: '/cupons',
        label: 'Cupons',
        icon: TicketPercent,
        permissions: [Permission.STORE_MANAGE],
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
        href: '/configuracoes/cardapio-digital',
        label: 'Cardápio digital',
        icon: Smartphone,
        permissions: [Permission.STORE_MANAGE],
      },
      {
        href: '/configuracoes/impressao',
        label: 'Impressão',
        icon: Printer,
        permissions: [Permission.PRINTERS_MANAGE],
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
