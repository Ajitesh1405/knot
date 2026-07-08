import { z } from 'zod';

/**
 * Routing target. Skills are pluggable, so `next` is an open string validated
 * against the live registry after the model responds (not a hard-coded enum).
 * 'FINISH' means the request was already handled this turn.
 */
export const RouteSchema = z.object({
  next: z.string().describe('The skill name to route to, or "FINISH".'),
  reason: z.string().describe('One sentence: why this specialist'),
  parameters: z
    .object({
      timeRange: z
        .enum(['today', 'tomorrow', 'this_week', 'all', 'unspecified'])
        .optional(),
      limit: z.number().optional(),
    })
    .optional(),
});

export type Route = z.infer<typeof RouteSchema>;
