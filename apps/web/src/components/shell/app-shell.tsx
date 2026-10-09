'use client';

import { BRAND, ROLE_LABELS, hasAnyPermission } from '@app/shared';
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
import { toast } from '@app/ui/components/sonner';
import { cn } from '@app/ui/lib/utils';
import { Check, ChevronsUpDown, KeyRound, LogOut, Menu, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/brand';
import { PrintAlerts } from '@/components/printing/alerts';
import { errorMessage } from '@/lib/api';
import { useAuth, useSession } from '@/lib/auth';
import { NAV } from './nav';

/** Menu items (docs/DESIGN.md): 46 px, radius 12, thin Lucide icons, active with a 4 px bar. */
function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const session = useSession();
  const pathname = usePathname();

  return (
    <nav aria-label="Menu principal" className="flex flex-col gap-5">
      {NAV.map((group) => {
        const items = group.items.filter(
          (item) => !item.permissions?.length || hasAnyPermission(session.role, item.permissions),
        );
        if (!items.length) return null;
        return (
          <div key={group.label} className="space-y-1">
            <p className="px-3 pb-1 text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">
              {group.label}
            </p>
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href as never}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-11.5 items-center gap-3 rounded-lg border-l-4 pr-3 pl-2.5 text-base transition-colors',
                    active
                      ? 'border-nav-active-bar bg-nav-active font-bold text-nav-active-foreground'
                      : 'border-transparent font-semibold text-sidebar-foreground hover:bg-accent',
                  )}
                >
                  <item.icon
                    className={cn('size-5 shrink-0', !active && 'text-muted-foreground')}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.shortcut && (
                    <kbd className="rounded border px-1.5 font-sans text-xs text-muted-foreground">
                      {item.shortcut}
                    </kbd>
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

/** Top of the menu: logo and product name, the active unit below (switchable). */
function SidebarBrand() {
  const session = useSession();
  const { switchStore } = useAuth();
  const multiple = session.memberships.length > 1;

  const onSwitch = async (storeId: string) => {
    if (storeId === session.store.id) return;
    try {
      await switchStore(storeId);
      toast.success('Unidade alterada');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const content = (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <BrandMark className="size-10" />
      <span className="min-w-0 text-left">
        <span className="block truncate text-lg leading-tight font-extrabold tracking-tight">
          {BRAND.name}
        </span>
        <span className="block truncate text-sm text-muted-foreground">
          {session.store.tradeName}
        </span>
      </span>
    </span>
  );

  if (!multiple) return <div className="flex items-center px-2 py-1">{content}</div>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Trocar unidade (atual: ${session.store.tradeName})`}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-accent"
        >
          {content}
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
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
    </DropdownMenu>
  );
}

/**
 * Footer of the menu: round green avatar with the initial, name and role. `compact` is the
 * avatar alone, in the phone header (logout without opening the menu).
 */
function UserCard({ compact = false }: { compact?: boolean }) {
  const session = useSession();
  const { logout } = useAuth();
  const avatar = (
    <span
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-avatar text-base font-extrabold text-avatar-foreground"
      aria-hidden
    >
      {session.user.name.trim().charAt(0).toUpperCase()}
    </span>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button
            type="button"
            aria-label="Menu do usuário"
            className="flex size-11 items-center justify-center rounded-full lg:hidden"
          >
            {avatar}
          </button>
        ) : (
          <button
            type="button"
            aria-label="Menu do usuário"
            className="flex w-full items-center gap-3 rounded-card border bg-card/60 p-3 text-left transition-colors hover:bg-accent"
          >
            {avatar}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{session.user.name}</span>
              <span className="block text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">
                {ROLE_LABELS[session.role]}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={compact ? 'end' : 'start'}
        side={compact ? 'bottom' : 'top'}
        className="w-64"
      >
        <DropdownMenuLabel className="font-normal">
          <p className="font-bold">{session.user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
        </DropdownMenuLabel>
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

const THEMES = [
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'system', label: 'Sistema', icon: Monitor },
] as const;

/** Theme of this device (docs/DESIGN.md): dark by default; "Sistema" follows the OS live. */
function ThemeSwitcher() {
  const { theme = 'dark', setTheme } = useTheme();
  // The saved theme is only known in the browser: render the icon after mounting.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = THEMES.find((t) => t.value === theme) ?? THEMES[0];
  const Icon = mounted ? current.icon : Moon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Tema: ${mounted ? current.label : ''}`}>
          <Icon className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Tema deste aparelho
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t.value} value={t.value}>
              <t.icon className="size-4" /> {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-5 bg-linear-to-b from-sidebar to-sidebar-to p-4 text-sidebar-foreground">
      <SidebarBrand />
      <div className="-mx-1 flex-1 overflow-y-auto px-1">
        <NavLinks onNavigate={onNavigate} />
      </div>
      <UserCard />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
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
          <div id="page-header" className="flex min-w-0 flex-1 items-center gap-2" />
          <PrintAlerts />
          <ThemeSwitcher />
          <UserCard compact />
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
