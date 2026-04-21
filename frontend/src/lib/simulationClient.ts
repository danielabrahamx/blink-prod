import type { Balances, PayResult } from '@circlefin/x402-batching/client';

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';
export const DEMO_LIMIT_SECONDS = 60;

const DEMO_BUYER_ADDRESS = '0xDEM0b1dCAFE00C0ffee5Bla1nk5Ca1C1ated0000';
const DEMO_SELLER_ADDRESS = '0xA4D42d3f0aE0e03Df1937cDb0F14C58E64581359';

const ACTIVE_RATE = 0.000005;
const IDLE_RATE = 0.00001;

type DemoState = {
  walletUsdc: number;
  gatewayUsdc: number;
  contractUsdcPool: number;
  contractUsycReserve: number;
  adminUsdc: number;
  adminUsyc: number;
  paymentsMade: number;
};

const state: DemoState = {
  walletUsdc: 10.0,
  gatewayUsdc: 1.0,
  contractUsdcPool: 0.125,
  contractUsycReserve: 500.0,
  adminUsdc: 42.5,
  adminUsyc: 500.0,
  paymentsMade: 0,
};

const sleep = (min: number, max?: number) =>
  new Promise(r => setTimeout(r, max ? min + Math.random() * (max - min) : min));

const randTx = () => `0xdemo${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;

export function demoPaymentsRemaining(): number {
  return Math.max(0, DEMO_LIMIT_SECONDS - state.paymentsMade);
}

export function createSimulationGatewayClient() {
  return {
    address: DEMO_BUYER_ADDRESS,

    async getBalances(): Promise<Balances> {
      await sleep(120, 240);
      return {
        wallet: {
          formatted: state.walletUsdc.toFixed(6),
          raw: BigInt(Math.floor(state.walletUsdc * 1e6)),
        },
        gateway: {
          formattedAvailable: state.gatewayUsdc.toFixed(6),
          formattedTotal: state.gatewayUsdc.toFixed(6),
          rawAvailable: BigInt(Math.floor(state.gatewayUsdc * 1e6)),
          rawTotal: BigInt(Math.floor(state.gatewayUsdc * 1e6)),
        },
      } as unknown as Balances;
    },

    async deposit(amount: string): Promise<{ formattedAmount: string; transaction: string }> {
      await sleep(600, 900);
      const n = parseFloat(amount);
      if (state.walletUsdc < n) {
        throw new Error('Demo wallet balance too low for this deposit');
      }
      state.walletUsdc -= n;
      state.gatewayUsdc += n;
      return { formattedAmount: n.toFixed(6), transaction: randTx() };
    },

    async pay(endpoint: string): Promise<PayResult> {
      await sleep(60, 180);
      if (state.paymentsMade >= DEMO_LIMIT_SECONDS) {
        throw new Error(
          `Demo session ended (${DEMO_LIMIT_SECONDS}s limit). Reload to restart, or email daniel@sibrox.com for a live walkthrough.`
        );
      }
      state.paymentsMade += 1;
      const rate = endpoint.includes('active') ? ACTIVE_RATE : IDLE_RATE;
      state.gatewayUsdc = Math.max(0, state.gatewayUsdc - rate);
      state.contractUsdcPool += rate;
      return {
        formattedAmount: rate.toFixed(6),
        transaction: randTx(),
      } as unknown as PayResult;
    },
  };
}

export async function simulateAdminStatus() {
  await sleep(150, 300);
  return {
    sellerAddress: DEMO_SELLER_ADDRESS,
    contractUsdcPool: state.contractUsdcPool.toFixed(6),
    contractUsycReserve: state.contractUsycReserve.toFixed(6),
  };
}

export async function simulateAdminBalance(_address: string) {
  await sleep(150, 300);
  return {
    usdc: state.adminUsdc.toFixed(6),
    usyc: state.adminUsyc.toFixed(6),
  };
}

export async function simulateDepositReserve(amountUsyc: number) {
  await sleep(800, 1400);
  state.adminUsyc = Math.max(0, state.adminUsyc - amountUsyc);
  state.contractUsycReserve += amountUsyc;
  return { success: true, txId: randTx() };
}

export async function simulateTriggerClaim(_recipientAddress: string, amountUsdc: number) {
  await sleep(900, 1500);
  if (state.contractUsdcPool < amountUsdc) {
    throw new Error('Simulated pool insufficient for this claim amount');
  }
  state.contractUsdcPool -= amountUsdc;
  return { success: true, txId: randTx() };
}
