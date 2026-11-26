import { z } from 'zod';

export const ORDER_PLACED = 'order.placed';

const item = z.object({
  sku: z.string().trim().min(1).max(64),
  quantity: z.number().int().min(1).max(100),
});

export const orderPlacedSchema = z.object({
  orderId: z.uuid(),
  customerEmail: z.email(),
  shippingAddress: z.string().trim().min(1).max(500),
  items: z.array(item).min(1).max(50),
  placedAt: z.iso.datetime(),
});
export type OrderPlaced = z.infer<typeof orderPlacedSchema>;

/**
 * What the outbox relay publishes: the message's id, which stays the same
 * when the message is published again, and the event itself as the payload.
 */
export const outboxEnvelope = <T extends z.ZodType>(payload: T) =>
  z.object({
    id: z.string().min(1),
    topic: z.string(),
    key: z.string().nullable(),
    headers: z.record(z.string(), z.string()),
    createdAt: z.number(),
    payload,
  });

export const orderPlacedEnvelopeSchema = outboxEnvelope(orderPlacedSchema);
export type OrderPlacedEnvelope = z.infer<typeof orderPlacedEnvelopeSchema>;
