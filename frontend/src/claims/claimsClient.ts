// Thin HTTP client for the /claims API.

import type { Claim, SettlementReceipt } from './types';

const DEFAULT_BASE =
  (import.meta.env?.VITE_BACKEND_URL as string | undefined) ??
  'http://localhost:3001';

export interface ClaimsClient {
  submit(body: SubmitPayload): Promise<{ status: number; claim?: Claim; error?: string }>;
  get(claimId: string, wallet: string): Promise<{ claim: Claim; receipt?: SettlementReceipt }>;
  listForWallet(wallet: string): Promise<Claim[]>;
  adminQueue(adminWallet: string, adminId: string): Promise<Claim[]>;
  adminInspector(adminWallet: string, adminId: string, claimId: string):
    Promise<{ claim: Claim; policy: unknown; signalHistory: unknown; fraudFlags: string[] }>;
  review(adminWallet: string, adminId: string, claimId: string): Promise<Claim>;
  approve(adminWallet: string, adminId: string, claimId: string):
    Promise<{ claim?: Claim; payout?: { txHash?: string; error?: string } }>;
  deny(adminWallet: string, adminId: string, claimId: string, reason: string):
    Promise<{ claim?: Claim; error?: string }>;
}

export interface SubmitPayload {
  policyId: string;
  policyholderWallet: string;
  claimType: string;
  incidentDescription: string;
  incidentDate: number;
  amountClaimedUsdc: number;
  deviceFingerprint: string;
  devicePubkey?: string | null;
  policeReportRef?: string | null;
  evidence?: Array<{
    filename: string;
    mimetype: string;
    sizeBytes: number;
    storageUri: string;
    uploadedAt: number;
  }>;
}

export interface MakeClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function makeClaimsClient(options: MakeClientOptions = {}): ClaimsClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;

  async function json<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      ...init,
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      throw new Error(body.error ?? `http_${res.status}`);
    }
    return body;
  }

  function adminHeaders(wallet: string, adminId: string): HeadersInit {
    return { 'x-admin-wallet': wallet, 'x-admin-id': adminId };
  }

  return {
    async submit(body) {
      const res = await fetchImpl(`${baseUrl}/claims/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const parsed = (await res.json().catch(() => ({}))) as {
        claim?: Claim;
        error?: string;
      };
      return { status: res.status, ...parsed };
    },
    async get(claimId, wallet) {
      return json<{ claim: Claim; receipt?: SettlementReceipt }>(
        `/claims/${claimId}`,
        { method: 'GET', headers: { 'x-user-wallet': wallet } },
      );
    },
    async listForWallet(wallet) {
      const r = await json<{ claims: Claim[] }>(
        `/claims/user/${wallet}`,
        { method: 'GET', headers: { 'x-user-wallet': wallet } },
      );
      return r.claims;
    },
    async adminQueue(adminWallet, adminId) {
      const r = await json<{ claims: Claim[] }>(
        '/claims/admin/queue',
        { method: 'GET', headers: adminHeaders(adminWallet, adminId) },
      );
      return r.claims;
    },
    async adminInspector(adminWallet, adminId, claimId) {
      const r = await json<{ inspector: { claim: Claim; policy: unknown; signalHistory: unknown; fraudFlags: string[] } }>(
        `/claims/admin/${claimId}`,
        { method: 'GET', headers: adminHeaders(adminWallet, adminId) },
      );
      return r.inspector;
    },
    async review(adminWallet, adminId, claimId) {
      const r = await json<{ claim: Claim }>(
        `/claims/${claimId}/review`,
        { method: 'POST', headers: adminHeaders(adminWallet, adminId), body: '{}' },
      );
      return r.claim;
    },
    async approve(adminWallet, adminId, claimId) {
      const res = await fetchImpl(`${baseUrl}/claims/${claimId}/approve`, {
        method: 'POST',
        headers: { ...adminHeaders(adminWallet, adminId), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return (await res.json().catch(() => ({}))) as {
        claim?: Claim;
        payout?: { txHash?: string; error?: string };
      };
    },
    async deny(adminWallet, adminId, claimId, reason) {
      const res = await fetchImpl(`${baseUrl}/claims/${claimId}/deny`, {
        method: 'POST',
        headers: { ...adminHeaders(adminWallet, adminId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      return (await res.json().catch(() => ({}))) as { claim?: Claim; error?: string };
    },
  };
}
