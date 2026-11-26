import { createServer, connect as connectTcp, type Server, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { getDrizzleToken } from '@nestjs/drizzle';
import { NodeAdapter, type NestNodeApplication } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import {
  FULFILLMENT_EVENTS_DEAD_LETTER_QUEUE,
  FULFILLMENT_EVENTS_QUEUE,
  FULFILLMENT_REQUESTS_QUEUE,
  fulfillmentEventsQueueOptions,
  fulfillmentRequestsQueueOptions,
} from '@app/contracts';
import { connect } from 'amqplib';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module.js';
import { eventsServer, requestsServer } from '../src/messaging/transport.js';

export const rabbitmqUrl = process.env.TEST_RABBITMQ_URL!;
export const fulfillmentDatabaseUrl = process.env.TEST_FULFILLMENT_DATABASE_URL!;

/** The fulfillment database, migrated. */
export async function fulfillmentDatabase() {
  const db = drizzle({ client: new Pool({ connectionString: fulfillmentDatabaseUrl }) });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  return db;
}

/** Empties the fulfillment queues, so a test sees only its own messages. */
export async function purgeQueues() {
  const connection = await connect(rabbitmqUrl);
  const channel = await connection.createChannel();
  const queues = [
    [FULFILLMENT_EVENTS_QUEUE, fulfillmentEventsQueueOptions],
    [FULFILLMENT_EVENTS_DEAD_LETTER_QUEUE, { durable: true, arguments: { 'x-queue-type': 'quorum' } }],
    [FULFILLMENT_REQUESTS_QUEUE, fulfillmentRequestsQueueOptions],
  ] as const;
  for (const [queue, options] of queues) {
    await channel.assertQueue(queue, options);
    await channel.purgeQueue(queue);
  }
  await connection.close();
}

/** The messages in the dead-letter queue, taken out of it. */
export async function takeDeadLetters() {
  const connection = await connect(rabbitmqUrl);
  const channel = await connection.createChannel();
  const letters = [];
  for (let message; (message = await channel.get(FULFILLMENT_EVENTS_DEAD_LETTER_QUEUE, { noAck: true })); ) {
    letters.push({ body: JSON.parse(message.content.toString()), headers: message.properties.headers ?? {} });
  }
  await connection.close();
  return letters;
}

/** Starts an instance of the fulfillment worker, with a pool of its own. */
export async function startWorker(options: { rabbitmqUrl?: string; prefetchCount?: number; gracePeriod?: number } = {}) {
  const db = drizzle({ client: new Pool({ connectionString: fulfillmentDatabaseUrl }) });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getDrizzleToken())
    .useValue(db)
    .compile();
  const app = moduleRef.createNestApplication<NestNodeApplication>(new NodeAdapter(), { logger: process.env.TEST_LOGS ? undefined : false });
  const config = { RABBITMQ_URL: options.rabbitmqUrl ?? rabbitmqUrl, PREFETCH_COUNT: options.prefetchCount ?? 10 };
  const events = eventsServer(config);
  if (options.gracePeriod !== undefined) {
    events.options!.gracePeriod = options.gracePeriod;
  }
  app.connectMicroservice(events);
  app.connectMicroservice(requestsServer(config));
  await app.init();
  await app.startAllMicroservices();
  return app;
}

/** A TCP proxy to the broker: closing it cuts every connection through it, as a crash or an outage would. */
export async function brokerProxy() {
  const target = new URL(rabbitmqUrl);
  const sockets = new Set<Socket>();
  let server: Server | undefined;
  let port = 0;
  const open = async () => {
    server = createServer((client) => {
      const upstream = connectTcp(Number(target.port || 5672), target.hostname);
      for (const socket of [client, upstream]) {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {
          client.destroy();
          upstream.destroy();
        });
      }
      client.pipe(upstream).pipe(client);
    });
    await new Promise<void>((resolve) => server!.listen(port, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  };
  await open();
  const url = new URL(rabbitmqUrl);
  url.hostname = '127.0.0.1';
  url.port = String(port);
  return {
    url: url.toString(),
    open,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise((resolve) => server?.close(resolve));
    },
  };
}

/** Polls `check` until it returns a truthy value. */
export async function eventually<T>(check: () => Promise<T>, timeout = 20_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
