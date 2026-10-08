import { PrintAgent, memoryMb } from './agent.js';
import { AGENT_VERSION, credentialFile, logsDir, parseArgs } from './config.js';
import { FileCredentialStore } from './credential.js';
import { listenWithRetry, watchParent } from './lifecycle.js';
import { startLocalPage } from './local-page.js';
import { Logger, errorText } from './log.js';

/** Print agent entry point (Windows service through WinSW, or `pnpm start:virtual` in dev). */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.showVersion) {
    process.stdout.write(`${AGENT_VERSION}\n`);
    return;
  }
  const log = new Logger(logsDir(options.dataDir));
  const agent = new PrintAgent(
    options,
    new FileCredentialStore(credentialFile(options.dataDir)),
    log,
  );
  log.info('Agente de impressão iniciando', {
    version: AGENT_VERSION,
    data: options.dataDir,
    virtual: options.virtual,
  });

  process.on('unhandledRejection', (error) =>
    log.error('Erro não tratado', { error: errorText(error) }),
  );
  // After a restart the old instance may still hold the port for a few seconds.
  const server = await listenWithRetry(() => startLocalPage(agent, options.port), {
    onRetry: (attempt) =>
      log.warn('Porta da página local ocupada; tentando de novo', { port: options.port, attempt }),
  });
  log.info(`Página local: http://127.0.0.1:${options.port}`);
  await agent.start();

  // Memory on modest PCs (target in docs/SETUP.md): logged every 30 minutes.
  const memory = setInterval(() => log.info('Memória', { rssMb: memoryMb() }), 30 * 60_000);
  memory.unref();

  const shutdown = () => {
    log.info('Agente de impressão parando');
    agent.stop();
    server.close();
    setTimeout(() => process.exit(0), 500).unref();
  };
  // The service process (WinSW) died: leave too, so Windows restarts one clean instance.
  watchParent(() => {
    log.warn('Processo do serviço encerrado; saindo para o Windows reiniciar o serviço');
    shutdown();
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
