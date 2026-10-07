/**
 * Thermal printing (docs/DECISOES.md D035–D037): a document model (lines with styles), printer
 * profiles per brand/model, text encoding for Portuguese, the ESC/POS encoder and the queue
 * rules. Pure: the API builds documents, the panel previews them, the local agent encodes them.
 */

// ---------------------------------------------------------------------------
// Document model

export type PrintAlign = 'left' | 'center' | 'right';
/** normal; wide/tall/double = 2× width, height or both (headings, order number, quantities). */
export type PrintSize = 'normal' | 'wide' | 'tall' | 'double';

export type PrintLine =
  | {
      kind: 'text';
      text: string;
      align?: PrintAlign;
      bold?: boolean;
      size?: PrintSize;
      /** White on black (removals, "CANCELADO"); a framed text where unsupported. */
      invert?: boolean;
    }
  | { kind: 'columns'; left: string; right: string; bold?: boolean; size?: PrintSize }
  | { kind: 'divider'; char?: '-' | '=' }
  | { kind: 'feed'; lines?: number }
  | { kind: 'qr'; data: string; caption?: string }
  | { kind: 'beep' };

export interface PrintDocument {
  /** Short description for lists ("Comanda · Cozinha · #12"). */
  title: string;
  lines: PrintLine[];
}

export const PAPER_WIDTHS = [58, 80] as const;
export type PaperWidth = (typeof PAPER_WIDTHS)[number];
/** Characters per line in the standard font (A): 32 on 58 mm, 48 on 80 mm. */
export const columnsFor = (width: PaperWidth): number => (width === 58 ? 32 : 48);

const widthFactor = (size: PrintSize | undefined) => (size === 'wide' || size === 'double' ? 2 : 1);

/** Breaks a text into lines of at most `cols` characters, at spaces when possible. */
export function wrapText(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= cols) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > cols) {
        out.push(line.slice(0, cols));
        line = line.slice(cols);
      }
    }
    out.push(line);
  }
  return out;
}

/** "Subtotal ........ R$ 10,00": left and right on one line (left wraps when long). */
export function columnLine(left: string, right: string, cols: number): string[] {
  const space = cols - right.length - 1;
  if (space < 4) return [...wrapText(left, cols), right.padStart(cols)];
  const lines = wrapText(left, space);
  const last = lines.pop() ?? '';
  return [...lines, `${last.padEnd(space)} ${right}`];
}

/** Plain-text preview of a document (tests, logs, the virtual printer file). */
export function renderText(doc: PrintDocument, width: PaperWidth): string[] {
  const cols = columnsFor(width);
  const out: string[] = [];
  const place = (text: string, align: PrintAlign | undefined, avail: number) =>
    align === 'center'
      ? text.padStart(Math.floor((avail + text.length) / 2)).padEnd(avail)
      : align === 'right'
        ? text.padStart(avail)
        : text;
  for (const line of doc.lines) {
    switch (line.kind) {
      case 'text': {
        const avail = Math.floor(cols / widthFactor(line.size));
        const text = line.invert ? `▌${line.text}▐` : line.text;
        for (const l of wrapText(text, avail)) out.push(place(l, line.align, avail).trimEnd());
        break;
      }
      case 'columns':
        out.push(...columnLine(line.left, line.right, Math.floor(cols / widthFactor(line.size))));
        break;
      case 'divider':
        out.push((line.char ?? '-').repeat(cols));
        break;
      case 'feed':
        for (let i = 0; i < (line.lines ?? 1); i++) out.push('');
        break;
      case 'qr':
        out.push(place('[QR]', 'center', cols).trimEnd());
        if (line.caption) out.push(...wrapText(line.caption, cols));
        break;
      case 'beep':
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Printer profiles (brand/model): how each one handles accents, cut, styles and status

export type Codepage = 'cp860' | 'cp850' | 'cp1252';
export type CutCommand = 'GS_V_66' | 'GS_V_1' | 'ESC_m' | 'none';

export interface PrinterProfile {
  id: string;
  brand: string;
  model: string;
  codepage: Codepage;
  /** n of ESC t n that selects the code page on this model. */
  codepageCommand: number;
  defaultWidth: PaperWidth;
  cut: CutCommand;
  /** GS B (white on black). Without it the text is framed by markers. */
  invert: boolean;
  /** ESC B n t buzzer. */
  beep: boolean;
  /** GS ( k QR Code (model 2). Without it the content prints as text. */
  qr: boolean;
  /** DLE EOT real-time status (paper, offline) on direct connections. */
  status: boolean;
  /** Shown to the owner; profiles are conservative defaults, the test page confirms them. */
  note?: string;
}

const GENERIC = {
  defaultWidth: 80,
  cut: 'GS_V_66',
  invert: true,
  beep: false,
  qr: true,
  status: true,
} as const;

/**
 * The most common brands in Brazil. Models change firmware and dip-switch settings, so each brand
 * also has the generic ESC/POS profiles with the other code pages to try when accents come out
 * wrong (the test page prints "Pão, maçã, açaí, coração").
 */
export const PRINTER_PROFILES: readonly PrinterProfile[] = [
  {
    id: 'generic-cp860',
    brand: 'Genérica',
    model: 'ESC/POS (padrão)',
    codepage: 'cp860',
    codepageCommand: 3,
    ...GENERIC,
    note: 'Funciona com a maioria das impressoras ESC/POS. Se os acentos saírem errados, teste as outras páginas de código.',
  },
  {
    id: 'generic-cp850',
    brand: 'Genérica',
    model: 'ESC/POS (página 850)',
    codepage: 'cp850',
    codepageCommand: 2,
    ...GENERIC,
  },
  {
    id: 'generic-cp1252',
    brand: 'Genérica',
    model: 'ESC/POS (Windows-1252)',
    codepage: 'cp1252',
    codepageCommand: 16,
    ...GENERIC,
  },
  {
    id: 'epson-tm-t20',
    brand: 'Epson',
    model: 'TM-T20 / TM-T20X / TM-T88',
    codepage: 'cp860',
    codepageCommand: 3,
    ...GENERIC,
    beep: false,
  },
  {
    id: 'elgin-i9',
    brand: 'Elgin',
    model: 'i9 / i7 / i8',
    codepage: 'cp860',
    codepageCommand: 3,
    ...GENERIC,
    beep: true,
  },
  {
    id: 'bematech-mp4200',
    brand: 'Bematech',
    model: 'MP-4200 TH / MP-100S TH (modo ESC/POS)',
    codepage: 'cp850',
    codepageCommand: 2,
    ...GENERIC,
    cut: 'ESC_m',
    invert: false,
    note: 'Configure a impressora no modo ESC/POS (utilitário da Bematech). No modo ESC/Bema os comandos diferem.',
  },
  {
    id: 'daruma-dr800',
    brand: 'Daruma',
    model: 'DR800 / DR700',
    codepage: 'cp850',
    codepageCommand: 2,
    ...GENERIC,
    cut: 'ESC_m',
    invert: false,
    qr: false,
    status: false,
  },
  {
    id: 'tanca-tp650',
    brand: 'Tanca',
    model: 'TP-650 / TP-450',
    codepage: 'cp860',
    codepageCommand: 3,
    ...GENERIC,
    beep: true,
  },
];

export const DEFAULT_PRINTER_PROFILE_ID = 'generic-cp860';

export function printerProfile(id: string | null | undefined): PrinterProfile {
  return (
    PRINTER_PROFILES.find((p) => p.id === id) ??
    PRINTER_PROFILES.find((p) => p.id === DEFAULT_PRINTER_PROFILE_ID)!
  );
}

/** The accented line of the test page: the owner checks it right away. */
export const ACCENT_TEST_LINE = 'Pão, maçã, açaí, coração · ÁÉÍÓÚ ÂÊÔ ÃÕ Ç';

// ---------------------------------------------------------------------------
// Text encoding (Portuguese)

const CP860: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ã: 0x84,
  à: 0x85,
  Á: 0x86,
  ç: 0x87,
  ê: 0x88,
  Ê: 0x89,
  è: 0x8a,
  Í: 0x8b,
  Ô: 0x8c,
  ì: 0x8d,
  Ã: 0x8e,
  Â: 0x8f,
  É: 0x90,
  À: 0x91,
  È: 0x92,
  ô: 0x93,
  õ: 0x94,
  ò: 0x95,
  Ú: 0x96,
  ù: 0x97,
  Ì: 0x98,
  Õ: 0x99,
  Ü: 0x9a,
  Ó: 0x9f,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ª: 0xa6,
  º: 0xa7,
};
const CP850: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  à: 0x85,
  ç: 0x87,
  ê: 0x88,
  è: 0x8a,
  ô: 0x93,
  ò: 0x95,
  ù: 0x97,
  Ü: 0x9a,
  É: 0x90,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ª: 0xa6,
  º: 0xa7,
  Á: 0xb5,
  Â: 0xb6,
  À: 0xb7,
  ã: 0xc6,
  Ã: 0xc7,
  Ê: 0xd2,
  Í: 0xd6,
  Ó: 0xe0,
  Ô: 0xe2,
  õ: 0xe4,
  Õ: 0xe5,
  Ú: 0xe9,
};

/** "Pão" → "Pao" (last resort for printers that cannot print accents at all). */
export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Symbols outside the code pages, replaced before encoding. */
const SYMBOLS: Record<string, string> = {
  '·': '-',
  '–': '-',
  '—': '-',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '…': '...',
  '½': '1/2',
  '⅓': '1/3',
  '¼': '1/4',
  '×': 'x',
  '→': '->',
  '▌': '[',
  '▐': ']',
  '•': '*',
};

/** Encodes text for the printer's code page; unknown characters lose the accent or become "?". */
export function encodeText(text: string, codepage: Codepage, withoutAccents = false): number[] {
  const bytes: number[] = [];
  const table = codepage === 'cp860' ? CP860 : codepage === 'cp850' ? CP850 : null;
  for (const raw of text) {
    const ch = SYMBOLS[raw] ?? raw;
    for (const c of ch.length > 1 ? [...ch] : [ch]) {
      const code = c.charCodeAt(0);
      if (code >= 0x20 && code < 0x7f) {
        bytes.push(code);
        continue;
      }
      if (!withoutAccents) {
        if (table && table[c] !== undefined) {
          bytes.push(table[c]!);
          continue;
        }
        if (!table && code >= 0xa0 && code <= 0xff) {
          bytes.push(code); // Windows-1252 = Latin-1 in this range
          continue;
        }
      }
      const plain = stripAccents(c);
      const pc = plain.charCodeAt(0);
      bytes.push(plain.length === 1 && pc >= 0x20 && pc < 0x7f ? pc : 0x3f);
    }
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// ESC/POS encoder

const ESC = 0x1b;
const GS = 0x1d;

function sizeByte(size: PrintSize | undefined): number {
  switch (size) {
    case 'double':
      return 0x11;
    case 'wide':
      return 0x10;
    case 'tall':
      return 0x01;
    default:
      return 0x00;
  }
}

function qrBytes(data: string): number[] {
  const payload = [...new TextEncoder().encode(data)];
  const len = payload.length + 3;
  return [
    GS,
    0x28,
    0x6b,
    0x04,
    0x00,
    0x31,
    0x41,
    0x32,
    0x00, // model 2
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x43,
    0x06, // module size 6
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x45,
    0x31, // error correction M
    GS,
    0x28,
    0x6b,
    len & 0xff,
    len >> 8,
    0x31,
    0x50,
    0x30,
    ...payload, // store
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x51,
    0x30, // print
  ];
}

function cutBytes(cut: CutCommand): number[] {
  switch (cut) {
    case 'GS_V_66':
      return [GS, 0x56, 0x42, 0x00];
    case 'GS_V_1':
      return [0x0a, 0x0a, 0x0a, GS, 0x56, 0x01];
    case 'ESC_m':
      return [0x0a, 0x0a, 0x0a, ESC, 0x6d];
    case 'none':
      return [0x0a, 0x0a, 0x0a];
  }
}

/** Bytes for the printer: init, code page, the lines with styles, copies and the cut. */
export function encodeEscPos(
  doc: PrintDocument,
  options: {
    profile: PrinterProfile;
    width: PaperWidth;
    withoutAccents?: boolean;
    copies?: number;
  },
): Uint8Array {
  const { profile, width } = options;
  const cols = columnsFor(width);
  const text = (s: string) => encodeText(s, profile.codepage, options.withoutAccents);
  const one: number[] = [ESC, 0x40, ESC, 0x74, profile.codepageCommand];
  const align = (a: PrintAlign | undefined) => [
    ESC,
    0x61,
    a === 'center' ? 1 : a === 'right' ? 2 : 0,
  ];
  for (const line of doc.lines) {
    switch (line.kind) {
      case 'text': {
        const avail = Math.floor(cols / widthFactor(line.size));
        const invert = line.invert && profile.invert;
        const content = line.invert && !profile.invert ? `*** ${line.text} ***` : line.text;
        one.push(...align(line.align), GS, 0x21, sizeByte(line.size));
        if (line.bold || line.invert) one.push(ESC, 0x45, 1);
        if (invert) one.push(GS, 0x42, 1);
        for (const l of wrapText(content, avail)) one.push(...text(invert ? ` ${l} ` : l), 0x0a);
        if (invert) one.push(GS, 0x42, 0);
        if (line.bold || line.invert) one.push(ESC, 0x45, 0);
        one.push(GS, 0x21, 0);
        break;
      }
      case 'columns': {
        one.push(...align('left'), GS, 0x21, sizeByte(line.size));
        if (line.bold) one.push(ESC, 0x45, 1);
        const avail = Math.floor(cols / widthFactor(line.size));
        for (const l of columnLine(line.left, line.right, avail)) one.push(...text(l), 0x0a);
        if (line.bold) one.push(ESC, 0x45, 0);
        one.push(GS, 0x21, 0);
        break;
      }
      case 'divider':
        one.push(...align('left'), ...text((line.char ?? '-').repeat(cols)), 0x0a);
        break;
      case 'feed':
        for (let i = 0; i < (line.lines ?? 1); i++) one.push(0x0a);
        break;
      case 'qr':
        one.push(...align('center'));
        if (profile.qr) one.push(...qrBytes(line.data), 0x0a);
        else for (const l of wrapText(line.data, cols)) one.push(...text(l), 0x0a);
        if (line.caption) for (const l of wrapText(line.caption, cols)) one.push(...text(l), 0x0a);
        one.push(...align('left'));
        break;
      case 'beep':
        if (profile.beep) one.push(ESC, 0x42, 0x02, 0x02);
        break;
    }
  }
  one.push(...cutBytes(profile.cut));
  const copies = Math.max(1, Math.min(options.copies ?? 1, 5));
  const out = new Uint8Array(one.length * copies);
  for (let i = 0; i < copies; i++) out.set(one, i * one.length);
  return out;
}

/** DLE EOT 4 (paper roll sensor): paper end bits (5–6) set. */
export const isPaperOut = (status: number): boolean => (status & 0x60) === 0x60;
/** DLE EOT 1 (printer status): offline bit (3). */
export const isOffline = (status: number): boolean => (status & 0x08) === 0x08;

// ---------------------------------------------------------------------------
// Queue rules

/** A job printed this long after it was created is marked "atrasada". */
export const DELAYED_AFTER_MS = 2 * 60_000;

/** On lease: print now, print with the "atrasada" mark, or hold for the panel (too old). */
export function printTiming(
  createdAt: Date | string,
  now: Date,
  holdAfterMinutes: number,
): 'PRINT' | 'PRINT_DELAYED' | 'HOLD' {
  const age = now.getTime() - new Date(createdAt).getTime();
  if (age > holdAfterMinutes * 60_000) return 'HOLD';
  return age > DELAYED_AFTER_MS ? 'PRINT_DELAYED' : 'PRINT';
}

/** Retry after a failed print: 5 s, 15 s, 30 s, then every minute. */
export function retryDelayMs(attempt: number): number {
  return [5_000, 15_000, 30_000][attempt - 1] ?? 60_000;
}

/** A failing job is shown as an alert in the panel after this long. */
export const FAILING_ALERT_MS = 2 * 60_000;

/** The agent sends a heartbeat every 30 s; after 90 s without one it is offline. */
export const AGENT_HEARTBEAT_MS = 30_000;
export const agentOnline = (lastSeenAt: Date | string | null, now: Date): boolean =>
  !!lastSeenAt && now.getTime() - new Date(lastSeenAt).getTime() <= 3 * AGENT_HEARTBEAT_MS;

/** Header lines added when printing: late, possibly duplicated or a reprint. */
export function printMarks(
  doc: PrintDocument,
  marks: { delayedFrom?: string; possibleDuplicate?: boolean; reprint?: boolean },
): PrintDocument {
  const head: PrintLine[] = [];
  if (marks.reprint) head.push({ kind: 'text', text: '2ª VIA', align: 'center', invert: true });
  if (marks.possibleDuplicate) {
    head.push({ kind: 'text', text: 'POSSÍVEL 2ª VIA - confira', align: 'center', invert: true });
  }
  if (marks.delayedFrom) {
    head.push(
      { kind: 'text', text: 'IMPRESSÃO ATRASADA', align: 'center', invert: true },
      {
        kind: 'text',
        text: `Pedido das ${marks.delayedFrom}: confira se já foi feito`,
        align: 'center',
      },
    );
  }
  return head.length ? { ...doc, lines: [...head, { kind: 'feed' }, ...doc.lines] } : doc;
}
