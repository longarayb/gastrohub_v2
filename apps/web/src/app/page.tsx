import { ChefHat } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@gastrohub/ui/components/card';

export default function HomePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ChefHat className="size-6" />
          </div>
          <CardTitle className="text-2xl">GastroHub</CardTitle>
          <CardDescription>Gestão para restaurantes, bares e deliveries</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Fundação pronta.</CardContent>
      </Card>
    </main>
  );
}
