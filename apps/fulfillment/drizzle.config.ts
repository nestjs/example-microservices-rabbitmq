import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Locally, the service's .env file; in CI and production, the environment.
if (existsSync('apps/fulfillment/.env')) {
  process.loadEnvFile('apps/fulfillment/.env');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/fulfillment/src/database/schema.ts',
  out: './apps/fulfillment/drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
