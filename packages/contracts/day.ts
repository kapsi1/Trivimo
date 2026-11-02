import { z } from 'zod';

export const daySchema = z.object({
  date: z.iso.date(),
  value: z.number().nullable(),
  status: z.enum(['valid', 'missing']),
  note: z.string(),
  revision: z.number().int().positive(),
}).refine((day) => (day.status === 'missing') === (day.value === null));
export const daysSchema = z.array(daySchema);
export type Day = z.infer<typeof daySchema>;
