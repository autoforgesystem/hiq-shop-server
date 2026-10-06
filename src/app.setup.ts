import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Env } from './config/env.js';

/** Shared by main.ts and the e2e tests, so tests run the same pipes and prefix as production. */
export function configureApp(app: NestExpressApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });
  // Large enough for catalogue imports that carry photos as data URLs.
  app.useBodyParser('json', { limit: '25mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const uploads = resolve(config.get('UPLOAD_DIR', { infer: true }));
  mkdirSync(uploads, { recursive: true });
  app.useStaticAssets(uploads, { prefix: '/uploads', maxAge: '30d', immutable: true });
  app.enableShutdownHooks();
  return app;
}
