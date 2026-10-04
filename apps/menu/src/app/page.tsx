import { BRAND } from '@app/shared';

export default function MenuHomePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold">Cardápio digital {BRAND.name}</h1>
        <p className="mt-2 text-muted-foreground">
          Acesse o cardápio pelo endereço do restaurante, por exemplo{' '}
          <code>/nome-do-restaurante</code>.
        </p>
      </div>
    </main>
  );
}
