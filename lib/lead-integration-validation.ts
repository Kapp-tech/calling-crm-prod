import { z } from 'zod';

export const headerSchema = z.object({
  key: z.string().trim().min(1, 'Header name is required').max(200),
  value: z.string().max(4000),
  isSecret: z.boolean().default(false),
});

export const paramSchema = z.object({
  key: z.string().trim().min(1, 'Parameter name is required').max(200),
  value: z.string().max(2000),
});

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export const leadIntegrationSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200),
  isActive: z.boolean().optional(),
  /**
   * Which event fires this integration. Defaults to REFERRAL_CREATED so every
   * integration saved before recording webhooks existed keeps its behaviour —
   * the column's own default, restated here because the client now sends it.
   */
  trigger: z.enum(['REFERRAL_CREATED', 'RECORDING_RECEIVED']).default('REFERRAL_CREATED'),
  method: z.enum(HTTP_METHODS).default('POST'),
  url: z.string().trim().min(1, 'URL is required').max(2000).url('Must be a valid URL'),
  headers: z.array(headerSchema).max(50).default([]),
  queryParams: z.array(paramSchema).max(50).default([]),
  bodyTemplate: z.string().max(20000).default('{}'),
  timeoutMs: z.number().int().min(1000).max(30000).default(10000),
});
