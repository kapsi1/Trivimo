import { z } from 'zod';

export const sourceKindSchema = z.enum(['weight', 'body_fat', 'steps', 'distance', 'total_energy', 'active_energy']);
export const sourcePageSchema = z.object({
  rows: z.array(z.object({ timestamp: z.string(), value: z.string(), source: z.string(), converted: z.discriminatedUnion('status', [
    z.object({ status: z.literal('parsed'), value: z.string(), unit: z.enum(['kg', '%', 'szt.', 'km', 'kcal']) }),
    z.object({ status: z.literal('invalid') }), z.object({ status: z.literal('unsupported') }),
  ]) })),
  next: z.number().int().positive().nullable(),
});
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type SourcePage = z.infer<typeof sourcePageSchema>;
