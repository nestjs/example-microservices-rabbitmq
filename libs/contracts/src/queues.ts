import type { RmqOptions } from '@nestjs/microservices';

type QueueOptions = NonNullable<RmqOptions['options']>['queueOptions'];

/** How long the orders service waits for an answer from the fulfillment service. */
export const REQUEST_TIMEOUT_MS = 3_000;

export const FULFILLMENT_EVENTS_QUEUE = 'fulfillment.events';
export const FULFILLMENT_EVENTS_DEAD_LETTER_QUEUE = 'fulfillment.events.dead';

/**
 * The consumer and every producer declare the queue, with the same options:
 * RabbitMQ refuses a declaration that differs from the queue's.
 */
export const fulfillmentEventsQueueOptions: QueueOptions = {
  durable: true,
  arguments: {
    // Replicated across the cluster's nodes, and counts deliveries.
    'x-queue-type': 'quorum',
    // An event whose consumer dies before acknowledging it, 5 times over,
    // is dead-lettered: it's probably what kills the consumer.
    'x-delivery-limit': 5,
  },
  deadLetterExchange: '',
  deadLetterRoutingKey: FULFILLMENT_EVENTS_DEAD_LETTER_QUEUE,
};

export const FULFILLMENT_REQUESTS_QUEUE = 'fulfillment.requests';

export const fulfillmentRequestsQueueOptions: QueueOptions = {
  durable: true,
  // A request nobody took within the caller's timeout is dropped: the caller gave up.
  messageTtl: REQUEST_TIMEOUT_MS,
};
