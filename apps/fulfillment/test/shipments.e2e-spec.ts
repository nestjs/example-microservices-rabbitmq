import { randomUUID } from 'node:crypto';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { ClientProxyFactory, Transport, type ClientProxy } from '@nestjs/microservices';
import {
  FULFILLMENT_EVENTS_QUEUE,
  ORDER_PLACED,
  fulfillmentEventsQueueOptions,
  type OrderPlacedEnvelope,
} from '@app/contracts';
import { eq, sql } from 'drizzle-orm';
import { lastValueFrom } from 'rxjs';
import { shipments } from '../src/database/schema.js';
import { ShipmentsService } from '../src/shipments/shipments.service.js';
import {
  brokerProxy,
  eventually,
  fulfillmentDatabase,
  fulfillmentDatabaseUrl,
  purgeQueues,
  rabbitmqUrl,
  startWorker,
  takeDeadLetters,
} from './support.js';

// The retry backoff, shortened: the broker's delivery limit is what's under test.
vi.mock('node:timers/promises', async (importOriginal) => {
  const timers = await importOriginal<typeof import('node:timers/promises')>();
  return { ...timers, setTimeout: (ms: number) => timers.setTimeout(Math.min(ms, 20)) };
});

describe.skipIf(!rabbitmqUrl || !fulfillmentDatabaseUrl)('Fulfillment worker (e2e)', () => {
  let db: Awaited<ReturnType<typeof fulfillmentDatabase>>;
  let producer: ClientProxy;
  const workers: NestNodeApplication[] = [];

  beforeAll(async () => {
    db = await fulfillmentDatabase();
    // Publishes the way the orders service does: to the events queue, persistent, confirmed.
    producer = ClientProxyFactory.create({
      transport: Transport.RMQ,
      options: {
        urls: [rabbitmqUrl],
        queue: FULFILLMENT_EVENTS_QUEUE,
        queueOptions: fulfillmentEventsQueueOptions,
        persistent: true,
      },
    });
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE shipments`);
    await purgeQueues();
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await producer.close();
    await db.$client.end();
  });

  async function worker(options?: Parameters<typeof startWorker>[0]) {
    const app = await startWorker(options);
    workers.push(app);
    return { app, createFor: vi.spyOn(app.get(ShipmentsService), 'createFor') };
  }

  function orderPlaced(): OrderPlacedEnvelope {
    const orderId = randomUUID();
    return {
      id: randomUUID(),
      topic: ORDER_PLACED,
      key: orderId,
      headers: {},
      createdAt: Date.now(),
      payload: {
        orderId,
        customerEmail: 'ada@example.com',
        shippingAddress: '1 Analytical Way, London',
        items: [{ sku: 'KB-01', quantity: 1 }],
        placedAt: new Date().toISOString(),
      },
    };
  }

  const publish = (data: unknown) => lastValueFrom(producer.emit(ORDER_PLACED, data), { defaultValue: undefined });
  const shipmentCount = async () => (await db.select({ orderId: shipments.orderId }).from(shipments)).length;

  it('creates one shipment per order, and acknowledges a redelivered copy as a duplicate', async () => {
    const { app, createFor } = await worker();
    const service = app.get(ShipmentsService);
    // Both copies reach the database at the same time, as they can on two instances.
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => (release = resolve));
    createFor.mockImplementation(async (event) => {
      if (createFor.mock.calls.length === 2) {
        release();
      }
      await bothArrived;
      return ShipmentsService.prototype.createFor.call(service, event);
    });
    const event = orderPlaced();

    await publish(event);
    await publish(event); // the outbox republishes a message whose confirmation it missed

    await eventually(async () => createFor.mock.calls.length === 2);
    const created = await Promise.all(createFor.mock.results.map((result) => result.value));
    expect(created.sort()).toEqual([false, true]); // one of them created the shipment
    expect(await shipmentCount()).toBe(1);
    expect(await takeDeadLetters()).toEqual([]);
  });

  it('dead-letters a message that breaks the contract, without retrying it', async () => {
    const { createFor } = await worker();

    await publish({ id: randomUUID(), payload: { orderId: 'not-a-uuid' } });

    const letter = await eventually(async () => (await takeDeadLetters()).at(0));
    expect(letter.body.data.payload).toEqual({ orderId: 'not-a-uuid' });
    expect(letter.headers).toMatchObject({ 'x-attempts': 1, 'x-error': expect.stringContaining('Invalid UUID') });
    expect(createFor).not.toHaveBeenCalled();
  });

  it('retries a failed event, and creates the shipment once it succeeds', async () => {
    const { createFor } = await worker();
    createFor.mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));
    const event = orderPlaced();

    await publish(event);

    await eventually(async () => (await shipmentCount()) === 1);
    expect(createFor).toHaveBeenCalledTimes(2);
  });

  it('dead-letters an event that keeps failing, with its error, after its last attempt', async () => {
    const { createFor } = await worker();
    createFor.mockRejectedValue(new Error('Bug: column "items" does not exist'));
    const event = orderPlaced();

    await publish(event);

    const letter = await eventually(async () => (await takeDeadLetters()).at(0));
    expect(letter.body.data.id).toBe(event.id);
    expect(letter.headers).toMatchObject({ 'x-attempts': 5, 'x-error': 'Error: Bug: column "items" does not exist' });
    expect(createFor).toHaveBeenCalledTimes(5); // MAX_ATTEMPTS
  });

  it('delivers an event again when the worker handling it crashes before acknowledging it', async () => {
    const proxy = await brokerProxy();
    const crashing = await worker({ rabbitmqUrl: proxy.url, gracePeriod: 200 });
    crashing.createFor.mockReturnValue(new Promise(() => {})); // never finishes
    const event = orderPlaced();

    await publish(event);
    await eventually(async () => crashing.createFor.mock.calls.length === 1);
    const survivor = await worker();
    await proxy.close(); // the crashing worker's connection drops, with the event unacknowledged

    await eventually(async () => (await shipmentCount()) === 1);
    expect(survivor.createFor).toHaveBeenCalledTimes(1);
  });

  it('shares events between workers, each handled once', async () => {
    const first = await worker({ prefetchCount: 1 });
    const second = await worker({ prefetchCount: 1 });
    const events = Array.from({ length: 20 }, orderPlaced);

    await Promise.all(events.map(publish));

    await eventually(async () => (await shipmentCount()) === 20);
    expect(first.createFor.mock.calls.length).toBeGreaterThan(0);
    expect(second.createFor.mock.calls.length).toBeGreaterThan(0);
    expect(first.createFor.mock.calls.length + second.createFor.mock.calls.length).toBe(20);
  });

  it('finishes the event in flight when it shuts down', async () => {
    const stopping = await worker();
    const service = stopping.app.get(ShipmentsService);
    stopping.createFor.mockImplementation(async (event) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000)); // a slow handler
      return ShipmentsService.prototype.createFor.call(service, event);
    });
    const event = orderPlaced();

    await publish(event);
    await eventually(async () => stopping.createFor.mock.calls.length === 1);
    await stopping.app.close(); // waits for the handler, which commits and acknowledges
    workers.splice(workers.indexOf(stopping.app), 1);

    const [shipment] = await db.select().from(shipments).where(eq(shipments.orderId, event.payload.orderId));
    expect(shipment).toBeDefined();
    const next = await worker();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(next.createFor).not.toHaveBeenCalled(); // nothing was requeued
  });

  it('requeues the event in flight when the grace period runs out', async () => {
    const stopping = await worker({ gracePeriod: 200 });
    stopping.createFor.mockReturnValue(new Promise(() => {})); // outlives the grace period
    const event = orderPlaced();

    await publish(event);
    await eventually(async () => stopping.createFor.mock.calls.length === 1);
    await stopping.app.close();
    workers.splice(workers.indexOf(stopping.app), 1);
    const next = await worker();

    await eventually(async () => (await shipmentCount()) === 1);
    expect(next.createFor).toHaveBeenCalledTimes(1);
  });
});
