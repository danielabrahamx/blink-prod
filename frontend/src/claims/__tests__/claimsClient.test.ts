import { describe, it, expect } from 'vitest';
import { makeClaimsClient } from '../claimsClient';

function makeFetchMock(responders: Array<{
  match: (url: string, init: RequestInit) => boolean;
  respond: (url: string, init: RequestInit) => {
    status: number;
    body: unknown;
  };
}>): typeof fetch {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const match = responders.find((r) => r.match(url, init));
    if (!match) throw new Error(`no matching responder for ${url}`);
    const { status, body } = match.respond(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  };
}

describe('claimsClient', () => {
  it('submit returns status and claim', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url) => url.endsWith('/claims/submit'),
        respond: () => ({
          status: 201,
          body: { claim: { id: 'clm_x', status: 'submitted' } },
        }),
      },
    ]);
    const client = makeClaimsClient({ baseUrl: 'http://test', fetchImpl });
    const res = await client.submit({
      policyId: 'pol_1',
      policyholderWallet: '0xabc',
      claimType: 'damage',
      incidentDescription: 'x',
      incidentDate: 1,
      amountClaimedUsdc: 10,
      deviceFingerprint: 'fp',
    });
    expect(res.status).toBe(201);
    expect(res.claim?.id).toBe('clm_x');
  });

  it('adminQueue sends admin headers and returns claims array', async () => {
    let capturedHeaders: HeadersInit | undefined;
    const fetchImpl = makeFetchMock([
      {
        match: (url) => url.endsWith('/claims/admin/queue'),
        respond: (_u, init) => {
          capturedHeaders = init.headers;
          return {
            status: 200,
            body: { claims: [{ id: 'clm_q1' }, { id: 'clm_q2' }] },
          };
        },
      },
    ]);
    const client = makeClaimsClient({ baseUrl: 'http://test', fetchImpl });
    const list = await client.adminQueue('0xadmin', 'admin-1');
    expect(list).toHaveLength(2);
    expect((capturedHeaders as Record<string, string>)['x-admin-wallet']).toBe('0xadmin');
  });

  it('approve returns claim + payout tx hash', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url) => url.includes('/approve'),
        respond: () => ({
          status: 200,
          body: { claim: { id: 'x', status: 'paid' }, payout: { txHash: '0xhash' } },
        }),
      },
    ]);
    const client = makeClaimsClient({ baseUrl: 'http://test', fetchImpl });
    const res = await client.approve('0xadmin', 'admin-1', 'clm_x');
    expect(res.claim?.status).toBe('paid');
    expect(res.payout?.txHash).toBe('0xhash');
  });
});
