/**
 * CSV for Excel in pt-BR: `;` separator, decimal comma, UTF-8 with BOM (accents open right),
 * CRLF line breaks. Money goes as a plain number ("1234,56", no "R$") so the sheet can sum it.
 */

export type CsvValue = string | number | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
  /** `cents` writes 123456 as "1234,56"; `percent` writes 12.5 as "12,5". */
  format?: 'cents' | 'percent' | 'integer' | 'text';
}

const BOM = '﻿';

export const centsToCsv = (cents: number): string => {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return `${negative ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
};

function cell(value: CsvValue, format: CsvColumn<unknown>['format']): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'number') {
    if (format === 'cents') text = centsToCsv(value);
    else text = String(value).replace('.', ',');
  } else {
    text = value;
    // Formula injection: a cell starting with = + - @ would run in Excel.
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  }
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [
    columns.map((c) => cell(c.header, 'text')).join(';'),
    ...rows.map((row) => columns.map((c) => cell(c.value(row), c.format)).join(';')),
  ];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
