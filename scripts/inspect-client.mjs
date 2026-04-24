import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, 'backend', '.env') });
dotenv.config({ path: path.join(ROOT, 'frontend', '.env') });

const clientMjs = path.join(ROOT, 'frontend', 'node_modules', '@circlefin', 'x402-batching', 'dist', 'client', 'index.mjs');
const { GatewayClient } = await import('file:///' + clientMjs.replace(/\\/g, '/'));
const client = new GatewayClient({ chain: 'arcTestnet', privateKey: process.env.VITE_BUYER_PRIVATE_KEY, rpcUrl: process.env.VITE_RPC_URL });

const stringify = (o) => JSON.stringify(o, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
console.log('methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(client)).join(','));

try { const u = await client.getUsdcBalance(); console.log('usdc_wallet:', stringify(u)); } catch (e) { console.log('usdc_err:', e.message); }
try { const g = await client.getGatewayBalance(); console.log('gateway_balance:', stringify(g)); } catch (e) { console.log('gw_err:', e.message); }
try { const all = await client.getAllBalances(); console.log('all_balances:', stringify(all)); } catch (e) { console.log('all_err:', e.message); }

try {
  const r = await client.pay('http://localhost:3001/api/insure/home-charging');
  console.log('pay_keys:', Object.keys(r));
  console.log('pay_full:', stringify(r).slice(0, 1500));
} catch (e) {
  console.log('pay_err:', e.message);
  if (e.response) console.log('pay_err_response:', stringify(e.response).slice(0, 800));
  if (e.cause) console.log('pay_err_cause:', stringify(e.cause).slice(0, 800));
}
