import { spawn } from 'node:child_process';

/**
 * Runs a Windows PowerShell 5.1 script (present on every Windows 10/11). The script goes
 * encoded on the command line; values (printer names, secrets) go through stdin, never in the
 * command line (visible to other processes) nor interpolated in the script (no injection).
 */
export function runPowerShell(script: string, stdin = '', timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('PowerShell não respondeu a tempo'));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8').trim();
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(Buffer.concat(err).toString('utf8').trim() || `PowerShell saiu com ${code}`),
        );
    });
    child.stdin.end(stdin, 'utf8');
  });
}
