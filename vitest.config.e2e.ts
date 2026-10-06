import { defineConfig } from 'vitest/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/setup-db.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5439/postgres',
      // One connection: a query accidentally run outside an open transaction hangs and fails the test.
      DB_POOL_MAX: '1',
      JWT_SECRET: 'e2e-test-secret-that-is-long-enough-123456',
      THROTTLE_DISABLED: 'true',
      UPLOAD_DIR: join(tmpdir(), 'hiq-e2e-uploads'),
      SERVICE_AREAS: 'Makati City,Laguna',
      SUBSCRIPTIONS_ENABLED: 'false',
    },
  },
});
