const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const { createGatewayMiddleware } = require('@circlefin/x402-batching/server');
const { createClaimsRouter } = require('./src/claims');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Contract addresses
const BLINKRESERVE_ADDRESS = process.env.BLINKRESERVE_ADDRESS;
const ARC_RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';

// Token addresses (Arc Testnet)
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const USYC_ADDRESS = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

// BlinkReserve ABI (pool/reserve reads for admin dashboard)
const BLINKRESERVE_ABI = [
  {
    "inputs": [],
    "name": "usdcPool",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "usycReserve",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
];

// In-memory accumulators (demo state)
let totalPremiumsUsdc = 0;
let totalReserveUsyc = 0;

// Middleware
app.use(cors({
  exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
  allowedHeaders: ['Content-Type', 'X-Admin-Wallet'],
}));
app.use(express.json());

// --- Admin portal routes (Module 5) ---
const { createAdminRouter } = require('./src/admin');
app.use('/admin', createAdminRouter());

// --- x402 Gateway Middleware ---
const gateway = createGatewayMiddleware({
  sellerAddress: process.env.CIRCLE_WALLET_ADDRESS,
  networks: ['eip155:5042002'], // Arc Testnet only
});

// --- x402 Paid Endpoints ---

// GET /api/insure/active - per-second active-use laptop insurance ($0.000005/s)
app.get('/api/insure/active', gateway.require('$0.000005'), (req, res) => {
  totalPremiumsUsdc += 0.000005;
  res.json({
    covered: true,
    mode: 'active',
    timestamp: new Date().toISOString(),
    duration: '1s',
    payer: req.payment?.payer,
    amount: req.payment?.amount,
    network: req.payment?.network,
    transaction: req.payment?.transaction,
  });
});

// GET /api/insure/idle - per-second idle/stored laptop insurance ($0.00001/s)
app.get('/api/insure/idle', gateway.require('$0.00001'), (req, res) => {
  totalPremiumsUsdc += 0.00001;
  res.json({
    covered: true,
    mode: 'idle',
    timestamp: new Date().toISOString(),
    duration: '1s',
    payer: req.payment?.payer,
    amount: req.payment?.amount,
    network: req.payment?.network,
    transaction: req.payment?.transaction,
  });
});

// --- Standard Endpoints ---

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Blink backend service is running',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/status', async (req, res) => {
  try {
    let poolData = null;
    try {
      const provider = new ethers.JsonRpcProvider(ARC_RPC_URL);
      const blinkReserveContract = new ethers.Contract(BLINKRESERVE_ADDRESS, BLINKRESERVE_ABI, provider);
      const [usdcPool, usycReserve] = await Promise.all([
        blinkReserveContract.usdcPool(),
        blinkReserveContract.usycReserve(),
      ]);
      poolData = {
        contractUsdcPool: ethers.formatUnits(usdcPool, 6),
        contractUsycReserve: ethers.formatUnits(usycReserve, 6),
      };
    } catch (error) {
      console.warn('Could not fetch contract data:', error.message);
    }

    res.json({
      service: 'active',
      sellerAddress: process.env.CIRCLE_WALLET_ADDRESS,
      network: 'eip155:5042002',
      contractUsdcPool: totalPremiumsUsdc.toFixed(6),
      contractUsycReserve: totalReserveUsyc.toFixed(6),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/balance/:address - returns USDC and USYC balances for any address
app.get('/api/balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    // Use Circle API for the admin wallet (RPC USDC precompile doesn't support balanceOf)
    const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
    const circleClient = initiateDeveloperControlledWalletsClient({
      apiKey: process.env.CIRCLE_API_KEY,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    });

    const balRes = await circleClient.getWalletTokenBalance({ id: process.env.CIRCLE_WALLET_ID });
    const tokenBalances = balRes.data?.tokenBalances || [];

    const usdc = tokenBalances.find(t => t.token?.symbol === 'USDC')?.amount || '0';
    const usyc = tokenBalances.find(t => t.token?.symbol === 'USYC')?.amount || '0';

    res.json({ usdc, usyc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/deposit-reserve - admin deposits USYC into contract reserve
app.post('/api/admin/deposit-reserve', async (req, res) => {
  try {
    const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
    const circleClient = initiateDeveloperControlledWalletsClient({
      apiKey: process.env.CIRCLE_API_KEY,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    });

    const { amountUsyc } = req.body;
    if (!amountUsyc || amountUsyc <= 0) {
      return res.status(400).json({ error: 'amountUsyc required and must be > 0' });
    }

    const amountUnits = (BigInt(Math.round(amountUsyc * 1e6))).toString();
    const MAX_UINT256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935';

    // Step 1: Approve BlinkReserve to spend USYC from Circle dev wallet
    await circleClient.createContractExecutionTransaction({
      walletId: process.env.CIRCLE_WALLET_ID,
      contractAddress: USYC_ADDRESS,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [BLINKRESERVE_ADDRESS, MAX_UINT256],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    // Wait for approve to land on-chain
    await new Promise(r => setTimeout(r, 3000));

    // Step 2: Call depositReserve on BlinkReserve
    const depositTx = await circleClient.createContractExecutionTransaction({
      walletId: process.env.CIRCLE_WALLET_ID,
      contractAddress: BLINKRESERVE_ADDRESS,
      abiFunctionSignature: 'depositReserve(uint256)',
      abiParameters: [amountUnits],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    totalReserveUsyc += amountUsyc;
    res.json({ success: true, txId: depositTx.data.id, amountUsyc });
  } catch (error) {
    console.error('Deposit reserve error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/trigger-claim - admin triggers USDC payout to a user
app.post('/api/admin/trigger-claim', async (req, res) => {
  try {
    const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
    const circleClient = initiateDeveloperControlledWalletsClient({
      apiKey: process.env.CIRCLE_API_KEY,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    });

    const { recipientAddress, amountUsdc } = req.body;
    if (!recipientAddress || !ethers.isAddress(recipientAddress)) {
      return res.status(400).json({ error: 'Valid recipientAddress required' });
    }
    if (!amountUsdc || amountUsdc <= 0) {
      return res.status(400).json({ error: 'amountUsdc must be > 0' });
    }

    const amountUnits = (BigInt(Math.round(amountUsdc * 1e6))).toString();

    // Transfer USDC from Circle dev wallet to recipient
    const tx = await circleClient.createContractExecutionTransaction({
      walletId: process.env.CIRCLE_WALLET_ID,
      contractAddress: USDC_ADDRESS,
      abiFunctionSignature: 'transfer(address,uint256)',
      abiParameters: [recipientAddress, amountUnits],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    res.json({ success: true, txId: tx.data.id, amountUsdc, recipientAddress });
  } catch (error) {
    console.error('Trigger claim error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Claims v1 router ---
// Uses the in-memory repository by default. The reserveClient is wired to
// the live Circle USDC transfer here; tests inject a mock BlinkReserve
// adapter instead. See backend/src/claims/payout.ts for the interface.
const liveReserveClient = {
  async transferPayout({ claimId, recipientAddress, amountUsdc }) {
    try {
      const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
      const circleClient = initiateDeveloperControlledWalletsClient({
        apiKey: process.env.CIRCLE_API_KEY,
        entitySecret: process.env.CIRCLE_ENTITY_SECRET,
      });
      const amountUnits = BigInt(Math.round(amountUsdc * 1e6)).toString();
      const tx = await circleClient.createContractExecutionTransaction({
        walletId: process.env.CIRCLE_WALLET_ID,
        contractAddress: USDC_ADDRESS,
        abiFunctionSignature: 'transfer(address,uint256)',
        abiParameters: [recipientAddress, amountUnits],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
        refId: claimId,
      });
      return { success: true, txHash: tx.data && tx.data.id, network: 'arc-testnet' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};

app.use(
  '/claims',
  createClaimsRouter({
    reserveClient: liveReserveClient,
  })
);

// Start the server
async function startServer() {
  try {
    app.listen(PORT, () => {
      console.log(`Blink backend server running on port ${PORT}`);
      console.log(`API endpoints available:`);
      console.log(`   - GET  /api/health`);
      console.log(`   - GET  /api/status`);
      console.log(`   - GET  /api/insure/active  (x402 - $0.0005/req)`);
      console.log(`   - GET  /api/insure/idle     (x402 - $0.001/req)`);
      console.log(`   - GET  /api/balance/:address`);
      console.log(`   - POST /api/admin/deposit-reserve`);
      console.log(`   - POST /api/admin/trigger-claim`);
      console.log(`Seller address: ${process.env.CIRCLE_WALLET_ADDRESS}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

// Only start when run directly (not when required for testing)
if (require.main === module) {
  startServer();
}

module.exports = app;
