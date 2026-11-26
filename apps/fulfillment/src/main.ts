import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NodeAdapter, type NestNodeApplication } from '@nestjs/platform-node';
import { AppModule, ObserveInstrument } from './app.module.js';
import type { Env } from './config.js';
import { eventsServer, requestsServer } from './messaging/transport.js';

const app = await NestFactory.create<NestNodeApplication>(AppModule, new NodeAdapter(), {
  instrument: ObserveInstrument,
  logger: new ConsoleLogger({ json: process.env.NODE_ENV === 'production' }),
});
// On SIGTERM: stop consuming, finish the messages in flight, then close the pool.
app.enableShutdownHooks();

const config = app.get<ConfigService<Env, true>>(ConfigService);
const rabbitmq = {
  RABBITMQ_URL: config.get('RABBITMQ_URL', { infer: true }),
  PREFETCH_COUNT: config.get('PREFETCH_COUNT', { infer: true }),
};
app.connectMicroservice(eventsServer(rabbitmq));
app.connectMicroservice(requestsServer(rabbitmq));

// The HTTP server (health checks) first: every module is initialized before a message arrives.
await app.listen(config.get('PORT', { infer: true }));
await app.startAllMicroservices();
