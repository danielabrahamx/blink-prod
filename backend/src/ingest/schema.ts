import { z } from 'zod';

/**
 * Zod schemas mirroring the wire format defined in Module 1 of the design
 * doc. We keep these in one place so routes, tests, and admin replay can
 * share validation.
 */

export const signalPayloadSchema = z.object({
  wifi_trust: z.enum(['home', 'known', 'public', 'unknown', 'offline']),
  charging_state: z.enum(['ac', 'battery']),
  lid_state: z.enum(['open', 'closed']),
  app_category: z
    .enum(['productivity', 'browser', 'media', 'unknown', 'idle'])
    .nullable(),
  input_idle_flag: z.boolean(),
  battery_health_pct: z.number().min(0).max(100).nullable(),
});

export const envelopeSchema = z.object({
  schema_version: z.literal('1.0'),
  policy_id: z.string().min(1).max(128),
  client_ts: z.string().datetime({ offset: true }),
  client_nonce: z.string().min(8).max(64),
  trigger: z.enum(['scheduled', 'event', 'resume-from-offline']),
  event_signal: z.string().nullable(),
  signals: signalPayloadSchema,
});

export const signedEnvelopeSchema = z.object({
  envelope: envelopeSchema,
  signature: z.string().min(8).max(256),
  device_id: z.string().min(1).max(128),
});

export const registerDeviceSchema = z.object({
  wallet_addr: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  device_pubkey: z.string().min(8).max(256),
  platform: z.string().min(1).max(64),
  os_version: z.string().min(1).max(64),
});

export const createPolicySchema = z.object({
  wallet_addr: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  home_country: z.string().length(2),
  session_key_pubkey: z.string().min(8).max(256),
  authorization_signature: z.string().min(8).max(256),
  cap_usdc: z.number().positive().max(1000),
  validity_days: z.number().int().positive().max(365),
});

export const fundPolicySchema = z.object({
  policy_id: z.string().min(1).max(128),
  amount_usdc: z.number().positive().max(1000),
});

export const topupPolicySchema = fundPolicySchema;

export const cancelPolicySchema = z.object({
  policy_id: z.string().min(1).max(128),
});

export type EnvelopeInput = z.infer<typeof envelopeSchema>;
export type SignedEnvelopeInput = z.infer<typeof signedEnvelopeSchema>;
