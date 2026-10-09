import { BRAND } from '@app/shared';
import { Bike, ChefHat, Receipt, UtensilsCrossed } from 'lucide-react';
import { Brand } from '@/components/brand';

const FEATURES = [
  { icon: Receipt, text: 'PDV, pedidos e caixa' },
  { icon: UtensilsCrossed, text: 'Salão, mesas e comandas' },
  { icon: ChefHat, text: 'Tela da cozinha e impressão' },
  { icon: Bike, text: 'Delivery e cardápio digital' },
] as const;

/**
 * Sign-in pages (D039, phase D): the brand panel uses the sidebar surface (the same as inside
 * the panel) and the form sits on a card. Below `lg`, only the form with the brand on top.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between border-r bg-linear-to-b from-sidebar to-sidebar-to p-10 text-sidebar-foreground lg:flex">
        <Brand />
        <div className="max-w-md space-y-8">
          <div className="space-y-3">
            <p className="text-4xl leading-tight font-extrabold tracking-tight">{BRAND.headline}</p>
            <p className="text-lg text-muted-foreground">{BRAND.tagline}</p>
          </div>
          <ul className="space-y-3">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-base font-semibold">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">© {BRAND.name}</p>
      </aside>
      <main className="flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md">
          <Brand className="mb-6 lg:hidden" />
          <div className="sm:rounded-card sm:border sm:bg-card sm:p-8 sm:text-card-foreground">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
