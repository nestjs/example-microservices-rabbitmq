import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { FIND_SHIPMENT, REQUEST_TIMEOUT_MS, shipmentSchema, type Shipment } from '@app/contracts';
import { firstValueFrom, timeout } from 'rxjs';

export const FULFILLMENT_REQUESTS = 'FULFILLMENT_REQUESTS';

/** Asks the fulfillment service, and waits for its answer. */
@Injectable()
export class FulfillmentClient {
  private readonly logger = new Logger(FulfillmentClient.name);

  constructor(@Inject(FULFILLMENT_REQUESTS) private readonly client: ClientProxy) {}

  async findShipment(orderId: string): Promise<Shipment | null> {
    let reply: unknown;
    try {
      reply = await firstValueFrom(
        // A request waits in the queue until a worker takes it: no answer is
        // an answer too, after the timeout.
        this.client.send(FIND_SHIPMENT, { orderId }).pipe(timeout(REQUEST_TIMEOUT_MS)),
      );
    } catch (error) {
      this.logger.warn('The fulfillment service did not answer', { orderId, error: String(error) });
      throw new ServiceUnavailableException('The fulfillment service is unavailable, try again later');
    }
    return shipmentSchema.nullable().parse(reply);
  }
}
