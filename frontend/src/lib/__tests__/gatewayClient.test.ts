import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the GatewayClient constructor before any imports.
// vitest 4 requires a spy wrapping a class so both `new Spy(cfg)` and
// `expect(Spy).toHaveBeenCalledWith(...)` work together.
vi.mock('@circlefin/x402-batching/client', () => {
  const GatewayClient = vi.fn(function (
    this: Record<string, unknown>,
    config: { chain: string; privateKey: string },
  ) {
    this.address = '0xmockBuyerAddress';
    this.chain = config.chain;
    this.privateKey = config.privateKey;
    this.getBalances = vi.fn();
    this.deposit = vi.fn();
    this.pay = vi.fn();
  });
  return { GatewayClient };
});

describe('getGatewayClient', () => {
  beforeEach(() => {
    // Reset module registry so the singleton is recreated per-test group
    vi.resetModules();
    vi.stubEnv(
      'VITE_BUYER_PRIVATE_KEY',
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    );
  });

  it('returns a GatewayClient instance', async () => {
    const { getGatewayClient } = await import('../gatewayClient');
    const client = getGatewayClient();
    expect(client).toBeDefined();
    expect(client.address).toBeDefined();
  });

  it('returns the same instance on subsequent calls (singleton)', async () => {
    const { getGatewayClient } = await import('../gatewayClient');
    const a = getGatewayClient();
    const b = getGatewayClient();
    expect(a).toBe(b);
  });

  it('creates client with arcTestnet chain', async () => {
    const { GatewayClient } = await import('@circlefin/x402-batching/client');
    const { getGatewayClient } = await import('../gatewayClient');
    getGatewayClient();
    expect(GatewayClient).toHaveBeenCalledWith(
      expect.objectContaining({ chain: 'arcTestnet' }),
    );
  });

  it('passes private key from env to constructor', async () => {
    const { GatewayClient } = await import('@circlefin/x402-batching/client');
    const { getGatewayClient } = await import('../gatewayClient');
    getGatewayClient();
    expect(GatewayClient).toHaveBeenCalledWith(
      expect.objectContaining({
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      }),
    );
  });
});
