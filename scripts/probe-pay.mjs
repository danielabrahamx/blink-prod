import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, 'backend', '.env') });
dotenv.config({ path: path.join(ROOT, 'frontend', '.env') });

const clientMjs = path.join(ROOT, 'frontend', 'node_modules', '@circlefin', 'x402-batching', 'dist', 'client', 'index.mjs');
const { GatewayClient } = await import('file:///' + clientMjs.replace(/\\/g, '/'));
const client = new GatewayClient({ chain: 'arcTestnet', privateKey: process.env.VITE_BUYER_PRIVATE_KEY, rpcUrl: process.env.VITE_RPC_URL });

const stringify = (o) => JSON.stringify(o, (_, v) => typeof v === 'bigint' ? v.toString() : v);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Intercept HTTP errors
const origFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const r = await origFetch(...args);
  if (!r.ok) {
    const clone = r.clone();
    const body = await clone.text().catch(() => '');
    console.log(`[HTTP ${r.status}] ${args[0]} body=${body.slice(0, 400)}`);
  }
  return r;
};

for (let i = 0; i < 5; i++) {
  const t0 = Date.now();
  try {
    const r = await client.pay('http://localhost:3001/api/insure/home-charging');
    console.log(`#${i + 1} OK tx=${r.transaction} amt=${r.amount} ms=${Date.now()-t0}`);
  } catch (e) {
    console.log(`#${i + 1} ERR ms=${Date.now()-t0} ${e.message}`);
  }
  await sleep(2000);  // 2s spacing
}
