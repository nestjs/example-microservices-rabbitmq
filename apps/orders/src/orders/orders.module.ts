import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { FULFILLMENT_REQUESTS_QUEUE, fulfillmentRequestsQueueOptions } from '@app/contracts';
import type { Env } from '../config.js';
import { FULFILLMENT_REQUESTS, FulfillmentClient } from './fulfillment.client.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: FULFILLMENT_REQUESTS,
        inject: [ConfigService],
        useFactory: (config: ConfigService<Env, true>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.get('RABBITMQ_URL', { infer: true })],
            queue: FULFILLMENT_REQUESTS_QUEUE,
            queueOptions: fulfillmentRequestsQueueOptions,
          },
        }),
      },
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, FulfillmentClient],
})
export class OrdersModule {}
