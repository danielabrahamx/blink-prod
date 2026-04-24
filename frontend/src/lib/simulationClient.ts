export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';
export const DEMO_LIMIT_SECONDS = 60;

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

const PRICE_TABLE: Record<string, number> = {
  '/api/insure/home-charging': 3,
  '/api/insure/home-battery': 6,
  '/api/insure/near-charging': 4,
  '/api/insure/near-battery': 8,
  '/api/insure/away-charging': 6,
  '/api/insure/away-battery': 12,
  '/api/insure/idle': 10,
};

export function priceFor(endpoint: string): number {
  let path = endpoint;
  try {
    path = new URL(endpoint, 'http://x.local').pathname;
  } catch {
    // endpoint was already a path
  }
  for (const key of Object.keys(PRICE_TABLE)) {
    if (path === key || path.endsWith(key)) return PRICE_TABLE[key];
  }
  return 0;
}

const sleep = (min: number, max?: number): Promise<void> =>
  new Promise(r => setTimeout(r, max ? min + Math.random() * (max - min) : min));

function randomHex(len: number): string {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function createSimulationGatewayClient(): BlinkGatewayClient {
  let simWalletUsdc = 100;
  let simGatewayUsdc = 10;
  return {
    async pay(endpoint: string): Promise<PayResult> {
      await sleep(60, 180);
      const microUsdc = priceFor(endpoint);
      simGatewayUsdc = Math.max(0, simGatewayUsdc - microUsdc / 1_000_000);
      return {
        ok: true,
        txHash: '0xSIM' + randomHex(62),
        amountMicroUsdc: microUsdc,
        endpoint,
        payload: { simulated: true },
      };
    },
    async deposit(amountUsdc: string): Promise<DepositResult> {
      await sleep(400, 900);
      const n = Number(amountUsdc);
      const amt = Number.isFinite(n) && n > 0 ? n : 0;
      if (amt === 0) return { ok: false, error: 'Invalid deposit amount' };
      if (amt > simWalletUsdc) return { ok: false, error: 'Insufficient wallet USDC' };
      simWalletUsdc -= amt;
      simGatewayUsdc += amt;
      return {
        ok: true,
        txHash: '0xSIM' + randomHex(62),
        formattedAmount: amt.toFixed(6),
      };
    },
    async getBalances(): Promise<GatewayBalances> {
      await sleep(80, 180);
      return {
        walletUsdc: simWalletUsdc.toFixed(6),
        gatewayAvailableUsdc: simGatewayUsdc.toFixed(6),
        gatewayTotalUsdc: simGatewayUsdc.toFixed(6),
      };
    },
  };
}

export interface LiveSettlement {
  txId: string;
  totalMicroUsdc: number;
  settledAt: number;
}

export async function simulateLiveSettlement(
  totalMicroUsdc: number,
): Promise<LiveSettlement> {
  await sleep(600, 1200);
  return {
    txId: '0xSIM' + randomHex(62),
    totalMicroUsdc,
    settledAt: Date.now(),
  };
}

// --- Admin dashboard simulation stubs ---
// Demo-mode only. Real mode goes through backend HTTP endpoints.
export async function simulateAdminStatus(): Promise<{
  sellerAddress: string;
  contractUsdcPool: string;
  contractUsycReserve: string;
}> {
  await sleep(150, 300);
  return {
    sellerAddress: '0x0000000000000000000000000000000000000000',
    contractUsdcPool: '0.000000',
    contractUsycReserve: '0.000000',
  };
}

export async function simulateAdminBalance(
  _address: string,
): Promise<{ usdc: string; usyc: string }> {
  await sleep(150, 300);
  return { usdc: '0.000000', usyc: '0.000000' };
}

export async function simulateDepositReserve(
  _amountUsyc: number,
): Promise<{ success: boolean; txId: string }> {
  await sleep(600, 1200);
  return { success: true, txId: '0xSIM' + randomHex(62) };
}

export async function simulateTriggerClaim(
  _recipient: string,
  _amountUsdc: number,
): Promise<{ success: boolean; txId: string }> {
  await sleep(600, 1200);
  return { success: true, txId: '0xSIM' + randomHex(62) };
}
