import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const shipments = pgTable('shipments', {
  // One shipment per order: the key that makes a second delivery a no-op.
  orderId: uuid('order_id').primaryKey(),
  status: text('status', { enum: ['preparing', 'shipped'] }).notNull().default('preparing'),
  customerEmail: text('customer_email').notNull(),
  shippingAddress: text('shipping_address').notNull(),
  items: jsonb('items').$type<{ sku: string; quantity: number }[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
