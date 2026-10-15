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
