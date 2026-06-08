import { z } from 'zod';

export const SPECIALISTS = [
  'chat',
  'search',
  'chat_tracker',
  'gmail',
  'outlook',
  'compose',
  'calendar',
  'scheduler',
  'FINISH',
] as const;
export type Specialist = (typeof SPECIALISTS)[number];

export const RouteSchema = z.object({
  next: z.enum(SPECIALISTS),
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
