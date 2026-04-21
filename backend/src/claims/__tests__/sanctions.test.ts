import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { makeSanctionsScreener, makeBlocklistScreener } from '../sanctions.js';

describe('claims/sanctions', () => {
  describe('blocklist fallback', () => {
    it('flags baseline blocked addresses', async () => {
      const screen = makeBlocklistScreener(null);
      const r = await screen('0x0000000000000000000000000000000000000bad');
      assert.equal(r.clear, false);
      assert.equal(r.list, 'LOCAL_BLOCKLIST');
    });
    it('passes an address not on the list', async () => {
      const screen = makeBlocklistScreener(null);
      const r = await screen('0x9999999999999999999999999999999999999999');
      assert.equal(r.clear, true);
    });
  });

  describe('live Circle Compliance adapter', () => {
    it('passes when API returns approved', async () => {
      const fetchImpl = async () =>
        ({
          ok: true,
          json: async () => ({ data: { result: 'approved', hits: [] } }),
        }) as unknown as Response;
      const screen = makeSanctionsScreener({
        apiKey: 'test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const r = await screen('0xabc');
      assert.equal(r.clear, true);
    });
    it('denies when API returns denied', async () => {
      const fetchImpl = async () =>
        ({
          ok: true,
          json: async () => ({
            data: { result: 'denied', hits: [{ list: 'OFAC', entry: '0xabc' }] },
          }),
        }) as unknown as Response;
      const screen = makeSanctionsScreener({
        apiKey: 'test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const r = await screen('0xabc');
      assert.equal(r.clear, false);
      assert.equal(r.list, 'OFAC');
    });
    it('denies on non-OK HTTP response', async () => {
      const fetchImpl = async () =>
        ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response;
      const screen = makeSanctionsScreener({
        apiKey: 'test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const r = await screen('0xabc');
      assert.equal(r.clear, false);
      assert.ok(r.reason?.startsWith('compliance_http_'));
    });
  });
});
