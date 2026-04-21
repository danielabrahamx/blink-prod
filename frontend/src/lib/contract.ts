// Deployed contract addresses and ABIs for the frontend.
// Address below points to the legacy Paramify contract on Arc testnet and will be
// replaced once Agent F (feat/settlement-x402) redeploys BlinkReserve.sol and regenerates
// the ABI from hardhat artifacts.
export const BLINKRESERVE_ADDRESS = "0xFC1EfCE3D25E7eE5535E7E6D6731D9Ba131bDC43";
// TODO(feat/settlement-x402): import generated ABI from artifacts/contracts/BlinkReserve.sol
export const BLINKRESERVE_ABI: any = [];

export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
export const USYC_ADDRESS = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C';

export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const;
