import { describe, expect, it } from 'vitest';
import {
  ACCENT_TEST_LINE,
  agentOnline,
  columnLine,
  encodeEscPos,
  encodeText,
  isPaperOut,
  printMarks,
  printTiming,
  printerProfile,
  renderText,
  retryDelayMs,
  stripAccents,
  wrapText,
} from './printing.js';

const hex = (bytes: number[] | Uint8Array) => Buffer.from(bytes).toString('hex');
const includes = (haystack: Uint8Array, needle: number[]) => hex(haystack).includes(hex(needle));

describe('text layout', () => {
  it('wraps at spaces and cuts long words', () => {
    expect(wrapText('Pizza grande de calabresa com cebola', 16)).toEqual([
      'Pizza grande de',
      'calabresa com',
      'cebola',
    ]);
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('puts left and right on one line', () => {
    expect(columnLine('Subtotal', 'R$ 10,00', 32)).toEqual(['Subtotal                R$ 10,00']);
    expect(columnLine('Subtotal', 'R$ 10,00', 32)[0]).toHaveLength(32);
  });

  it('renders a text preview with the paper width', () => {
    const lines = renderText(
      {
        title: 'x',
        lines: [
          { kind: 'text', text: 'TÍTULO', align: 'center' },
          { kind: 'divider' },
          { kind: 'text', text: 'SEM CEBOLA', invert: true },
        ],
      },
      58,
    );
    expect(lines).toEqual(['             TÍTULO', '-'.repeat(32), '▌SEM CEBOLA▐']);
  });
});

describe('Portuguese encoding', () => {
  it('maps accents to each code page', () => {
    // "ã ç é" in CP860, CP850 and Windows-1252.
    expect(encodeText('ãçé', 'cp860')).toEqual([0x84, 0x87, 0x82]);
    expect(encodeText('ãçé', 'cp850')).toEqual([0xc6, 0x87, 0x82]);
    expect(encodeText('ãçé', 'cp1252')).toEqual([0xe3, 0xe7, 0xe9]);
  });

  it('encodes the test line without question marks on the generic profile', () => {
    expect(encodeText(ACCENT_TEST_LINE, 'cp860')).not.toContain(0x3f);
    expect(encodeText(ACCENT_TEST_LINE, 'cp850')).not.toContain(0x3f);
  });

  it('falls back to plain letters when asked (last resort) and replaces symbols', () => {
    expect(String.fromCharCode(...encodeText('Pão, maçã', 'cp860', true))).toBe('Pao, maca');
    expect(String.fromCharCode(...encodeText('½ · →', 'cp860'))).toBe('1/2 - ->');
    expect(stripAccents('Coração')).toBe('Coracao');
  });
});

describe('ESC/POS encoder', () => {
  const doc = {
    title: 't',
    lines: [
      { kind: 'beep' as const },
      { kind: 'text' as const, text: 'Pão', bold: true },
      { kind: 'text' as const, text: 'SEM CEBOLA', invert: true },
    ],
  };

  it('initializes, selects the code page, styles and cuts', () => {
    const bytes = encodeEscPos(doc, { profile: printerProfile('epson-tm-t20'), width: 80 });
    expect(hex(bytes.slice(0, 5))).toBe('1b401b7403');
    expect(includes(bytes, [0x1b, 0x45, 1, 0x50, 0x84, 0x6f, 0x0a])).toBe(true); // bold "Pão"
    expect(includes(bytes, [0x1d, 0x42, 1])).toBe(true); // white on black
    expect(hex(bytes.slice(-4))).toBe('1d564200'); // feed and partial cut
    expect(includes(bytes, [0x1b, 0x42, 2, 2])).toBe(false); // Epson profile: no buzzer
  });

  it('adapts to the brand profile (no invert, ESC m cut, buzzer)', () => {
    const bema = encodeEscPos(doc, { profile: printerProfile('bematech-mp4200'), width: 80 });
    expect(hex(bema.slice(0, 5))).toBe('1b401b7402');
    expect(includes(bema, [0x1d, 0x42, 1])).toBe(false);
    expect(Buffer.from(bema).toString('latin1')).toContain('*** SEM CEBOLA ***');
    expect(hex(bema.slice(-2))).toBe('1b6d');
    const elgin = encodeEscPos(doc, { profile: printerProfile('elgin-i9'), width: 80 });
    expect(includes(elgin, [0x1b, 0x42, 2, 2])).toBe(true);
  });

  it('repeats the copies and falls back to the generic profile', () => {
    const one = encodeEscPos(doc, { profile: printerProfile(null), width: 58 });
    const two = encodeEscPos(doc, { profile: printerProfile('nao-existe'), width: 58, copies: 2 });
    expect(two.length).toBe(one.length * 2);
  });

  it('reads the paper sensor status', () => {
    expect(isPaperOut(0x72)).toBe(true);
    expect(isPaperOut(0x12)).toBe(false);
  });
});

describe('queue rules', () => {
  const now = new Date('2026-10-08T20:00:00Z');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it('prints, marks as late or holds by age', () => {
    expect(printTiming(ago(1), now, 30)).toBe('PRINT');
    expect(printTiming(ago(10), now, 30)).toBe('PRINT_DELAYED');
    expect(printTiming(ago(31), now, 30)).toBe('HOLD');
  });

  it('backs off retries and detects an offline agent', () => {
    expect([1, 2, 3, 4, 9].map(retryDelayMs)).toEqual([5_000, 15_000, 30_000, 60_000, 60_000]);
    expect(agentOnline(new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(agentOnline(new Date(now.getTime() - 120_000), now)).toBe(false);
    expect(agentOnline(null, now)).toBe(false);
  });

  it('adds the late, duplicate and reprint marks on top', () => {
    const doc = { title: 't', lines: [{ kind: 'text' as const, text: 'corpo' }] };
    const marked = printMarks(doc, { delayedFrom: '19:42', possibleDuplicate: true });
    expect(renderText(marked, 80).join('\n')).toMatch(
      /POSSÍVEL 2ª VIA[\s\S]*IMPRESSÃO ATRASADA[\s\S]*Pedido das 19:42[\s\S]*corpo/,
    );
    expect(printMarks(doc, {})).toBe(doc);
  });
});
