import { describe, it, expect } from 'vitest';
import { sampleWifi, hashSsid } from '../src/signal-collector/wifi';

describe('wifi', () => {
  const homeHash = hashSsid('MyHomeWiFi');
  const knownHash = hashSsid('OfficeNet');
  const config = {
    home_ssid_hashes: new Set([homeHash]),
    known_ssid_hashes: new Set([knownHash]),
  };

  it('hashSsid is deterministic + hex SHA-256', () => {
    expect(hashSsid('abc')).toBe(hashSsid('abc'));
    expect(hashSsid('abc')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns offline when no connections', async () => {
    const stub = {
      init: () => {},
      getCurrentConnections: async () => [],
    };
    const r = await sampleWifi(config, stub);
    expect(r.trust).toBe('offline');
    expect(r.ssid_hash).toBeNull();
  });

  it('returns offline when lib throws', async () => {
    const stub = {
      init: () => {},
      getCurrentConnections: async () => {
        throw new Error('netsh failure');
      },
    };
    const r = await sampleWifi(config, stub);
    expect(r.trust).toBe('offline');
  });

  it('returns unknown for empty SSID (macOS redaction case)', async () => {
    const stub = {
      init: () => {},
      getCurrentConnections: async () => [{ ssid: '' }],
    };
    const r = await sampleWifi(config, stub);
    expect(r.trust).toBe('unknown');
    expect(r.ssid_hash).toBeNull();
  });

  it('classifies home SSID by hash', async () => {
    const stub = {
      init: () => {},
      getCurrentConnections: async () => [{ ssid: 'MyHomeWiFi' }],
    };
    const r = await sampleWifi(config, stub);
    expect(r.trust).toBe('home');
    expect(r.ssid_hash).toBe(homeHash);
  });

  it('classifies known SSID by hash', async () => {
    const stub = {
      init: () => {},
      getCurrentConnections: async () => [{ ssid: 'OfficeNet' }],
    };
    const r = await sampleWifi(config, stub);
    expect(r.trust).toBe('known');
    expect(r.ssid_hash).toBe(knownHash);
  });

  it('classifies unknown SSID as public', async () => {
    const stub = {
      init: () => {},
      getCurrentConnections: async () => [{ ssid: 'CoffeeShop' }],
    };
    const r = await sampleWifi(config, stub);
    expect(r.trust).toBe('public');
    expect(r.ssid_hash).toBe(hashSsid('CoffeeShop'));
  });
});
