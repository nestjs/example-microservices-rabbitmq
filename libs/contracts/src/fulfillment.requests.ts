import { z } from 'zod';

export const FIND_SHIPMENT = 'shipment.find';

export const findShipmentSchema = z.object({ orderId: z.uuid() });
export type FindShipment = z.infer<typeof findShipmentSchema>;

export const shipmentSchema = z.object({
  orderId: z.uuid(),
  status: z.enum(['preparing', 'shipped']),
  items: z.array(z.object({ sku: z.string(), quantity: z.number() })),
  createdAt: z.iso.datetime(),
});
export type Shipment = z.infer<typeof shipmentSchema>;
