import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { MemoryRedis } from '../lib/memoryRedis.js';
import { setGeoResolver, _resetForTests } from './geoip.js';
import { ingestEnvelope } from './index.js';
import { jcs } from '../lib/jcs.js';
import type { Device, SignalEnvelope } from '../types/index.js';
import { UnauthorizedError, BadRequestError } from '../lib/errors.js';

function buildTestFixture(overrides: Partial<SignalEnvelope> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const rawPub = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32);
  const device: Device = {
    device_id: 'dev_1',
    wallet_addr: '0x' + '1'.repeat(40),
    device_pubkey: rawPub.toString('hex'),
    platform: 'win32',
    os_version: '11.0',
    registered_at: '2026-04-01T00:00:00Z',
  };
  const envelope: SignalEnvelope = {
    schema_version: '1.0',
    policy_id: 'pol_1',
    client_ts: new Date().toISOString(),
    client_nonce: `nonce-${Math.random().toString(36).slice(2)}`,
    trigger: 'scheduled',
    event_signal: null,
    signals: {
      wifi_trust: 'home',
      charging_state: 'ac',
      lid_state: 'open',
      app_category: 'productivity',
      input_idle_flag: false,
      battery_health_pct: 92,
    },
    ...overrides,
  };
  const signature = cryptoSign(
    null,
    Buffer.from(jcs(envelope), 'utf8'),
    privateKey,
  ).toString('base64');
  const devices = {
    byId: async (id: string) => (id === device.device_id ? device : null),
  };
  return { device, envelope, signature, devices, privateKey };
}

describe('ingestEnvelope', () => {
  beforeEach(() => {
    _resetForTests();
    setGeoResolver(() => 'US');
  });

  it('ingests a well-formed signed envelope', async () => {
    const { envelope, signature, devices } = buildTestFixture();
    const redis = new MemoryRedis();
    const result = await ingestEnvelope(
      { envelope, signature, device_id: 'dev_1' },
      '8.8.8.8',
      { redis, devices },
    );
    expect(result.envelope.policy_id).toBe('pol_1');
    expect(result.ip_country).toBe('US');
    expect(result.device.device_id).toBe('dev_1');
    expect(typeof result.received_at).toBe('string');
  });

  it('rejects unknown device', async () => {
    const { envelope, signature } = buildTestFixture();
    const redis = new MemoryRedis();
    const devices = { byId: async () => null };
    await expect(
      ingestEnvelope(
        { envelope, signature, device_id: 'dev_nope' },
        '127.0.0.1',
        { redis, devices },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects tampered signature', async () => {
    const { envelope, devices } = buildTestFixture();
    const redis = new MemoryRedis();
    await expect(
      ingestEnvelope(
        {
          envelope,
          signature: Buffer.alloc(64, 0).toString('base64'),
          device_id: 'dev_1',
        },
        '8.8.8.8',
        { redis, devices },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects invalid schema', async () => {
    const redis = new MemoryRedis();
    const devices = { byId: async () => null };
    await expect(
      ingestEnvelope({} as unknown, '127.0.0.1', { redis, devices }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects client_ts outside skew window', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { envelope, signature, devices } = buildTestFixture({ client_ts: old });
    const redis = new MemoryRedis();
    await expect(
      ingestEnvelope(
        { envelope, signature, device_id: 'dev_1' },
        '8.8.8.8',
        { redis, devices, maxClockSkewMs: 60_000 },
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects duplicate nonces', async () => {
    const { envelope, signature, devices } = buildTestFixture();
    const redis = new MemoryRedis();
    await ingestEnvelope(
      { envelope, signature, device_id: 'dev_1' },
      '8.8.8.8',
      { redis, devices },
    );
    // second identical envelope: rate-limit or conflict (rate-limit fires first
    // because short-window is 1). Either way the call must reject.
    await expect(
      ingestEnvelope(
        { envelope, signature, device_id: 'dev_1' },
        '8.8.8.8',
        { redis, devices },
      ),
    ).rejects.toThrow();
  });
});
