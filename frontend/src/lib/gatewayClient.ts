import { GatewayClient } from '@circlefin/x402-batching/client';
import { createSimulationGatewayClient } from './simulationClient';

export type PayResult =
  | {
      ok: true;
      txHash: string;
      amountMicroUsdc: number;
      endpoint: string;
      payload: unknown;
    }
  | { ok: false; error: string; endpoint: string };

export type GatewayBalances = {
  walletUsdc: string;
  gatewayAvailableUsdc: string;
  gatewayTotalUsdc: string;
};

export type DepositResult =
  | { ok: true; txHash: string; formattedAmount: string }
  | { ok: false; error: string };

export type BlinkGatewayClient = {
  pay: (endpoint: string) => Promise<PayResult>;
  deposit: (amountUsdc: string) => Promise<DepositResult>;
  getBalances: () => Promise<GatewayBalances>;
};

let cached: BlinkGatewayClient | null = null;

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

function resolveFullUrl(endpoint: string): string {
  const base = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? '';
  if (!base) return endpoint;
  try {
    return new URL(endpoint, base).toString();
  } catch {
    const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const trimmedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${trimmedBase}${trimmedEndpoint}`;
  }
}

function extractTxHash(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['txHash', 'transaction', 'transactionHash', 'tx', 'hash']) {
      const v = obj[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    const receipt = obj.receipt;
    if (receipt && typeof receipt === 'object') {
      const r = receipt as Record<string, unknown>;
      for (const key of ['transactionHash', 'txHash', 'hash']) {
        const v = r[key];
        if (typeof v === 'string' && v.length > 0) return v;
      }
    }
  }
  return '';
}

function extractAmountMicroUsdc(payload: unknown): number {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const direct = obj.amountMicroUsdc ?? obj.microUsdc ?? obj.amount_micro_usdc;
    if (typeof direct === 'number' && Number.isFinite(direct)) return Math.floor(direct);
    if (typeof direct === 'string' && direct.trim() !== '') {
      const n = Number(direct);
      if (Number.isFinite(n)) return Math.floor(n);
    }
    const raw = obj.rawAmount ?? obj.amountRaw;
    if (typeof raw === 'string' && raw.trim() !== '') {
      const n = Number(raw);
      if (Number.isFinite(n)) return Math.floor(n);
    }
    const formatted = obj.formattedAmount ?? obj.amount;
    if (typeof formatted === 'string' && formatted.trim() !== '') {
      const n = Number(formatted);
      if (Number.isFinite(n)) return Math.floor(n * 1_000_000);
    }
    if (typeof formatted === 'number' && Number.isFinite(formatted)) {
      return Math.floor(formatted * 1_000_000);
    }
  }
  return 0;
}

function buildRealClient(): BlinkGatewayClient {
  const privateKey = import.meta.env.VITE_BUYER_PRIVATE_KEY as `0x${string}` | undefined;
  const rpcUrl = import.meta.env.VITE_RPC_URL as string | undefined;

  const client = new GatewayClient({
    chain: 'arcTestnet',
    privateKey: privateKey as `0x${string}`,
    ...(rpcUrl ? { rpcUrl } : {}),
  });

  return {
    async pay(endpoint: string): Promise<PayResult> {
      try {
        const fullUrl = resolveFullUrl(endpoint);
        const result = (await (client as unknown as {
          pay: (url: string) => Promise<unknown>;
        }).pay(fullUrl)) as unknown;

        let payload: unknown = result;
        if (result && typeof (result as { json?: unknown }).json === 'function') {
          try {
            payload = await (result as { json: () => Promise<unknown> }).json();
          } catch {
            payload = result;
          }
        } else if (typeof result === 'string') {
          try {
            payload = JSON.parse(result);
          } catch {
            payload = result;
          }
        }

        return {
          ok: true,
          txHash: extractTxHash(payload),
          amountMicroUsdc: extractAmountMicroUsdc(payload),
          endpoint,
          payload,
        };
      } catch (e: unknown) {
        return { ok: false, error: String(e), endpoint };
      }
    },
    async deposit(amountUsdc: string): Promise<DepositResult> {
      try {
        const result = (await (client as unknown as {
          deposit: (
            amount: string,
          ) => Promise<{ depositTxHash?: string; formattedAmount?: string }>;
        }).deposit(amountUsdc)) as {
          depositTxHash?: string;
          formattedAmount?: string;
        };
        return {
          ok: true,
          txHash: result.depositTxHash ?? '',
          formattedAmount: result.formattedAmount ?? amountUsdc,
        };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false, error: message };
      }
    },
    async getBalances(): Promise<GatewayBalances> {
      try {
        const b = (await (client as unknown as {
          getBalances: () => Promise<{
            wallet?: { formatted?: string };
            gateway?: { formattedAvailable?: string; formattedTotal?: string };
          }>;
        }).getBalances()) as {
          wallet?: { formatted?: string };
          gateway?: { formattedAvailable?: string; formattedTotal?: string };
        };
        return {
          walletUsdc: b.wallet?.formatted ?? '0',
          gatewayAvailableUsdc: b.gateway?.formattedAvailable ?? '0',
          gatewayTotalUsdc: b.gateway?.formattedTotal ?? '0',
        };
      } catch {
        return { walletUsdc: '0', gatewayAvailableUsdc: '0', gatewayTotalUsdc: '0' };
      }
    },
  };
}

export function getGatewayClient(): BlinkGatewayClient {
  if (cached) return cached;
  cached = DEMO_MODE ? createSimulationGatewayClient() : buildRealClient();
  return cached;
}
