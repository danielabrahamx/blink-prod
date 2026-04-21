const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const circleWallet = process.env.CIRCLE_WALLET_ADDRESS;
  if (!circleWallet) {
    throw new Error("CIRCLE_WALLET_ADDRESS must be set in .env");
  }

  // Deploy MockV3Aggregator (no access control — any address can call updateAnswer)
  const MockV3Aggregator = await hre.ethers.getContractFactory("MockV3Aggregator");
  const mock = await MockV3Aggregator.deploy(8, 300000000000); // 8 decimals, ~3 feet initial
  await mock.waitForDeployment();
  const mockAddress = await mock.getAddress();
  console.log("MockV3Aggregator deployed to:", mockAddress);

  // Deploy BlinkReserve (owner = deployer initially)
  const BlinkReserve = await hre.ethers.getContractFactory("BlinkReserve");
  const blinkReserve = await BlinkReserve.deploy(mockAddress);
  await blinkReserve.waitForDeployment();
  const blinkReserveAddress = await blinkReserve.getAddress();
  console.log("BlinkReserve deployed to:", blinkReserveAddress);

  // Transfer BlinkReserve ownership to Circle wallet so the backend can call setThreshold
  const tx = await blinkReserve.transferOwnership(circleWallet);
  await tx.wait();
  console.log("BlinkReserve ownership transferred to Circle wallet:", circleWallet);

  console.log("\n--- Add these to your .env ---");
  console.log(`MOCK_ORACLE_ADDRESS=${mockAddress}`);
  console.log(`BLINKRESERVE_ADDRESS=${blinkReserveAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
