import { BRAND } from '@app/shared';
import { Brand } from '@/components/brand';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <Brand className="[&>span:first-child]:bg-primary-foreground [&>span:first-child]:text-primary" />
        <div className="space-y-3">
          <p className="text-3xl leading-tight font-semibold">{BRAND.headline}</p>
          <p className="text-primary-foreground/80">{BRAND.tagline}</p>
        </div>
        <p className="text-sm text-primary-foreground/70">© {BRAND.name}</p>
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Brand className="mb-8 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
