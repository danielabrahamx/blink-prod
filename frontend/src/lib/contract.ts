// Deployed contract addresses and ABIs for the frontend.
// The ABI below is the real BlinkReserve interface (exported from hardhat
// artifacts via `npm run export:abi`). The address still points at the legacy
// Blink contract deployment on Arc testnet and will flip to the fresh
// BlinkReserve address the moment a funded DEPLOYER_PRIVATE_KEY is plugged in.
export const BLINKRESERVE_ADDRESS = "0xFC1EfCE3D25E7eE5535E7E6D6731D9Ba131bDC43";

export const BLINKRESERVE_ABI = [
  // Views used by the admin dashboard
  'function usdcPool() view returns (uint256)',
  'function usycReserve() view returns (uint256)',
  'function floodThreshold() view returns (uint256)',
  'function priceFeed() view returns (address)',
  'function usdc() view returns (address)',
  'function usyc() view returns (address)',
  'function owner() view returns (address)',
  'function policies(address) view returns (address customer, uint256 premium, uint256 coverage, bool active, bool paidOut)',
  // Customer actions
  'function buyInsurance(uint256 _coverage)',
  'function triggerPayout()',
  // Admin actions (DEFAULT_ADMIN_ROLE)
  'function depositReserve(uint256 _amount)',
  'function withdrawUSDC(uint256 _amount)',
  'function withdrawUSYC(uint256 _amount)',
  'function setOracleAddress(address _oracleAddress)',
  'function setThreshold(uint256 _thresholdFeet)',
  // Events
  'event InsurancePurchased(address indexed customer, uint256 premium, uint256 coverage)',
  'event PayoutTriggered(address indexed customer, uint256 usdcAmount, uint256 usycAmount)',
  'event ReserveDeposited(uint256 amount)',
  'event ThresholdChanged(uint256 oldThreshold, uint256 newThreshold)',
  'event OracleAddressUpdated(address indexed oldOracle, address indexed newOracle)',
] as const;

export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
export const USYC_ADDRESS = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C';

export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const;
