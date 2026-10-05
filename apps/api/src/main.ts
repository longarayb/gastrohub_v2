import 'reflect-metadata';
import { BRAND } from '@app/shared';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AppConfig } from './core/config/app-config.service.js';
import { setupApp } from './setup-app.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  // Errors outside any request (fire-and-forget promises, queue and socket callbacks):
  // log them with the full stack. An uncaught exception leaves the process in an unknown
  // state, so it exits after giving the logger time to flush (the supervisor restarts it).
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Promessa rejeitada sem tratamento');
  });
  process.on('uncaughtException', (err, origin) => {
    logger.error({ err, origin }, 'Exceção não tratada; encerrando o processo');
    setTimeout(() => process.exit(1), 500);
  });
  setupApp(app);

  const config = app.get(AppConfig);

  const swaggerConfig = new DocumentBuilder()
    .setTitle(`${config.get('APP_NAME')} API`)
    .setDescription(BRAND.tagline)
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, swaggerConfig));

  const port = config.get('API_PORT');
  await app.listen(port);
  logger.log(`API em http://localhost:${port}/api — Swagger em http://localhost:${port}/docs`);
}

void bootstrap();
