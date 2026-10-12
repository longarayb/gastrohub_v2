/* eslint-disable no-console -- command line tool */
/**
 * Platform admin commands, run ON THE SERVER, never through the HTTP API (D041):
 *
 *   create          creates an administrator with a temporary password (printed once; expires
 *                   unused after 24 h; changed right after the first 2FA step)
 *                   --email <e-mail> --name "<name>"
 *   reset-password  new temporary password (forgotten, or the first one expired); sessions end,
 *                   the 2FA stays. Recorded in the platform audit.
 *                   --email <e-mail> --reason "<why>" [--operator "<who runs it>"]
 *   reset-2fa  emergency: erases an admin's authenticator, recovery codes and sessions; the next
 *              login enrolls the 2FA again. Recorded in the platform audit.
 *              --email <e-mail> --reason "<why>" [--operator "<who runs it>"]
 *
 * Development: pnpm --filter @app/api build && pnpm --filter @app/api platform:admin -- <command> ...
 * Production (container): node dist/cli/platform-admin.js <command> ...
 */
import { randomBytes } from 'node:crypto';
import { PLATFORM_TEMP_PASSWORD_HOURS } from '@app/shared';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ClsModule } from 'nestjs-cls';
import { AppConfigModule } from '../core/config/config.module.js';
import { PrismaModule } from '../core/prisma/prisma.module.js';
import { PasswordService } from '../modules/auth/password.service.js';
import { PlatformAuditService } from '../modules/platform/platform-audit.service.js';
import { PlatformAuthService } from '../modules/platform/platform-auth.service.js';

@Module({
  imports: [
    AppConfigModule,
    ClsModule.forRoot({ global: true }),
    PrismaModule,
    JwtModule.register({}),
  ],
  providers: [PasswordService, PlatformAuditService, PlatformAuthService],
})
class PlatformCliModule {}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function usage(message?: string): never {
  if (message) console.error(`Erro: ${message}\n`);
  console.error(`Uso:
  platform-admin create --email <e-mail> --name "<nome>"
  platform-admin reset-password --email <e-mail> --reason "<motivo>" [--operator "<quem executa>"]
  platform-admin reset-2fa --email <e-mail> --reason "<motivo>" [--operator "<quem executa>"]`);
  process.exit(1);
}

async function main(): Promise<void> {
  // `pnpm ... platform:admin -- create` passes the "--" through: skip it.
  const command = process.argv.slice(2).find((arg) => arg !== '--');
  if (command !== 'create' && command !== 'reset-password' && command !== 'reset-2fa') usage();
  const email = arg('email')?.trim().toLowerCase();
  if (!email) usage('informe --email');

  const app = await NestFactory.createApplicationContext(PlatformCliModule, { logger: ['error'] });
  try {
    const auth = app.get(PlatformAuthService);
    const actor = {
      adminId: null,
      email: `cli:${arg('operator') ?? process.env.USER ?? process.env.USERNAME ?? 'servidor'}`,
      ip: null,
      userAgent: 'platform-admin (linha de comando)',
    };
    if (command === 'create') {
      const name = arg('name')?.trim();
      if (!name) usage('informe --name');
      const password = temporaryPassword();
      await auth.createAdmin({ email, name, password, temporary: true }, actor);
      console.log(`\nAdministrador criado: ${email}`);
      printTemporaryPassword(password);
      console.log(
        'No primeiro acesso: cadastrar o aplicativo autenticador (2FA) e trocar esta senha.\n',
      );
    } else if (command === 'reset-password') {
      const reason = arg('reason')?.trim();
      if (!reason || reason.length < 5) usage('informe --reason (mínimo de 5 caracteres)');
      const password = temporaryPassword();
      await auth.resetPassword(email, password, reason, actor);
      console.log(`\nNova senha temporária para ${email} (sessões encerradas; o 2FA continua).`);
      printTemporaryPassword(password);
      console.log('Registrado na auditoria da plataforma (auth.password_reset_server).\n');
    } else {
      const reason = arg('reason')?.trim();
      if (!reason || reason.length < 5) usage('informe --reason (mínimo de 5 caracteres)');
      await auth.resetTwoFactor(email, reason, actor);
      console.log(
        `\n2FA de ${email} redefinido. Sessões encerradas e códigos de recuperação apagados.`,
      );
      console.log('No próximo login, o painel pede para cadastrar o autenticador de novo.');
      console.log('Registrado na auditoria da plataforma (auth.totp_reset_emergency).\n');
    }
  } finally {
    await app.close();
  }
}

function temporaryPassword(): string {
  return randomBytes(12).toString('base64url');
}

function printTemporaryPassword(password: string): void {
  console.log(`Senha temporária (mostrada só agora): ${password}`);
  console.log(
    `Vale por ${PLATFORM_TEMP_PASSWORD_HOURS} h se não for usada e precisa ser trocada logo depois do 2FA.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
