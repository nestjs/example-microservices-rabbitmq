import { orderPlacedSchema } from '@app/contracts';
import type { z } from 'zod';

// The request body is the event without the fields the service sets.
export const placeOrderSchema = orderPlacedSchema.pick({ customerEmail: true, shippingAddress: true, items: true });
export type PlaceOrderDto = z.infer<typeof placeOrderSchema>;
