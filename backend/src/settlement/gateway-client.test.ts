import { describe, expect, it } from 'vitest';
import { createGatewayFacade } from './gateway-client';
import type { CircleWebhookEvent } from './types';

function ev(id: string, type: string): CircleWebhookEvent {
  return { id, type, data: {} };
}

describe('gateway-client facade', () => {
  it('resolves awaitConfirmation when notify fires', async () => {
    const facade = createGatewayFacade({ sellerAddress: '0xabc', networks: ['eip155:5042002'], timeoutMs: 1_000 });
    const p = facade.awaitConfirmation('r-1');
    expect(facade.notify(ev('e-1', 'settlement.completed'), 'r-1')).toBe(true);
    await expect(p).resolves.toMatchObject({ id: 'e-1' });
  });

  it('rejects awaitConfirmation on timeout', async () => {
    const facade = createGatewayFacade({ sellerAddress: '0xabc', networks: ['eip155:5042002'], timeoutMs: 50 });
    await expect(facade.awaitConfirmation('r-2')).rejects.toThrow(/timeout/);
  });

  it('rejects on settlement.failed event', async () => {
    const facade = createGatewayFacade({ sellerAddress: '0xabc', networks: ['eip155:5042002'], timeoutMs: 1_000 });
    const p = facade.awaitConfirmation('r-3');
    facade.notify(ev('e-3', 'settlement.failed'), 'r-3');
    await expect(p).rejects.toThrow(/failure/);
  });

  it('notify returns false for unknown receipts', () => {
    const facade = createGatewayFacade({ sellerAddress: '0xabc', networks: ['eip155:5042002'] });
    expect(facade.notify(ev('e-x', 'settlement.completed'), 'nobody')).toBe(false);
  });

  it('rejectAll drains queued waiters', async () => {
    const facade = createGatewayFacade({ sellerAddress: '0xabc', networks: ['eip155:5042002'], timeoutMs: 10_000 });
    const p = facade.awaitConfirmation('r-drain');
    facade.rejectAll('shutdown');
    await expect(p).rejects.toThrow(/shutdown/);
  });

  it('late notify after timeout is a noop', async () => {
    const facade = createGatewayFacade({ sellerAddress: '0xabc', networks: ['eip155:5042002'], timeoutMs: 20 });
    const p = facade.awaitConfirmation('r-late');
    await expect(p).rejects.toThrow(/timeout/);
    expect(facade.notify(ev('e-late', 'settlement.completed'), 'r-late')).toBe(false);
  });
});
