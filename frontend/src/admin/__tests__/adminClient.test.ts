import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AdminApiError,
  getAdminRole,
  getPolicy,
  runReplay,
  getMetrics,
  exportPolicyCsvUrl,
  downloadPolicyCsv,
} from '../adminClient';
import { fixtureMetrics, fixturePolicy, fixtureReplay } from './fixtures';

// Minimal typed fetch mock so we can assert request shape without globals.
function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function textResponse(text: string, init: ResponseInit = {}): Response {
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/csv' },
    ...init,
  });
}

const WALLET = '0xabc';

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminApiError', () => {
  it('captures status and message', () => {
    const e = new AdminApiError(500, 'boom');
    expect(e.status).toBe(500);
    expect(e.message).toBe('boom');
    expect(e.name).toBe('AdminApiError');
  });
});

describe('adminClient request shape', () => {
  it('getAdminRole hits /admin/role with X-Admin-Wallet header', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(jsonResponse({ wallet_addr: WALLET, role: 'admin' })),
    );
    const role = await getAdminRole(WALLET);
    expect(role.role).toBe('admin');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/admin\/role$/);
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers['X-Admin-Wallet']).toBe(WALLET);
  });

  it('getPolicy encodes the id in the URL', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(jsonResponse(fixturePolicy)));
    const policy = await getPolicy(WALLET, 'pol test/1');
    expect(policy.policy_id).toBe(fixturePolicy.policy_id);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/admin/policy/pol%20test%2F1');
  });

  it('runReplay posts JSON body', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(jsonResponse(fixtureReplay)));
    const req = {
      policy_id: 'p',
      window_start: '2026-04-21T09:00',
      window_end: '2026-04-21T10:00',
      model_version: 'v1.0.0',
    };
    const out = await runReplay(WALLET, req);
    expect(out.minute_series.length).toBe(fixtureReplay.minute_series.length);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(req));
  });

  it('getMetrics returns parsed body', async () => {
    mockFetch(() => Promise.resolve(jsonResponse(fixtureMetrics)));
    const m = await getMetrics(WALLET);
    expect(m.active_policies).toBe(fixtureMetrics.active_policies);
  });

  it('exportPolicyCsvUrl composes the absolute URL', () => {
    expect(exportPolicyCsvUrl('pol_1')).toMatch(/\/admin\/export\/pol_1$/);
  });

  it('downloadPolicyCsv returns a Blob', async () => {
    mockFetch(() => Promise.resolve(textResponse('a,b,c')));
    const blob = await downloadPolicyCsv(WALLET, 'pol_1');
    // jsdom's Response.blob() returns a Blob whose constructor reference may
    // differ from the test scope's global Blob, so assert on duck-typing.
    expect(typeof blob.text).toBe('function');
    expect(blob.size).toBe(5);
    const text = await blob.text();
    expect(text).toBe('a,b,c');
  });
});

describe('adminClient error mapping', () => {
  it('throws AdminApiError with status on 403', async () => {
    mockFetch(() =>
      Promise.resolve(new Response('forbidden', { status: 403 })),
    );
    await expect(getAdminRole(WALLET)).rejects.toBeInstanceOf(AdminApiError);
    try {
      await getAdminRole(WALLET);
    } catch (e) {
      expect(e).toBeInstanceOf(AdminApiError);
      expect((e as AdminApiError).status).toBe(403);
      expect((e as AdminApiError).message).toBe('forbidden');
    }
  });

  it('propagates 500 with response text', async () => {
    mockFetch(() =>
      Promise.resolve(new Response('db_down', { status: 500 })),
    );
    await expect(getMetrics(WALLET)).rejects.toMatchObject({
      status: 500,
      message: 'db_down',
    });
  });

  it('downloadPolicyCsv rejects with AdminApiError on non-ok', async () => {
    mockFetch(() =>
      Promise.resolve(new Response('nope', { status: 401, statusText: 'Unauthorized' })),
    );
    await expect(downloadPolicyCsv(WALLET, 'p')).rejects.toMatchObject({
      status: 401,
    });
  });
});
