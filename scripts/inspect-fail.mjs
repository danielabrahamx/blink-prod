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

// Monkey-patch undici/fetch to capture raw HTTP errors
const origFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const r = await origFetch(...args);
  if (!r.ok) {
    const clone = r.clone();
    const body = await clone.text().catch(() => '');
    console.log(`[HTTP ${r.status}] url=${args[0]} body=${body.slice(0, 500)}`);
  }
  return r;
};

try {
  const r = await client.pay('http://localhost:3001/api/insure/home-charging');
  console.log('PAY_OK:', stringify(r).slice(0, 1500));
} catch (e) {
  console.log('PAY_ERR_NAME:', e.name);
  console.log('PAY_ERR_MSG:', e.message);
  console.log('PAY_ERR_STACK:', e.stack?.split('\n').slice(0, 10).join('\n'));
  for (const k of Object.keys(e)) console.log('PAY_ERR_prop_' + k + ':', stringify(e[k]).slice(0, 400));
}
