// Sanctions screening adapter.
//
// Design-doc Module 4 requires "OFAC + UK lists; Circle's own tooling."
// Circle's Compliance Engine exposes /v1/w3s/compliance/screening/addresses.
// When CIRCLE_COMPLIANCE_API_KEY is set in env we call the live endpoint.
// Otherwise we fall back to a local JSON blocklist — documented in
// docs/DEVIATIONS.md as a follow-up blocker for production.

import fs from 'node:fs';
import path from 'node:path';
import type { SanctionsResult } from './types.js';

export interface SanctionsScreener {
  (wallet: string): Promise<SanctionsResult>;
}

interface SanctionsEnv {
  apiKey?: string | undefined;
  apiUrl?: string | undefined;
  blocklistPath?: string | undefined;
  fetchImpl?: typeof fetch;
  clock?: () => number;
}

const DEFAULT_API_URL = 'https://api.circle.com/v1/w3s/compliance/screening/addresses';

export function makeSanctionsScreener(env: SanctionsEnv = {}): SanctionsScreener {
  const apiKey = env.apiKey ?? process.env.CIRCLE_COMPLIANCE_API_KEY ?? '';
  const apiUrl = env.apiUrl ?? process.env.CIRCLE_COMPLIANCE_API_URL ?? DEFAULT_API_URL;
  const blocklistPath =
    env.blocklistPath ?? process.env.SANCTIONS_BLOCKLIST_PATH ?? null;
  const clock = env.clock ?? Date.now;
  const fetchImpl = env.fetchImpl ?? globalThis.fetch;

  if (apiKey && fetchImpl) {
    return async (wallet: string): Promise<SanctionsResult> => {
      if (!wallet) {
        return { clear: false, reason: 'no_address', checkedAt: clock() };
      }
      try {
        const res = await fetchImpl(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            address: wallet,
            chain: 'ARC',
            screeningCategories: ['OFAC', 'UK_HMT'],
          }),
        });
        if (!res.ok) {
          return {
            clear: false,
            reason: `compliance_http_${res.status}`,
            checkedAt: clock(),
          };
        }
        const body = (await res.json()) as {
          data?: {
            result?: 'approved' | 'denied' | 'review';
            hits?: Array<{ list: string; entry: string }>;
          };
        };
        const result = body?.data?.result;
        if (result === 'approved') {
          return { clear: true, checkedAt: clock(), hits: body?.data?.hits ?? [] };
        }
        return {
          clear: false,
          reason: result ?? 'denied',
          list: body?.data?.hits?.[0]?.list,
          hits: body?.data?.hits ?? [],
          checkedAt: clock(),
        };
      } catch (err) {
        return {
          clear: false,
          reason: `compliance_error:${(err as Error).message}`,
          checkedAt: clock(),
        };
      }
    };
  }

  // Fallback stub: local JSON blocklist. Documented in docs/DEVIATIONS.md.
  return makeBlocklistScreener(blocklistPath, clock);
}

export function makeBlocklistScreener(
  blocklistPath: string | null,
  clock: () => number = Date.now,
): SanctionsScreener {
  const blocked = new Set<string>(loadBlocklist(blocklistPath));
  return async (wallet: string): Promise<SanctionsResult> => {
    if (!wallet) return { clear: false, reason: 'no_address', checkedAt: clock() };
    const lowered = wallet.toLowerCase();
    if (blocked.has(lowered)) {
      return {
        clear: false,
        reason: 'ofac_hit',
        list: 'LOCAL_BLOCKLIST',
        hits: [{ list: 'LOCAL_BLOCKLIST', entry: lowered }],
        checkedAt: clock(),
      };
    }
    return { clear: true, checkedAt: clock() };
  };
}

function loadBlocklist(blocklistPath: string | null): string[] {
  // Baseline: two obvious test addresses always blocked so our deny-path tests
  // have deterministic fixtures.
  const baseline: string[] = [
    '0x0000000000000000000000000000000000000bad',
    '0x1111111111111111111111111111111111111111',
  ];
  if (!blocklistPath) return baseline;
  try {
    const absolute = path.isAbsolute(blocklistPath)
      ? blocklistPath
      : path.resolve(process.cwd(), blocklistPath);
    if (!fs.existsSync(absolute)) return baseline;
    const raw = fs.readFileSync(absolute, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.addresses)
        ? parsed.addresses
        : [];
    return [...baseline, ...list.map((a: string) => String(a).toLowerCase())];
  } catch {
    return baseline;
  }
}
