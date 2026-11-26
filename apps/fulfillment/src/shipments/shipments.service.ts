import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { OrderPlaced, Shipment } from '@app/contracts';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { shipments } from '../database/schema.js';

@Injectable()
export class ShipmentsService {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  /** Creates the order's shipment. `false` when it exists: this delivery is a duplicate. */
  async createFor(event: OrderPlaced): Promise<boolean> {
    // One statement: two deliveries of the same event, on two instances at the
    // same moment, can't both insert. A SELECT before the INSERT could let both through.
    const created = await this.db
      .insert(shipments)
      .values({
        orderId: event.orderId,
        customerEmail: event.customerEmail,
        shippingAddress: event.shippingAddress,
        items: event.items,
      })
      .onConflictDoNothing({ target: shipments.orderId })
      .returning({ orderId: shipments.orderId });
    return created.length === 1;
  }

  async find(orderId: string): Promise<Shipment | null> {
    const [shipment] = await this.db.select().from(shipments).where(eq(shipments.orderId, orderId));
    if (!shipment) {
      return null;
    }
    const { status, items, createdAt } = shipment;
    return { orderId, status, items, createdAt: createdAt.toISOString() };
  }
}
