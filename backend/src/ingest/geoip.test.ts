import { describe, it, expect, beforeEach } from 'vitest';
import { resolveIpCountry, setGeoResolver, _resetForTests } from './geoip.js';

describe('geoip', () => {
  beforeEach(() => {
    _resetForTests();
  });

  it('returns null for empty ip', async () => {
    expect(await resolveIpCountry('')).toBeNull();
  });

  it('uses injected resolver', async () => {
    setGeoResolver(() => 'GB');
    expect(await resolveIpCountry('8.8.8.8')).toBe('GB');
  });

  it('maps localhost via GEOIP_LOCAL_COUNTRY env', async () => {
    process.env.GEOIP_LOCAL_COUNTRY = 'GB';
    try {
      expect(await resolveIpCountry('127.0.0.1')).toBe('GB');
      expect(await resolveIpCountry('::1')).toBe('GB');
      expect(await resolveIpCountry('192.168.1.1')).toBe('GB');
    } finally {
      delete process.env.GEOIP_LOCAL_COUNTRY;
    }
  });

  it('defaults localhost to US when env unset', async () => {
    delete process.env.GEOIP_LOCAL_COUNTRY;
    expect(await resolveIpCountry('127.0.0.1')).toBe('US');
  });

  it('returns null when no mmdb available and ip non-local', async () => {
    delete process.env.GEOIP_DB_PATH;
    expect(await resolveIpCountry('8.8.8.8')).toBeNull();
  });
});
