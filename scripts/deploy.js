const { ethers } = require("hardhat");
require("dotenv").config();

// Arc Testnet token addresses
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const USYC_ADDRESS = "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C";
// Reuse existing oracle — no need to redeploy
const MOCK_ORACLE_ADDRESS = process.env.MOCK_ORACLE_ADDRESS;

async function main() {
  if (!MOCK_ORACLE_ADDRESS) {
    throw new Error("MOCK_ORACLE_ADDRESS not set in .env");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const BlinkReserve = await ethers.getContractFactory("BlinkReserve");
  const blinkReserve = await BlinkReserve.deploy(MOCK_ORACLE_ADDRESS, USDC_ADDRESS, USYC_ADDRESS);
  await blinkReserve.waitForDeployment();

  const address = await blinkReserve.getAddress();
  console.log("✅ BlinkReserve deployed to:", address);
  console.log("\n📋 Next steps:");
  console.log(`  1. Update .env → BLINKRESERVE_ADDRESS=${address}`);
  console.log(`  2. Update frontend/src/lib/contract.ts → BLINKRESERVE_ADDRESS`);
  console.log(`  3. Export new ABI: node -e "const a=require('./artifacts/contracts/BlinkReserve.sol/BlinkReserve.json'); require('fs').writeFileSync('./blinkReserve-abi.json', JSON.stringify(a,null,2))"`);
  console.log(`  4. Submit ${address} to Circle support for USYC allowlisting`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
