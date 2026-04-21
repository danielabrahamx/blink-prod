// scripts/mint-usyc.js
// Mints USYC to admin wallet by depositing USDC into the USYC Teller contract.
// The wallet (DEPLOYER_PRIVATE_KEY) must be USYC-allowlisted.
//
// Usage:  node scripts/mint-usyc.js --amount <USDC_amount>
// Example: node scripts/mint-usyc.js --amount 10
//   → approves 10 USDC to Teller, calls deposit, logs USYC received

require("dotenv").config();
const { ethers } = require("ethers");

const RPC_URL    = "https://rpc.testnet.arc.network";
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const USYC_TELLER  = "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A";
const USYC_ADDRESS = "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];
const TELLER_ABI = [
  "function deposit(uint256 _assets, address _receiver) returns (uint256)",
];

async function main() {
  // Parse --amount argument
  const args = process.argv.slice(2);
  const amountIdx = args.indexOf("--amount");
  if (amountIdx === -1 || !args[amountIdx + 1]) {
    console.error("Usage: node scripts/mint-usyc.js --amount <USDC_amount>");
    process.exit(1);
  }
  const usdcAmount = parseFloat(args[amountIdx + 1]);
  if (isNaN(usdcAmount) || usdcAmount <= 0) {
    console.error("Amount must be a positive number");
    process.exit(1);
  }

  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    console.error("DEPLOYER_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  console.log("Admin wallet:", wallet.address);

  const usdc   = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
  const usyc   = new ethers.Contract(USYC_ADDRESS, ERC20_ABI, wallet);
  const teller = new ethers.Contract(USYC_TELLER,  TELLER_ABI, wallet);

  const amountUnits = ethers.parseUnits(usdcAmount.toString(), 6);

  // Show balances before
  const [usdcBefore, usycBefore] = await Promise.all([
    usdc.balanceOf(wallet.address),
    usyc.balanceOf(wallet.address),
  ]);
  console.log(`\nBefore:`);
  console.log(`  USDC: ${ethers.formatUnits(usdcBefore, 6)}`);
  console.log(`  USYC: ${ethers.formatUnits(usycBefore, 6)}`);

  // Step 1: Approve Teller to spend USDC
  console.log(`\nApproving ${usdcAmount} USDC to Teller...`);
  const approveTx = await usdc.approve(USYC_TELLER, amountUnits);
  await approveTx.wait();
  console.log("Approved ✅");

  // Step 2: Deposit USDC → USYC
  console.log(`Depositing ${usdcAmount} USDC into Teller...`);
  const depositTx = await teller.deposit(amountUnits, wallet.address);
  const receipt   = await depositTx.wait();
  console.log("Deposited ✅  tx:", receipt.hash);

  // Show balances after
  const [usdcAfter, usycAfter] = await Promise.all([
    usdc.balanceOf(wallet.address),
    usyc.balanceOf(wallet.address),
  ]);
  console.log(`\nAfter:`);
  console.log(`  USDC: ${ethers.formatUnits(usdcAfter, 6)}`);
  console.log(`  USYC: ${ethers.formatUnits(usycAfter, 6)}`);
  console.log(`\n✅ USYC minted: ${ethers.formatUnits(usycAfter - usycBefore, 6)}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
