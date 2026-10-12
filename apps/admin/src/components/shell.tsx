'use client';

import { Button } from '@app/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@app/ui/components/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@app/ui/components/sheet';
import { cn } from '@app/ui/lib/utils';
import {
  Building2,
  FileClock,
  Headset,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Menu,
  Monitor,
  Moon,
  Package,
  ReceiptText,
  Settings,
  Sun,
  UserCog,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Brand } from '@/components/brand';
import { useAuth } from '@/lib/auth';

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Visão geral', icon: LayoutDashboard },
  { href: '/clientes', label: 'Clientes', icon: Building2 },
  { href: '/cobrancas', label: 'Mensalidades', icon: ReceiptText },
  { href: '/planos', label: 'Planos', icon: Package },
  { href: '/suporte', label: 'Acessos de suporte', icon: Headset },
  { href: '/auditoria', label: 'Auditoria', icon: FileClock },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
];

const THEMES = [
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'system', label: 'Sistema', icon: Monitor },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Menu principal" className="space-y-1">
      {NAV.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href as never}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-11.5 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors',
              active
                ? 'border-l-4 border-primary bg-accent text-foreground'
                : 'text-sidebar-foreground hover:bg-accent/60',
            )}
          >
            <item.icon className="size-5" strokeWidth={1.75} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 bg-linear-to-b from-sidebar to-sidebar-to p-4 text-sidebar-foreground">
      <div className="space-y-1 px-1">
        <Brand />
        <p className="text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">
          Administração da plataforma
        </p>
      </div>
      <NavLinks onNavigate={onNavigate} />
    </div>
  );
}

function AccountMenu() {
  const { admin, logout } = useAuth();
  const { theme = 'dark', setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label="Minha conta">
          <UserCog className="size-5" />
          <span className="hidden sm:inline">{admin?.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {admin?.email}
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/conta">Minha conta e 2FA</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Tema</DropdownMenuLabel>
        {mounted && (
          <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
            {THEMES.map((t) => (
              <DropdownMenuRadioItem key={t.value} value={t.value}>
                <t.icon className="size-4" /> {t.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut className="size-4" /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-68 shrink-0 border-r lg:block">
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur lg:px-8">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 max-w-[85vw] gap-0 border-r-0 p-0">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <Sidebar onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex-1" />
          <AccountMenu />
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
