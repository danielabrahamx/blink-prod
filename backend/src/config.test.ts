import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults when nothing is set', () => {
    const cfg = loadConfig({});
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.PORT).toBe(3001);
    expect(cfg.ARC_RPC_URL).toBe('https://rpc.testnet.arc.network');
    expect(cfg.ACTIVE_PER_SECOND_USDC).toBe(0.000005);
    expect(cfg.IDLE_PER_SECOND_USDC).toBe(0.00001);
    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.BODY_LIMIT).toBe('1mb');
  });

  it('coerces PORT and pricing from strings', () => {
    const cfg = loadConfig({
      PORT: '8080',
      ACTIVE_PER_SECOND_USDC: '0.0001',
      IDLE_PER_SECOND_USDC: '0.0002',
    });
    expect(cfg.PORT).toBe(8080);
    expect(cfg.ACTIVE_PER_SECOND_USDC).toBe(0.0001);
    expect(cfg.IDLE_PER_SECOND_USDC).toBe(0.0002);
  });

  it('requires DATABASE_URL when REQUIRE_POSTGRES=true', () => {
    expect(() => loadConfig({ REQUIRE_POSTGRES: 'true' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('accepts REQUIRE_POSTGRES=true when DATABASE_URL is set', () => {
    const cfg = loadConfig({
      REQUIRE_POSTGRES: 'true',
      DATABASE_URL: 'postgres://u:p@h:5432/d',
    });
    expect(cfg.REQUIRE_POSTGRES).toBe(true);
    expect(cfg.DATABASE_URL).toContain('postgres://');
  });

  it('rejects invalid LOG_LEVEL', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'nope' })).toThrow(/invalid config/);
  });

  it('rejects non-positive PORT', () => {
    expect(() => loadConfig({ PORT: '-1' })).toThrow(/invalid config/);
  });

  it('rejects malformed ARC_RPC_URL', () => {
    expect(() => loadConfig({ ARC_RPC_URL: 'not-a-url' })).toThrow(
      /invalid config/,
    );
  });

  it('rejects 3-letter GEOIP_LOCAL_COUNTRY (must be ISO-2)', () => {
    expect(() => loadConfig({ GEOIP_LOCAL_COUNTRY: 'USA' })).toThrow(
      /invalid config/,
    );
  });
});
