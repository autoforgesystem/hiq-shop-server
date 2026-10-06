import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Vitest global setup for e2e tests: an in-memory Postgres (PGlite) on port 5439 with all migrations applied.
 * No Docker or local Postgres needed. The port matches DATABASE_URL in vitest.config.e2e.ts.
 */
export default async function setup() {
  const db = await PGlite.create();
  const dir = resolve('prisma/migrations');
  for (const m of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    await db.exec(readFileSync(resolve(dir, m, 'migration.sql'), 'utf8'));
  }
  const server = new PGLiteSocketServer({ db, port: 5439, host: '127.0.0.1', maxConnections: 10 });
  await server.start();
  return async () => {
    await server.stop();
    await db.close();
  };
}
