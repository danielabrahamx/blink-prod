// Regenerates frontend/src/lib/contract.ts's BLINKRESERVE_ABI block from the
// hardhat artifact. Run after `npx hardhat compile` and before committing any
// interface changes.

const fs = require("fs");
const path = require("path");

const artifactPath = path.join(
  __dirname,
  "..",
  "artifacts",
  "contracts",
  "BlinkReserve.sol",
  "BlinkReserve.json"
);
const contractTsPath = path.join(__dirname, "..", "frontend", "src", "lib", "contract.ts");

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const abiJson = JSON.stringify(artifact.abi, null, 2);

let source = fs.readFileSync(contractTsPath, "utf8");
source = source.replace(
  /export const BLINKRESERVE_ABI[\s\S]*?(?=\nexport const )/,
  `export const BLINKRESERVE_ABI = ${abiJson} as const;\n\n`
);
fs.writeFileSync(contractTsPath, source);
console.log("Updated BLINKRESERVE_ABI in", contractTsPath);
