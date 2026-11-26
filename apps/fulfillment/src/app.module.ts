import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { createObserveModule } from '@nestjs/observe';
import { drizzle } from 'drizzle-orm/node-postgres';
import { envSchema, type Env } from './config.js';
import { HealthModule } from './health/health.module.js';
import { DeadLetterQueue } from './messaging/dead-letter-queue.js';
import { ShipmentsModule } from './shipments/shipments.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // First, so it shuts down last and still sends what the other modules did.
    ObserveModule.forRoot({
      // Empty until `npx @nestjs/observe link` writes the key pair into .env: the SDK then sends nothing.
      appKey: process.env.OBSERVE_APP_KEY ?? '',
      appSecret: process.env.OBSERVE_APP_SECRET ?? '',
      serviceId: 'fulfillment',
    }),
    ConfigModule.forRoot({ isGlobal: true, envFilePath: 'apps/fulfillment/.env', validationSchema: envSchema }),
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        drizzle,
        connection: config.get('DATABASE_URL', { infer: true }),
      }),
    }),
    ShipmentsModule,
    HealthModule,
  ],
  providers: [DeadLetterQueue],
})
export class AppModule {}
