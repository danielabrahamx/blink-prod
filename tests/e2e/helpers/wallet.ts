import { Page } from '@playwright/test';

const ARC_RPC_URL = 'https://rpc.testnet.arc.network';
const ARC_CHAIN_ID = '0x4CEF52'; // 5042002

// Real Arc Testnet wallet addresses
const ADMIN_ADDRESS = '0xa4d42d3f0ae0e03df1937cdb0f14c58e64581359'; // Circle dev-controlled wallet (deployer/admin)
const TEST_USER_ADDRESS = process.env.TEST_USER_ADDRESS || ADMIN_ADDRESS;

interface WalletOptions {
  address?: string;
  chainId?: string;
}

/**
 * Injects a window.ethereum provider that:
 * - Returns the given address for account queries
 * - Returns Arc Testnet chain ID
 * - Forwards ALL RPC read calls to the real Arc Testnet node
 *
 * This gives us real on-chain state (balances, contract data) without
 * needing to start a local node or use hardcoded mock responses.
 */
export async function injectMockWallet(page: Page, options: WalletOptions = {}) {
  const address = options.address ?? TEST_USER_ADDRESS;
  const chainId = options.chainId ?? ARC_CHAIN_ID;

  await page.addInitScript(
    ({ address, chainId, rpcUrl }) => {
      const mockEthereum = {
        isMetaMask: true,
        selectedAddress: address,
        chainId,
        networkVersion: String(parseInt(chainId, 16)),
        _listeners: {} as Record<string, Function[]>,

        request: async ({ method, params }: { method: string; params?: any[] }) => {
          // Account and chain control - return configured values
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
            return [address];
          }
          if (method === 'eth_chainId') return chainId;
          if (method === 'net_version') return String(parseInt(chainId, 16));

          // Wallet management - succeed silently
          if (method === 'wallet_switchEthereumChain') return null;
          if (method === 'wallet_addEthereumChain') return null;

          // Intercept hasRole(bytes32,address) - selector 0x91d14854
          // ABI encoding: 0x + 4B selector + 32B role + 32B address (12B padding + 20B addr)
          // address hex starts at char index 98 (0x=2, selector=8, role=64, padding=24)
          if (method === 'eth_call') {
            const callData: string = (params?.[0]?.data || '').toLowerCase();
            if (callData.startsWith('0x91d14854') && callData.length >= 138) {
              const addrInCall = '0x' + callData.slice(98, 138);
              const isMatch = addrInCall === address.toLowerCase();
              return isMatch
                ? '0x0000000000000000000000000000000000000000000000000000000000000001'
                : '0x0000000000000000000000000000000000000000000000000000000000000000';
            }
          }

          // All other calls - forward to the real Arc Testnet RPC
          try {
            const res = await fetch(rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method,
                params: params ?? [],
              }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.result;
          } catch (err) {
            console.warn('[wallet mock] RPC forward failed for', method, err);
            return null;
          }
        },

        on: (event: string, handler: Function) => {
          if (!mockEthereum._listeners[event]) {
            mockEthereum._listeners[event] = [];
          }
          mockEthereum._listeners[event].push(handler);
        },

        removeListener: (event: string, handler: Function) => {
          if (mockEthereum._listeners[event]) {
            mockEthereum._listeners[event] = mockEthereum._listeners[event].filter(
              (h) => h !== handler
            );
          }
        },
      };

      (window as any).ethereum = mockEthereum;
    },
    { address, chainId, rpcUrl: ARC_RPC_URL }
  );
}

/**
 * Inject wallet pre-configured as the Arc admin/deployer address.
 */
export async function injectAdminWallet(page: Page) {
  return injectMockWallet(page, { address: ADMIN_ADDRESS });
}

/**
 * Inject wallet on wrong chain (Ethereum mainnet) to test chain-error UI.
 */
export async function injectWrongChainWallet(page: Page) {
  return injectMockWallet(page, {
    address: TEST_USER_ADDRESS,
    chainId: '0x1', // Ethereum mainnet
  });
}

export { ARC_CHAIN_ID, ARC_RPC_URL, TEST_USER_ADDRESS, ADMIN_ADDRESS };
