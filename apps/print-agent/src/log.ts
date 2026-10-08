import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 1_000_000;
const KEEP = 3;

/** Small rotating log (agent.log, agent.log.1 … .3) next to the console. */
export class Logger {
  private readonly file: string | null;

  constructor(dir: string | null) {
    if (dir) mkdirSync(dir, { recursive: true });
    this.file = dir ? join(dir, 'agent.log') : null;
  }

  info(message: string, extra?: Record<string, unknown>): void {
    this.write('INFO', message, extra);
  }

  warn(message: string, extra?: Record<string, unknown>): void {
    this.write('WARN', message, extra);
  }

  error(message: string, extra?: Record<string, unknown>): void {
    this.write('ERROR', message, extra);
  }

  private write(level: string, message: string, extra?: Record<string, unknown>): void {
    const line = `${new Date().toISOString()} ${level} ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}`;
    (level === 'ERROR' ? process.stderr : process.stdout).write(`${line}\n`);
    if (!this.file) return;
    try {
      this.rotate(this.file);
      appendFileSync(this.file, `${line}\n`, 'utf8');
    } catch {
      // Logging must never stop printing.
    }
  }

  private rotate(file: string): void {
    if (!existsSync(file) || statSync(file).size < MAX_BYTES) return;
    rmSync(`${file}.${KEEP}`, { force: true });
    for (let i = KEEP - 1; i >= 1; i--) {
      if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    }
    renameSync(file, `${file}.1`);
  }
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
