import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FULFILLMENT_EVENTS_DEAD_LETTER_QUEUE } from '@app/contracts';
import { connect } from 'amqplib';
import type { Env } from '../config.js';

/**
 * The transport declares only the queue it consumes. RabbitMQ drops a dead
 * letter whose queue doesn't exist, so declare it before the first event.
 */
@Injectable()
export class DeadLetterQueue implements OnApplicationBootstrap {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async onApplicationBootstrap() {
    const connection = await connect(this.config.get('RABBITMQ_URL', { infer: true }));
    try {
      const channel = await connection.createChannel();
      await channel.assertQueue(FULFILLMENT_EVENTS_DEAD_LETTER_QUEUE, {
        durable: true,
        arguments: { 'x-queue-type': 'quorum' },
      });
    } finally {
      await connection.close();
    }
  }
}
