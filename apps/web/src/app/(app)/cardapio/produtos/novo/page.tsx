'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ProductEditor } from '@/components/menu/product-editor';

function NewProduct() {
  const params = useSearchParams();
  return (
    <ProductEditor productId={null} initialCategoryId={params.get('categoria') ?? undefined} />
  );
}

export default function NewProductPage() {
  return (
    <Suspense>
      <NewProduct />
    </Suspense>
  );
}
