import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
  // How many events one instance handles at the same time.
  PREFETCH_COUNT: z.coerce.number().int().min(1).max(100).default(10),
});

export type Env = z.infer<typeof envSchema>;
