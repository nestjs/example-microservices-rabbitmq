import { Transport, type RmqOptions } from '@nestjs/microservices';
import {
  FULFILLMENT_EVENTS_QUEUE,
  FULFILLMENT_REQUESTS_QUEUE,
  fulfillmentEventsQueueOptions,
  fulfillmentRequestsQueueOptions,
} from '@app/contracts';
import type { Env } from '../config.js';

type Config = Pick<Env, 'RABBITMQ_URL' | 'PREFETCH_COUNT'>;

/** Events: acknowledged once handled, so a crash or an error loses none of them. */
export const eventsServer = (config: Config): RmqOptions => ({
  transport: Transport.RMQ,
  options: {
    urls: [config.RABBITMQ_URL],
    queue: FULFILLMENT_EVENTS_QUEUE,
    queueOptions: fulfillmentEventsQueueOptions,
    noAck: false,
    // At most this many unacknowledged events on this instance at a time.
    prefetchCount: config.PREFETCH_COUNT,
    // On shutdown: stop taking events, then wait for the ones in flight.
    gracefulShutdown: true,
    gracePeriod: 20_000,
  },
});

/** Requests: their own queue, so they never wait behind a backlog of events. */
export const requestsServer = (config: Config): RmqOptions => ({
  transport: Transport.RMQ,
  options: {
    urls: [config.RABBITMQ_URL],
    queue: FULFILLMENT_REQUESTS_QUEUE,
    queueOptions: fulfillmentRequestsQueueOptions,
    gracefulShutdown: true,
    gracePeriod: 5_000,
  },
});
