// HTTP client for the admin portal. All calls are authenticated by the
// connected wallet address passed via the X-Admin-Wallet header. The backend
// enforces the allowlist; the frontend only gates the UI to avoid flashing
// protected views to unauthorised wallets.

import type {
  AdminMetrics,
  AdminRole,
  PolicyInspectorData,
  ReplayRequest,
  ReplayResult,
} from './types';

const API_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_BACKEND_URL) ||
  'http://localhost:3001';

export class AdminApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'AdminApiError';
  }
}

async function adminFetch<T>(
  path: string,
  wallet: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Wallet': wallet,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AdminApiError(res.status, body || res.statusText);
  }
  return (await res.json()) as T;
}

export async function getAdminRole(wallet: string): Promise<AdminRole> {
  return adminFetch<AdminRole>(`/admin/role`, wallet);
}

export async function getPolicy(
  wallet: string,
  policyId: string,
): Promise<PolicyInspectorData> {
  return adminFetch<PolicyInspectorData>(
    `/admin/policy/${encodeURIComponent(policyId)}`,
    wallet,
  );
}

export async function runReplay(
  wallet: string,
  req: ReplayRequest,
): Promise<ReplayResult> {
  return adminFetch<ReplayResult>(`/admin/replay`, wallet, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function getMetrics(wallet: string): Promise<AdminMetrics> {
  return adminFetch<AdminMetrics>(`/admin/metrics`, wallet);
}

export function exportPolicyCsvUrl(policyId: string): string {
  return `${API_BASE}/admin/export/${encodeURIComponent(policyId)}`;
}

export async function downloadPolicyCsv(
  wallet: string,
  policyId: string,
): Promise<Blob> {
  const res = await fetch(exportPolicyCsvUrl(policyId), {
    headers: { 'X-Admin-Wallet': wallet },
  });
  if (!res.ok) {
    throw new AdminApiError(res.status, res.statusText);
  }
  return res.blob();
}
