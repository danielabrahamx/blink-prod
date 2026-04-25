#!/usr/bin/env node
// Blink real-testnet payment runner (Arc Testnet chainId 5042002)
// Round-robins the 2 priced endpoints (charging / battery), producing 60
// real x402 batched payments. Uses GatewayClient from frontend/node_modules
// (installed via Circle private registry).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, 'backend', '.env') });
dotenv.config({ path: path.join(ROOT, 'frontend', '.env') });

const BACKEND = process.env.VITE_BACKEND_URL || 'http://localhost:3001';
const PK = process.env.VITE_BUYER_PRIVATE_KEY;
const RPC = process.env.VITE_RPC_URL || process.env.ARC_RPC_URL;

if (!PK) {
  console.error('FATAL: VITE_BUYER_PRIVATE_KEY missing');
  process.exit(2);
}

// Import GatewayClient from the frontend install (backend install prunes it).
const { GatewayClient } = await import(
  'file:///' +
  path.join(ROOT, 'frontend', 'node_modules', '@circlefin', 'x402-batching', 'dist', 'client', 'index.mjs').replace(/\\/g, '/')
);

const client = new GatewayClient({
  chain: 'arcTestnet',
  privateKey: PK,
  ...(RPC ? { rpcUrl: RPC } : {}),
});

const ENDPOINTS = [
  '/api/insure/charging',
  '/api/insure/battery',
];

const ITERATIONS = Number(process.env.ITER) > 0 ? Number(process.env.ITER) : 60;
const LOG_PATH = path.join(ROOT, 'scripts', 'demo-tx-log.json');
const log = { startedAt: new Date().toISOString(), backend: BACKEND, rpc: RPC, iterations: ITERATIONS, entries: [] };

function tsNow() { return new Date().toISOString(); }

function extractTxHash(r) {
  if (!r || typeof r !== 'object') return '';
  for (const k of ['transaction', 'txHash', 'transactionHash', 'hash']) {
    const v = r[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

function extractAmountMicro(r) {
  if (!r || typeof r !== 'object') return 0;
  if (typeof r.amount === 'bigint') return Number(r.amount);
  if (typeof r.amount === 'number') return Math.floor(r.amount);
  if (typeof r.amount === 'string') return Math.floor(Number(r.amount));
  if (typeof r.formattedAmount === 'string') return Math.floor(Number(r.formattedAmount) * 1_000_000);
  return 0;
}

let firstHashPrinted = false;
let consecutiveFails = 0;
let successCount = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

for (let i = 0; i < ITERATIONS; i++) {
  if (i > 0) await sleep(1200); // avoid Gateway rate-limit
  const endpoint = ENDPOINTS[i % ENDPOINTS.length];
  const fullUrl = new URL(endpoint, BACKEND).toString();
  const entry = { ts: tsNow(), endpoint, iteration: i + 1, ok: false };
  let res, lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await client.pay(fullUrl);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await sleep(800 * (attempt + 1));
    }
  }
  try {
    if (lastErr) throw lastErr;
    const txHash = extractTxHash(res);
    const amountMicro = extractAmountMicro(res);
    entry.ok = Boolean(txHash);
    entry.txHash = txHash;
    entry.amountMicroUsdc = amountMicro;
    entry.status = res?.status;
    if (entry.ok) {
      successCount++;
      consecutiveFails = 0;
      if (!firstHashPrinted) {
        console.log(`FIRST_TX_HASH: ${txHash}`);
        console.log(`FIRST_EXPLORER_HINT: txhash=${txHash}`);
        firstHashPrinted = true;
      }
      console.log(`[${i + 1}/${ITERATIONS}] OK  ${endpoint.padEnd(28)} micro=${amountMicro} tx=${txHash.slice(0, 18)}...`);
    } else {
      consecutiveFails++;
      entry.error = 'no_tx_hash_in_response';
      console.log(`[${i + 1}/${ITERATIONS}] ??  ${endpoint} no_tx_hash response=${JSON.stringify(res).slice(0, 200)}`);
    }
  } catch (e) {
    consecutiveFails++;
    entry.error = e?.message || String(e);
    console.log(`[${i + 1}/${ITERATIONS}] ERR ${endpoint}  ${entry.error}`);
  }
  log.entries.push(entry);
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));

  if (i < 3 && consecutiveFails >= 3 && successCount === 0) {
    console.error(`\nFATAL: first 3 attempts failed, aborting per guardrail.`);
    console.error(`Last error: ${entry.error}`);
    log.abortedEarly = true;
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
    process.exit(3);
  }
}

const okCount = log.entries.filter(e => e.ok).length;
const failCount = log.entries.length - okCount;
const totalMicro = log.entries.filter(e => e.ok).reduce((s, e) => s + (e.amountMicroUsdc || 0), 0);
const state = { plugged: 0, unplugged: 0 };
for (const e of log.entries.filter(x => x.ok)) {
  const key = e.endpoint.endsWith('/charging') ? 'plugged' : 'unplugged';
  state[key] += (e.amountMicroUsdc || 0);
}
const txHashes = log.entries.filter(x => x.ok).map(x => x.txHash);

log.summary = { okCount, failCount, totalMicroUsdc: totalMicro, state, firstThreeHashes: txHashes.slice(0, 3) };
fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));

console.log('\n=== SUMMARY ===');
console.log(`ok=${okCount} fail=${failCount} totalMicroUsdc=${totalMicro}`);
console.log(`first3_hashes=${JSON.stringify(txHashes.slice(0, 3))}`);
console.log(`log=${LOG_PATH}`);

// --- Settle ---
try {
  const settleRes = await fetch(new URL('/api/settle', BACKEND).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalMicroUsdc: totalMicro, state, txHashes }),
  });
  const settleJson = await settleRes.json().catch(() => ({}));
  log.settlement = { status: settleRes.status, body: settleJson };
  console.log(`SETTLE_STATUS=${settleRes.status}`);
  console.log(`SETTLE_BODY=${JSON.stringify(settleJson)}`);
} catch (e) {
  log.settlement = { error: e?.message || String(e) };
  console.log(`SETTLE_ERR=${log.settlement.error}`);
}

// Final health
try {
  const h = await fetch(new URL('/api/health', BACKEND).toString());
  const hj = await h.json();
  log.finalHealth = hj;
  console.log(`FINAL_HEALTH=${JSON.stringify({ status: hj.status, lastTxs: hj.lastTxs?.length, totalPremiumsUsdc: hj.totalPremiumsUsdc })}`);
} catch (e) {
  log.finalHealth = { error: e?.message || String(e) };
  console.log(`FINAL_HEALTH_ERR=${log.finalHealth.error}`);
}

fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
console.log('DONE');
