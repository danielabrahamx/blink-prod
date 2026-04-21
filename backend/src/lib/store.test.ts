import { describe, it, expect } from 'vitest';
import { createMemoryStore } from './store.js';

describe('memory store', () => {
  it('registers and retrieves devices', async () => {
    const s = createMemoryStore();
    const d = await s.devices.register({
      wallet_addr: '0x' + 'a'.repeat(40),
      device_pubkey: 'pk',
      platform: 'win32',
      os_version: '11.0',
    });
    expect(await s.devices.byId(d.device_id)).toEqual(d);
    const byWallet = await s.devices.byWallet('0x' + 'A'.repeat(40));
    expect(byWallet.length).toBe(1);
  });

  it('creates and updates policies', async () => {
    const s = createMemoryStore();
    const p = await s.policies.create({
      wallet_addr: '0x' + 'b'.repeat(40),
      home_country: 'US',
    });
    expect(p.status).toBe('draft');
    const p2 = await s.policies.setStatus(p.policy_id, 'calibrating');
    expect(p2?.status).toBe('calibrating');
    const p3 = await s.policies.setStatus(p.policy_id, 'active');
    expect(p3?.calibrated_at).not.toBeNull();
    const p4 = await s.policies.setStatus(p.policy_id, 'cancelled_by_user');
    expect(p4?.terminated_at).not.toBeNull();
    expect(await s.policies.setStatus('missing', 'active')).toBeNull();
    expect(await s.policies.byId('missing')).toBeNull();
    expect((await s.policies.all()).length).toBe(1);
  });
});
