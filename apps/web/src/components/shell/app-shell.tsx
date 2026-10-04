'use client';

import { ROLE_LABELS, hasAnyPermission } from '@gastrohub/shared';
import { Button } from '@gastrohub/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@gastrohub/ui/components/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@gastrohub/ui/components/sheet';
import { toast } from '@gastrohub/ui/components/sonner';
import { cn } from '@gastrohub/ui/lib/utils';
import {
  Check,
  ChevronsUpDown,
  KeyRound,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Store,
  Sun,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Brand } from '@/components/brand';
import { errorMessage } from '@/lib/api';
import { useAuth, useSession } from '@/lib/auth';
import { NAV } from './nav';

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const session = useSession();
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-6">
      {NAV.map((group) => {
        const items = group.items.filter(
          (item) => !item.permissions?.length || hasAnyPermission(session.role, item.permissions),
        );
        if (!items.length) return null;
        return (
          <div key={group.label} className="space-y-1">
            <p className="px-3 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              {group.label}
            </p>
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href as never}
                  onClick={onNavigate}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-sidebar-foreground/80 hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <item.icon className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && (
                    <kbd className="text-[10px] text-muted-foreground">{item.shortcut}</kbd>
                  )}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function StoreSwitcher() {
  const session = useSession();
  const { switchStore } = useAuth();

  const onSwitch = async (storeId: string) => {
    if (storeId === session.store.id) return;
    try {
      await switchStore(storeId);
      toast.success('Unidade alterada');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-auto w-full justify-between px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <Store className="size-4 shrink-0" />
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm font-medium">{session.store.tradeName}</span>
              <span className="block text-xs text-muted-foreground">
                {ROLE_LABELS[session.role]}
              </span>
            </span>
          </span>
          {session.memberships.length > 1 && <ChevronsUpDown className="size-4 opacity-50" />}
        </Button>
      </DropdownMenuTrigger>
      {session.memberships.length > 1 && (
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Trocar unidade</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {session.memberships.map((m) => (
            <DropdownMenuItem key={m.storeId} onSelect={() => onSwitch(m.storeId)}>
              <span className="flex-1 truncate">{m.tradeName}</span>
              {m.storeId === session.store.id && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

function UserMenu() {
  const session = useSession();
  const { logout } = useAuth();
  const { theme = 'system', setTheme } = useTheme();
  const initials = session.user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Menu do usuário">
          <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
            {initials}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="font-medium">{session.user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Tema</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun className="size-4" /> Claro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="size-4" /> Escuro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="size-4" /> Sistema
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/conta/senha">
            <KeyRound /> Alterar senha
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
          <LogOut /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Brand />
      <StoreSwitcher />
      <div className="flex-1 overflow-y-auto">
        <NavLinks onNavigate={onNavigate} />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r bg-sidebar lg:block">
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <Sidebar onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <div id="page-header" className="flex min-w-0 flex-1 items-center gap-2" />
          <UserMenu />
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
