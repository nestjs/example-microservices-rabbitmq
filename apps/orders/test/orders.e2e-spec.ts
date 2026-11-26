import { fileURLToPath } from 'node:url';
import { getDrizzleToken } from '@nestjs/drizzle';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { Outbox, OutboxRelay } from '@nestjs/outbox';
import { NodeAdapter, type NestNodeApplication } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import { FULFILLMENT_EVENTS_QUEUE, fulfillmentEventsQueueOptions } from '@app/contracts';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { shipments } from '../../fulfillment/src/database/schema.js';
import {
  brokerProxy,
  eventually,
  fulfillmentDatabase,
  purgeQueues,
  rabbitmqUrl,
  startWorker,
} from '../../fulfillment/test/support.js';
import { AppModule, FULFILLMENT_EVENTS } from '../src/app.module.js';
import { orders } from '../src/database/schema.js';

const ordersDatabaseUrl = process.env.TEST_ORDERS_DATABASE_URL;

describe.skipIf(!rabbitmqUrl || !ordersDatabaseUrl)('Orders to fulfillment (e2e)', () => {
  const ordersDb = drizzle({ client: new Pool({ connectionString: ordersDatabaseUrl }) });
  let fulfillmentDb: Awaited<ReturnType<typeof fulfillmentDatabase>>;
  let proxy: Awaited<ReturnType<typeof brokerProxy>>;
  let app: NestNodeApplication;
  let worker: NestNodeApplication | undefined;

  beforeAll(async () => {
    await migrate(ordersDb, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    fulfillmentDb = await fulfillmentDatabase();
    await purgeQueues();
    await ordersDb.execute(sql`TRUNCATE orders`);
    await fulfillmentDb.execute(sql`TRUNCATE shipments`);
    // The orders service reaches the broker through a proxy the tests can cut.
    proxy = await brokerProxy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDrizzleToken())
      .useValue(ordersDb) // the outbox's store runs on it too
      .overrideProvider(FULFILLMENT_EVENTS)
      .useValue(
        ClientProxyFactory.create({
          transport: Transport.RMQ,
          options: {
            urls: [proxy.url],
            queue: FULFILLMENT_EVENTS_QUEUE,
            queueOptions: fulfillmentEventsQueueOptions,
            persistent: true,
          },
        }),
      )
      .compile();
    app = moduleRef.createNestApplication<NestNodeApplication>(new NodeAdapter(), { logger: process.env.TEST_LOGS ? undefined : false });
    await app.init();
    worker = await startWorker();
  });

  afterAll(async () => {
    await worker?.close();
    await app.close(); // closes the orders pool too
    await proxy.close();
    await fulfillmentDb.$client.end();
  });

  const placeOrder = () =>
    app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        customerEmail: 'ada@example.com',
        shippingAddress: '1 Analytical Way, London',
        items: [{ sku: 'KB-01', quantity: 2 }],
      },
    });
  const shipmentCount = async () => (await fulfillmentDb.select({ orderId: shipments.orderId }).from(shipments)).length;

  it('places an order, and the fulfillment service ships it', async () => {
    const placed = await placeOrder();
    expect(placed.statusCode).toBe(201);
    const { id } = placed.json<{ id: string }>();

    const shipment = await eventually(async () => {
      const res = await app.inject({ method: 'GET', url: `/orders/${id}/shipment` });
      return res.statusCode === 200 && res.json();
    });
    expect(shipment).toMatchObject({ orderId: id, status: 'preparing', items: [{ sku: 'KB-01', quantity: 2 }] });
  });

  it('publishes nothing when the order rolls back', async () => {
    const before = await shipmentCount();
    const outbox = app.get(Outbox);
    const add = outbox.add.bind(outbox);
    vi.spyOn(outbox, 'add').mockImplementationOnce(async (tx, messages) => {
      await add(tx, messages); // the message is written...
      throw new Error('Connection terminated unexpectedly'); // ...then the transaction fails
    });

    expect((await placeOrder()).statusCode).toBe(500);
    expect(await app.get(OutboxRelay).stats()).toMatchObject({ pending: 0 });

    // The next order goes out alone: the rolled-back one never existed.
    expect((await placeOrder()).statusCode).toBe(201);
    await eventually(async () => (await shipmentCount()) === before + 1);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await shipmentCount()).toBe(before + 1);
    expect(await ordersDb.$count(orders)).toBe(before + 1);
  });

  it('accepts orders while the broker is down, and publishes them once it is back', async () => {
    const before = await shipmentCount();
    await proxy.close();

    const placed = await placeOrder();
    expect(placed.statusCode).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await shipmentCount()).toBe(before);
    expect(await app.get(OutboxRelay).stats()).toMatchObject({ pending: 1 });

    await proxy.open();
    await eventually(async () => (await shipmentCount()) === before + 1, 40_000);
    expect(await app.get(OutboxRelay).stats()).toMatchObject({ pending: 0, deadLetters: 0 });
  });

  it('answers 503 when the fulfillment service does not answer in time', async () => {
    const { id } = (await placeOrder()).json<{ id: string }>();
    await worker!.close();
    worker = undefined;

    const started = Date.now();
    const res = await app.inject({ method: 'GET', url: `/orders/${id}/shipment` });

    expect(res.statusCode).toBe(503);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_900); // the request's timeout
  });
});
