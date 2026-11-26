import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export interface OrderItem {
  sku: string;
  quantity: number;
}

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerEmail: text('customer_email').notNull(),
  shippingAddress: text('shipping_address').notNull(),
  items: jsonb('items').$type<OrderItem[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type Order = typeof orders.$inferSelect;
