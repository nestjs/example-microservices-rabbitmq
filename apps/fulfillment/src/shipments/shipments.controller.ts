import { Controller, Logger, StandardSchemaValidationPipe, UseInterceptors, UsePipes } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  FIND_SHIPMENT,
  ORDER_PLACED,
  findShipmentSchema,
  orderPlacedEnvelopeSchema,
  type FindShipment,
  type OrderPlacedEnvelope,
} from '@app/contracts';
import { InvalidMessageException } from '../messaging/invalid-message.exception.js';
import { RmqAckInterceptor } from '../messaging/rmq-ack.interceptor.js';
import { ShipmentsService } from './shipments.service.js';

@Controller()
@UsePipes(new StandardSchemaValidationPipe({ exceptionFactory: (issues) => new InvalidMessageException(issues) }))
export class ShipmentsController {
  private readonly logger = new Logger(ShipmentsController.name);

  constructor(private readonly shipmentsService: ShipmentsService) {}

  @EventPattern(ORDER_PLACED)
  @UseInterceptors(RmqAckInterceptor)
  async onOrderPlaced(@Payload({ schema: orderPlacedEnvelopeSchema }) envelope: OrderPlacedEnvelope) {
    const created = await this.shipmentsService.createFor(envelope.payload);
    if (created) {
      this.logger.log(`Shipment created for order ${envelope.payload.orderId}`);
    } else {
      this.logger.log(`Skipped duplicate ${envelope.topic} ${envelope.id}`);
    }
  }

  @MessagePattern(FIND_SHIPMENT)
  find(@Payload({ schema: findShipmentSchema }) { orderId }: FindShipment) {
    return this.shipmentsService.find(orderId);
  }
}
