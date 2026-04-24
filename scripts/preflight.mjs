import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import dotenv from 'dotenv';

const root = process.cwd();
dotenv.config({ path: path.join(root, 'backend', '.env') });
dotenv.config({ path: path.join(root, 'frontend', '.env') });

const RPC = process.env.ARC_RPC_URL || process.env.VITE_RPC_URL;
const PK = process.env.VITE_BUYER_PRIVATE_KEY;

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return r.json();
}

const cid = await rpc('eth_chainId', []);
console.log('chainId_raw:', cid.result, 'dec=', cid.result ? parseInt(cid.result, 16) : 'null');
console.log('chainId_match_5042002:', cid.result && parseInt(cid.result, 16) === 5042002);

const wallet = new ethers.Wallet(PK);
const addr = wallet.address;
console.log('buyer_last4:', addr.slice(-4));

const USDC = '0x3600000000000000000000000000000000000000';
const USYC = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C';
const iface = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
const data = iface.encodeFunctionData('balanceOf', [addr]);

const usdcCall = await rpc('eth_call', [{ to: USDC, data }, 'latest']);
const usycCall = await rpc('eth_call', [{ to: USYC, data }, 'latest']);
const ethBal = await rpc('eth_getBalance', [addr, 'latest']);

const usdcRaw = BigInt(usdcCall.result || '0x0');
const usycRaw = BigInt(usycCall.result || '0x0');
const ethRaw = BigInt(ethBal.result || '0x0');

console.log('usdc_balance_human:', (Number(usdcRaw) / 1e6).toFixed(6));
console.log('usyc_balance_human:', (Number(usycRaw) / 1e6).toFixed(6));
console.log('native_balance_human:', (Number(ethRaw) / 1e18).toFixed(6));
console.log('usdc_raw:', usdcRaw.toString());
