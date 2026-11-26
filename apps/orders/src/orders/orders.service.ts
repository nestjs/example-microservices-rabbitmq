import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Outbox } from '@nestjs/outbox';
import { ORDER_PLACED, orderPlacedSchema } from '@app/contracts';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { orders, type Order } from '../database/schema.js';
import type { PlaceOrderDto } from './orders.schemas.js';

type Transaction = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

@Injectable()
export class OrdersService {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase,
    private readonly outbox: Outbox<Transaction>,
  ) {}

  async place(dto: PlaceOrderDto): Promise<Order> {
    const order = await this.db.transaction(async (tx) => {
      const [order] = await tx.insert(orders).values(dto).returning();
      // Checked against the contract the consumer validates with: a payload it
      // would reject fails this request, and rolls the order back.
      const event = orderPlacedSchema.parse({
        orderId: order.id,
        customerEmail: order.customerEmail,
        shippingAddress: order.shippingAddress,
        items: order.items,
        placedAt: order.createdAt.toISOString(),
      });
      // Through tx: the message commits with the order, or not at all.
      await this.outbox.add(tx, { topic: ORDER_PLACED, key: order.id, payload: event });
      return order;
    });
    this.outbox.notify(); // publish now, instead of at the relay's next poll
    return order;
  }

  async findOne(id: string): Promise<Order> {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, id));
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }
}
