import { ethers } from 'ethers';

const BLINK_CONTRACT_ADDRESS =
  (import.meta.env.VITE_BLINK_CONTRACT_ADDRESS as string | undefined) ||
  '0xFC1EfCE3D25E7eE5535E7E6D6731D9Ba131bDC43';

const USDC_ADDRESS =
  (import.meta.env.VITE_USDC_ADDRESS as string | undefined) ||
  '0x3600000000000000000000000000000000000000';

const BLINK_CONTRACT_ABI = [
  'function buyInsurance(uint256 _coverage) external',
  'function policies(address) view returns (address customer, uint256 premium, uint256 coverage, bool active, bool paidOut)',
  'function usdcPool() view returns (uint256)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

export type BuyInsuranceResult =
  | { ok: true; premiumUsdc: string; coverageUsdc: string; txHash: string }
  | { ok: false; error: string };

function getSigner(): ethers.Wallet | null {
  const privateKey = import.meta.env.VITE_BUYER_PRIVATE_KEY as string | undefined;
  const rpcUrl = import.meta.env.VITE_RPC_URL as string | undefined;
  if (!privateKey || !rpcUrl) return null;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(privateKey, provider);
}

export async function hasActivePolicy(): Promise<boolean> {
  try {
    const signer = getSigner();
    if (!signer) return false;
    const contract = new ethers.Contract(BLINK_CONTRACT_ADDRESS, BLINK_CONTRACT_ABI, signer);
    const policy = await contract.policies(await signer.getAddress());
    return Boolean(policy.active);
  } catch {
    return false;
  }
}

export async function buyInsurance(
  coverageMicroUsdc: bigint,
): Promise<BuyInsuranceResult> {
  try {
    const signer = getSigner();
    if (!signer) return { ok: false, error: 'Buyer wallet not configured' };

    const blink = new ethers.Contract(BLINK_CONTRACT_ADDRESS, BLINK_CONTRACT_ABI, signer);
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);

    const buyer = await signer.getAddress();
    const premium = coverageMicroUsdc / 10n;
    if (premium <= 0n) return { ok: false, error: 'Coverage too small' };

    const allowance: bigint = await usdc.allowance(buyer, BLINK_CONTRACT_ADDRESS);
    if (allowance < premium) {
      // Approve MaxUint256 once so subsequent policy buys are a single tx
      // instead of two sequential txs. On Arc testnet this roughly halves the
      // perceived latency on every buy after the first.
      const approveTx = await usdc.approve(BLINK_CONTRACT_ADDRESS, ethers.MaxUint256);
      await approveTx.wait();
    }

    const tx = await blink.buyInsurance(coverageMicroUsdc);
    const receipt = await tx.wait();

    return {
      ok: true,
      premiumUsdc: ethers.formatUnits(premium, 6),
      coverageUsdc: ethers.formatUnits(coverageMicroUsdc, 6),
      txHash: receipt?.hash ?? tx.hash ?? '',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
