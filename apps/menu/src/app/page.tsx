import { BRAND } from '@app/shared';

export default function MenuHomePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Cardápio digital</h1>
        <p className="text-muted-foreground">
          Acesse o cardápio pelo link do restaurante, por exemplo <code>/nome-do-restaurante</code>.
        </p>
        <p className="pt-6 text-xs text-muted-foreground">feito com {BRAND.name}</p>
      </div>
    </main>
  );
}
