import { GatewayClient } from '@circlefin/x402-batching/client';
import { DEMO_MODE, createSimulationGatewayClient } from './simulationClient';

let client: GatewayClient | null = null;

export function getGatewayClient(): GatewayClient {
  if (!client) {
    if (DEMO_MODE) {
      client = createSimulationGatewayClient() as unknown as GatewayClient;
    } else {
      client = new GatewayClient({
        chain: 'arcTestnet',
        privateKey: import.meta.env.VITE_BUYER_PRIVATE_KEY as `0x${string}`,
        ...(import.meta.env.VITE_RPC_URL ? { rpcUrl: import.meta.env.VITE_RPC_URL } : {}),
      });
    }
  }
  return client;
}
