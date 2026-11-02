import { z } from 'zod';

export const sourceKindSchema = z.enum(['weight', 'body_fat', 'steps', 'distance', 'total_energy', 'active_energy']);
export const sourcePageSchema = z.object({
  rows: z.array(z.object({ timestamp: z.string(), value: z.string(), source: z.string() })),
  next: z.number().int().positive().nullable(),
});
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type SourcePage = z.infer<typeof sourcePageSchema>;
