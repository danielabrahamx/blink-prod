const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { ethers } = require('ethers');
const { createGatewayMiddleware } = require('@circlefin/x402-batching/server');
const blinkContractArtifact = require('./blink-contract-abi.json');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Backward-compat: accept the legacy BLINK_CONTRACT_ADDRESS env var if present so
// existing local .env files keep working until operators cut over.
const BLINK_CONTRACT_ADDRESS =
  process.env.BLINK_CONTRACT_ADDRESS || process.env.PARAMIFY_ADDRESS;
const ARC_RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
const BLINK_CONTRACT_ABI = blinkContractArtifact.abi || blinkContractArtifact;

// Arc Testnet token addresses (used by /api/admin/* routes)
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const USYC_ADDRESS = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C';
const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];

// Lazy-init Circle Developer-Controlled Wallets client. Keeps server boot
// unblocked if CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET are missing; errors
// surface only when an admin route is actually called.
let circleClient = null;
function getCircleClient() {
  if (circleClient) return circleClient;
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error('Circle DCV not configured (missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET)');
  }
  const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
  circleClient = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  return circleClient;
}

// In-memory accumulators (demo state)
let totalPremiumsUsdc = 0;
const lastTxs = [];
const TX_CAP = 100;

function recordTx(entry) {
  lastTxs.push(entry);
  if (lastTxs.length > TX_CAP) lastTxs.shift();
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Middleware
app.use(cors({
  exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
}));
app.use(express.json());

// --- x402 Gateway ---
const gateway = createGatewayMiddleware({
  sellerAddress: process.env.CIRCLE_WALLET_ADDRESS,
  networks: ['eip155:5042002'], // Arc Testnet only
});

// --- Billed route definitions ---
// Two priced endpoints — charging state is the only rating factor.
// /charging (plugged in, At Desk): baseline 3 µ-USDC/sec.
// /battery  (on battery, On The Move): 6 µ-USDC/sec (2× baseline).
const BILLED = [
  { path: '/api/insure/charging', charging: true,  price: '$0.000003', priceUsdc: 0.000003 },
  { path: '/api/insure/battery',  charging: false, price: '$0.000006', priceUsdc: 0.000006 },
];

for (const route of BILLED) {
  app.get(route.path, gateway.require(route.price), (req, res) => {
    totalPremiumsUsdc += route.priceUsdc;
    const premiumMicroUsdc = Math.round(route.priceUsdc * 1e6);
    const payload = {
      ok: true,
      charging: route.charging,
      premiumMicroUsdc,
      txPayer: req.payment?.payer,
      txAmount: req.payment?.amount,
      network: req.payment?.network,
      txHash: req.payment?.transaction,
    };
    recordTx({
      ...payload,
      path: route.path,
      timestamp: new Date().toISOString(),
    });
    res.json(payload);
  });
}

// --- Unbilled routes ---

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    totalPremiumsUsdc: Number(totalPremiumsUsdc.toFixed(6)),
    lastTxs,
  });
});

app.get('/api/status', async (req, res) => {
  const sellerAddress = process.env.CIRCLE_WALLET_ADDRESS || null;
  try {
    const provider = new ethers.JsonRpcProvider(ARC_RPC_URL);
    const contract = new ethers.Contract(BLINK_CONTRACT_ADDRESS, BLINK_CONTRACT_ABI, provider);
    const [usdcPool, usycReserve] = await Promise.all([
      contract.usdcPool(),
      contract.usycReserve(),
    ]);
    const usdcPoolFormatted = ethers.formatUnits(usdcPool, 6);
    const usycReserveFormatted = ethers.formatUnits(usycReserve, 6);
    res.json({
      sellerAddress,
      contractUsdcPool: usdcPoolFormatted,
      contractUsycReserve: usycReserveFormatted,
      usdcPool: usdcPoolFormatted,
      usycReserve: usycReserveFormatted,
      txCount: lastTxs.length,
    });
  } catch (error) {
    res.json({
      error: error.message,
      sellerAddress,
      contractUsdcPool: null,
      contractUsycReserve: null,
      usdcPool: null,
      usycReserve: null,
      txCount: lastTxs.length,
    });
  }
});

// GET /api/balance/:address - convenience alias for the admin portal
app.get('/api/balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    const provider = new ethers.JsonRpcProvider(ARC_RPC_URL);
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_BALANCE_ABI, provider);
    const usyc = new ethers.Contract(USYC_ADDRESS, ERC20_BALANCE_ABI, provider);
    const [usdcBal, usycBal] = await Promise.all([
      usdc.balanceOf(address).catch(() => 0n),
      usyc.balanceOf(address).catch(() => 0n),
    ]);
    res.json({
      address,
      usdc: ethers.formatUnits(usdcBal, 6),
      usyc: ethers.formatUnits(usycBal, 6),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Admin routes (unbilled) ---

// GET /api/admin/balance/:address - on-chain USDC + USYC balances
app.get('/api/admin/balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    const provider = new ethers.JsonRpcProvider(ARC_RPC_URL);
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_BALANCE_ABI, provider);
    const usyc = new ethers.Contract(USYC_ADDRESS, ERC20_BALANCE_ABI, provider);

    const [usdcBal, usycBal] = await Promise.all([
      usdc.balanceOf(address).catch(() => 0n),
      usyc.balanceOf(address).catch(() => 0n),
    ]);

    res.json({
      address,
      usdc: ethers.formatUnits(usdcBal, 6),
      usyc: ethers.formatUnits(usycBal, 6),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/wallet-balance - Circle DCV wallet token balances
app.get('/api/admin/wallet-balance', async (req, res) => {
  try {
    const walletId = process.env.CIRCLE_WALLET_ID;
    if (!walletId) {
      return res.status(500).json({ error: 'CIRCLE_WALLET_ID not set', tokenBalances: [] });
    }
    const client = getCircleClient();
    const balRes = await client.getWalletTokenBalance({ id: walletId });
    const tokenBalances = balRes?.data?.tokenBalances || [];
    res.json({
      walletId,
      address: process.env.CIRCLE_WALLET_ADDRESS || null,
      tokenBalances,
    });
  } catch (error) {
    res.status(500).json({ error: error.message, tokenBalances: [] });
  }
});

// POST /api/admin/deposit-reserve - body { amountUsyc } human units
app.post('/api/admin/deposit-reserve', async (req, res) => {
  try {
    const { amountUsyc } = req.body || {};
    const amount = Number(amountUsyc);
    if (!amount || amount <= 0) {
      return res.status(400).json({ ok: false, error: 'amountUsyc required and must be > 0' });
    }
    const walletId = process.env.CIRCLE_WALLET_ID;
    if (!walletId) {
      return res.status(500).json({ ok: false, error: 'CIRCLE_WALLET_ID not set' });
    }
    if (!BLINK_CONTRACT_ADDRESS) {
      return res.status(500).json({ ok: false, error: 'BLINK_CONTRACT_ADDRESS not set' });
    }
    const client = getCircleClient();
    const amountUnits = (BigInt(Math.round(amount * 1e6))).toString();
    const MAX_UINT256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935';

    // 1) Approve the Blink contract to pull USYC from the DCV wallet
    await client.createContractExecutionTransaction({
      walletId,
      contractAddress: USYC_ADDRESS,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [BLINK_CONTRACT_ADDRESS, MAX_UINT256],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });
    await new Promise((r) => setTimeout(r, 3000));

    // 2) Call depositReserve(uint256) on the Blink contract
    const depositTx = await client.createContractExecutionTransaction({
      walletId,
      contractAddress: BLINK_CONTRACT_ADDRESS,
      abiFunctionSignature: 'depositReserve(uint256)',
      abiParameters: [amountUnits],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    res.json({ ok: true, txId: depositTx?.data?.id || null, amountUsyc: amount });
  } catch (error) {
    console.error('deposit-reserve error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/settle', (req, res) => {
  const { totalMicroUsdc = 0, state = {}, txHashes = [] } = req.body || {};
  const receiptId = randomHex(16);
  res.json({
    settled: true,
    receiptId,
    totalMicroUsdc,
    state,
    txHashes,
    timestamp: new Date().toISOString(),
  });
});

// --- Startup ---
function startServer() {
  app.listen(PORT, () => {
    console.log(`Blink backend running on port ${PORT}`);
    console.log(`Seller: ${process.env.CIRCLE_WALLET_ADDRESS}`);
    console.log(`Blink contract: ${BLINK_CONTRACT_ADDRESS} @ ${ARC_RPC_URL}`);
    console.log('Billed routes:');
    for (const r of BILLED) console.log(`   GET ${r.path}  (${r.price})`);
    console.log('Unbilled: GET /api/health, GET /api/status, POST /api/settle');
  });
}

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});

if (require.main === module) startServer();

module.exports = app;
