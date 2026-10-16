import { z } from 'zod';

export const routeSuggestionSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1, 'Selecione os pedidos').max(20),
  /** The operator reordered by hand: keep this order and only compute the legs. */
  keepOrder: z.boolean().default(false),
});
export type RouteSuggestionInput = z.input<typeof routeSuggestionSchema>;

export const orderLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Also correct the customer's saved address (next orders start right). */
  saveToCustomer: z.boolean().default(true),
});
export type OrderLocationInput = z.input<typeof orderLocationSchema>;

export const SIMULATION_SPEEDS = [1, 5, 20] as const;
export const simulationSchema = z.object({
  speed: z.union([z.literal(1), z.literal(5), z.literal(20)]).default(5),
});
export type SimulationInput = z.input<typeof simulationSchema>;

/** Positions sent by the courier's phone (a few at once after a moment without network). */
export const courierPositionsSchema = z.object({
  positions: z
    .array(
      z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracyMeters: z.number().min(0).max(100_000).nullable().optional(),
        speedMps: z.number().min(0).max(100).nullable().optional(),
        heading: z.number().min(0).max(360).nullable().optional(),
        recordedAt: z.iso.datetime(),
      }),
    )
    .min(1)
    .max(30),
});
export type CourierPositionsInput = z.input<typeof courierPositionsSchema>;

export const trackingConsentSchema = z.object({ version: z.string().min(1).max(40) });
export type TrackingConsentInput = z.input<typeof trackingConsentSchema>;

/** Web Push subscription of this browser (PushSubscription.toJSON()). */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});
export type PushSubscriptionInput = z.input<typeof pushSubscriptionSchema>;

export const pushUnsubscribeSchema = z.object({ endpoint: z.url().max(2000) });
