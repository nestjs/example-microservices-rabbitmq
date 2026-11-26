import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { RmqContext } from '@nestjs/microservices';
import { FULFILLMENT_EVENTS_DEAD_LETTER_QUEUE, FULFILLMENT_EVENTS_QUEUE } from '@app/contracts';
import type { ConfirmChannel, Message } from 'amqplib';
import { setTimeout } from 'node:timers/promises';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { InvalidMessageException } from './invalid-message.exception.js';

/** How many times an event is tried before it's dead-lettered. */
const MAX_ATTEMPTS = 5;

/** The wait before each retry: 1, 2, 4, then 8 seconds. */
const backoff = (attempt: number) => Math.min(1_000 * 2 ** (attempt - 1), 16_000);

/**
 * Acknowledges an event once its handler succeeded, and only then. A failed
 * event is retried, after a backoff, up to MAX_ATTEMPTS times, then moved to
 * the dead-letter queue with its error. An invalid message is moved there at once.
 */
@Injectable()
export class RmqAckInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RmqAckInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<void> {
    const rmq = context.switchToRpc().getContext<RmqContext>();
    // The transport's channels confirm publishes (amqp-connection-manager's default).
    const channel = rmq.getChannelRef() as ConfirmChannel;
    const message = rmq.getMessage() as Message;
    const pattern = rmq.getPattern();
    // Counted here, in a header: RabbitMQ 4 doesn't count a nack() with requeue as an attempt.
    const attempt = Number(message.properties.headers?.['x-attempt'] ?? 1);

    /** Publishes a copy to `queue`, waits for the broker to confirm it, then acknowledges the original. */
    const moveTo = async (queue: string, headers: Record<string, unknown>) => {
      channel.sendToQueue(queue, message.content, {
        ...message.properties,
        headers: { ...message.properties.headers, ...headers },
      });
      await channel.waitForConfirms();
      channel.ack(message);
    };

    const settle = async () => {
      try {
        // Runs the pipes and the handler: a failed validation lands below too.
        await lastValueFrom(next.handle(), { defaultValue: undefined });
      } catch (error) {
        if (!(error instanceof InvalidMessageException) && attempt < MAX_ATTEMPTS) {
          const delay = backoff(attempt);
          this.logger.warn(`Attempt ${attempt} of ${pattern} failed, retrying in ${delay} ms: ${error}`);
          await setTimeout(delay);
          return moveTo(FULFILLMENT_EVENTS_QUEUE, { 'x-attempt': attempt + 1 });
        }
        const reason = error instanceof InvalidMessageException ? JSON.stringify(error.getError()) : String(error);
        this.logger.error(`Dead-lettered ${pattern} after ${attempt} attempt(s): ${reason}`);
        return moveTo(FULFILLMENT_EVENTS_DEAD_LETTER_QUEUE, { 'x-attempts': attempt, 'x-error': reason.slice(0, 1_000) });
      }
      channel.ack(message);
    };

    return from(
      settle().catch((error) => {
        // The channel closed meanwhile: the broker gives the event to another consumer.
        this.logger.warn(`Could not settle ${pattern}: ${error}`);
      }),
    );
  }
}
