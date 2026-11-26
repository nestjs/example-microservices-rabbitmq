import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // The test files share one broker and its queues.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: 'postgres://unused-in-tests',
      RABBITMQ_URL: process.env.TEST_RABBITMQ_URL ?? 'amqp://unused-in-tests',
    },
  },
});
