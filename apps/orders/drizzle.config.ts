import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Locally, the service's .env file; in CI and production, the environment.
if (existsSync('apps/orders/.env')) {
  process.loadEnvFile('apps/orders/.env');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/orders/src/database/schema.ts',
  out: './apps/orders/drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
