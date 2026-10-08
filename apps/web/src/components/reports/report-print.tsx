'use client';

import { BRAND, formatDateTime } from '@app/shared';
import { useCurrentStore } from '@/lib/stores';

/** A4 printout of a report (named page `report` in globals.css): title, period and tables. */
export function ReportPrint({
  title,
  period,
  blocks,
}: {
  title: string;
  period: string;
  blocks: { title: string; columns: string[]; rows: string[][] }[];
}) {
  const store = useCurrentStore();
  return (
    <div className="print-a4 space-y-4 font-sans">
      <header>
        <p className="text-sm">{store.data?.tradeName ?? BRAND.name}</p>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="text-sm">
          Dias de negócio de {period} · impresso em {formatDateTime(new Date())}
        </p>
      </header>
      {blocks.map((block) => (
        <section key={block.title} className="break-inside-avoid">
          <h2 className="mb-1 font-bold">{block.title}</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {block.columns.map((c, i) => (
                  <th key={c || i} className={`border-b py-1 ${i ? 'text-right' : 'text-left'}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      className={`tabular border-b py-0.5 ${i ? 'text-right' : 'text-left'}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="text-xs">Definições dos indicadores: ícone ⓘ de cada indicador no painel.</p>
    </div>
  );
}
