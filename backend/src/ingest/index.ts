import type { RedisLike } from '../lib/redis.js';
import type { SignalEnvelope, Device } from '../types/index.js';
import { BadRequestError, UnauthorizedError } from '../lib/errors.js';
import { enforceOrThrow } from './rateLimit.js';
import { claim as claimNonce } from './nonceStore.js';
import { verifyEnvelopeSignature } from './signature.js';
import { resolveIpCountry } from './geoip.js';
import { signedEnvelopeSchema } from './schema.js';

export interface DeviceLookup {
  byId(device_id: string): Promise<Device | null>;
}

export interface IngestedEnvelope {
  envelope: SignalEnvelope;
  device: Device;
  ip_country: string | null;
  received_at: string;
}

export interface IngestOptions {
  redis: RedisLike;
  devices: DeviceLookup;
  maxClockSkewMs?: number;
}

/**
 * End-to-end ingest: zod validate -> device lookup -> Ed25519 verify ->
 * rate-limit -> nonce dedup -> geoip augment.
 *
 * Throws HttpError subclasses for each failure mode. Callers should map to
 * HTTP responses via the error middleware.
 */
export async function ingestEnvelope(
  body: unknown,
  ip: string,
  opts: IngestOptions,
): Promise<IngestedEnvelope> {
  const parsed = signedEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestError('invalid envelope', parsed.error.flatten());
  }
  const { envelope, signature, device_id } = parsed.data;

  const device = await opts.devices.byId(device_id);
  if (!device) {
    throw new UnauthorizedError('unknown device_id');
  }

  // Clock-skew guard (default 10 min).
  const skew = opts.maxClockSkewMs ?? 10 * 60 * 1000;
  const clientTs = Date.parse(envelope.client_ts);
  if (Number.isNaN(clientTs)) {
    throw new BadRequestError('invalid client_ts');
  }
  if (Math.abs(Date.now() - clientTs) > skew) {
    throw new BadRequestError('client_ts outside permitted skew');
  }

  verifyEnvelopeSignature(envelope, signature, device.device_pubkey);

  await enforceOrThrow(opts.redis, envelope.policy_id);
  await claimNonce(opts.redis, envelope.policy_id, envelope.client_nonce);

  const ip_country = await resolveIpCountry(ip);

  return {
    envelope,
    device,
    ip_country,
    received_at: new Date().toISOString(),
  };
}
