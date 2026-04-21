// Deploys BlinkReserve.sol to Arc testnet (or any network configured in
// hardhat.config.js). Writes the deployed address to
// deployments/<network>.json so the backend + frontend can pick it up.
//
// Running locally without a funded wallet: deploy to the built-in hardhat
// network (`bun run deploy:blink-reserve:local`) which spins an ephemeral
// chain. The Arc testnet deploy requires DEPLOYER_PRIVATE_KEY with funds;
// see docs/DEVIATIONS.md if the key is unfunded.

const { ethers, network, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
const USYC_ADDRESS = process.env.USYC_ADDRESS || "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C";
const MOCK_ORACLE_ADDRESS = process.env.MOCK_ORACLE_ADDRESS;

async function deployMockOracle() {
  const Mock = await ethers.getContractFactory("MockAggregatorSettlement");
  const mock = await Mock.deploy(1_000_000_000_000n);
  await mock.waitForDeployment();
  return mock.getAddress();
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No deployer configured. Set DEPLOYER_PRIVATE_KEY in .env and ensure it has funds on the target network."
    );
  }
  console.log(`Deploying BlinkReserve on ${network.name} with ${deployer.address}`);

  let oracle = MOCK_ORACLE_ADDRESS;
  if (!oracle) {
    if (network.name === "arc_testnet") {
      throw new Error(
        "MOCK_ORACLE_ADDRESS must be set for arc_testnet deploys. Reuse the existing oracle at 0xFC1EfCE3D25E7eE5535E7E6D6731D9Ba131bDC43-area or redeploy a mock."
      );
    }
    console.log("MOCK_ORACLE_ADDRESS not set — deploying a throwaway mock for local network");
    oracle = await deployMockOracle();
    console.log(`Mock oracle: ${oracle}`);
  }

  const BlinkReserve = await ethers.getContractFactory("BlinkReserve");
  const reserve = await BlinkReserve.deploy(oracle, USDC_ADDRESS, USYC_ADDRESS);
  await reserve.waitForDeployment();
  const addr = await reserve.getAddress();
  console.log(`BlinkReserve deployed: ${addr}`);

  // Persist.
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const file = path.join(deploymentsDir, `${network.name}.json`);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  existing.BlinkReserve = { address: addr, deployedAt: new Date().toISOString(), deployer: deployer.address };
  existing.USDC = USDC_ADDRESS;
  existing.USYC = USYC_ADDRESS;
  existing.priceFeed = oracle;
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + "\n");
  console.log(`Wrote ${file}`);

  // Export the ABI for the frontend.
  const artifact = await artifacts.readArtifact("BlinkReserve");
  const abiFile = path.join(deploymentsDir, "BlinkReserve.abi.json");
  fs.writeFileSync(abiFile, JSON.stringify(artifact.abi, null, 2) + "\n");
  console.log(`Wrote ${abiFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
