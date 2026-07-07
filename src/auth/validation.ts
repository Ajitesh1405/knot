import { BadRequestException } from '@nestjs/common';
import { z, ZodError, ZodType } from 'zod';

// Parse a request body against a zod schema, turning validation
// failures into a clean 400 the mobile client can surface.
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: err.issues.map((i) => ({
          field: i.path.join('.') || '(root)',
          message: i.message,
        })),
      });
    }
    throw err;
  }
}

// ─── Shared request schemas ──────────────────────────────────────
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().min(1).max(120).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const messageSchema = z.object({
  text: z.string().trim().min(1, 'Message text is required').max(4000),
});

export const settingsSchema = z
  .object({
    scope: z.enum(['personal', 'everything']).optional(),
    emailRange: z
      .enum(['new_only', 'last_30_days', 'last_year', 'all'])
      .optional(),
    briefingsEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one setting to update',
  });

export const draftEditSchema = z
  .object({
    instruction: z.string().trim().min(1).optional(),
    body: z.string().min(1).optional(),
  })
  .refine((v) => v.instruction != null || v.body != null, {
    message: 'Provide either `instruction` (AI revise) or `body` (verbatim)',
  });
