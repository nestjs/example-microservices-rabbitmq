import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { FulfillmentClient } from './fulfillment.client.js';
import { placeOrderSchema, type PlaceOrderDto } from './orders.schemas.js';
import { OrdersService } from './orders.service.js';

const orderId = { schema: z.uuid() };

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly fulfillmentClient: FulfillmentClient,
  ) {}

  @Post()
  place(@Body({ schema: placeOrderSchema }) dto: PlaceOrderDto) {
    return this.ordersService.place(dto);
  }

  @Get(':id')
  findOne(@Param('id', orderId) id: string) {
    return this.ordersService.findOne(id);
  }

  @Get(':id/shipment')
  async findShipment(@Param('id', orderId) id: string) {
    const order = await this.ordersService.findOne(id);
    const shipment = await this.fulfillmentClient.findShipment(order.id);
    if (!shipment) {
      throw new NotFoundException('No shipment yet');
    }
    return shipment;
  }
}
