import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DrizzleModule, getDrizzleToken } from '@nestjs/drizzle';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { createObserveModule } from '@nestjs/observe';
import { ClientProxyTransport, OutboxModule, OutboxStorage } from '@nestjs/outbox';
import { fromDrizzle, PostgresOutboxStore } from '@nestjs/outbox/postgres';
import { FULFILLMENT_EVENTS_QUEUE, fulfillmentEventsQueueOptions } from '@app/contracts';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { envSchema, type Env } from './config.js';
import { HealthModule } from './health/health.module.js';
import { OrdersModule } from './orders/orders.module.js';

export const FULFILLMENT_EVENTS = 'FULFILLMENT_EVENTS';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // First, so it shuts down last and still sends what the other modules did.
    ObserveModule.forRoot({
      // Empty until `npx @nestjs/observe link` writes the key pair into .env: the SDK then sends nothing.
      appKey: process.env.OBSERVE_APP_KEY ?? '',
      appSecret: process.env.OBSERVE_APP_SECRET ?? '',
      serviceId: 'orders',
    }),
    ConfigModule.forRoot({ isGlobal: true, envFilePath: 'apps/orders/.env', validationSchema: envSchema }),
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        drizzle,
        connection: config.get('DATABASE_URL', { infer: true }),
      }),
    }),
    OutboxModule.forRootAsync({
      imports: [
        ClientsModule.registerAsync([
          {
            name: FULFILLMENT_EVENTS,
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>) => ({
              transport: Transport.RMQ,
              options: {
                urls: [config.get('RABBITMQ_URL', { infer: true })],
                queue: FULFILLMENT_EVENTS_QUEUE,
                queueOptions: fulfillmentEventsQueueOptions,
                // Written to disk by the broker, so a broker restart keeps them.
                persistent: true,
              },
            }),
          },
        ]),
      ],
      // Publishes with the client's emit(), which resolves once the broker confirmed the message.
      transports: { fulfillment: ClientProxyTransport(FULFILLMENT_EVENTS) },
      useFactory: () => ({
        relay: { pollInterval: '1s', publishTimeout: '10s' },
        // Retries for 30 to 60 minutes, through a broker outage, before dead-lettering.
        retry: { attempts: 70, backoff: { delay: '1s', maxDelay: '1m' } },
      }),
    }),
    OrdersModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: StandardSchemaValidationPipe },
    {
      // The outbox's messages, in this service's database (schema nest_outbox).
      provide: PostgresOutboxStore,
      inject: [getDrizzleToken(), OutboxStorage],
      useFactory: (db: NodePgDatabase, outboxStorage: OutboxStorage) =>
        new PostgresOutboxStore({ executor: fromDrizzle(db) }, outboxStorage),
    },
  ],
})
export class AppModule {}
