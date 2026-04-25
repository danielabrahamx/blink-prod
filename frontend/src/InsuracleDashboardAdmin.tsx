import { useState, useEffect } from 'react';
import { Laptop, Wallet, AlertCircle, CheckCircle, ArrowLeft, RefreshCw, Shield, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import {
  DEMO_MODE,
  simulateAdminStatus,
  simulateAdminBalance,
  simulateDepositReserve,
  simulateTriggerClaim,
} from './lib/simulationClient';

const API_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

interface BlinkReserveDashboardProps {
  setUserType?: (userType: string | null) => void;
}

export default function InsuracleDashboardAdmin({ setUserType }: BlinkReserveDashboardProps) {
  const [transactionStatus, setTransactionStatus] = useState('');

  // Admin wallet (Circle dev wallet, fetched from backend)
  const [adminAddress, setAdminAddress] = useState<string>('');
  const [adminUsdcBalance, setAdminUsdcBalance] = useState<string>('0');
  const [adminUsycBalance, setAdminUsycBalance] = useState<string>('0');

  // Live premium counter (from backend /api/health — updates per x402 tick)
  const [serverPremiumsUsdc, setServerPremiumsUsdc] = useState<number | null>(null);
  const [recentTxs, setRecentTxs] = useState<Array<{
    timestamp: string;
    path: string;
    premiumMicroUsdc: number;
    txPayer?: string;
    txHash?: string;
  }>>([]);

  // Contract state
  const [contractUsdcPool, setContractUsdcPool] = useState<string>('0');
  const [contractUsycReserve, setContractUsycReserve] = useState<string>('0');

  // Reserve deposit
  const [reserveAmount, setReserveAmount] = useState<string>('');
  const [reserveLoading, setReserveLoading] = useState(false);

  // Claim trigger
  const [claimRecipient, setClaimRecipient] = useState<string>('');
  const [claimAmount, setClaimAmount] = useState<string>('');
  const [claimLoading, setClaimLoading] = useState(false);

  // Loading state
  const [isLoading, setIsLoading] = useState(true);

  // --- Fetch all data from backend ---
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const statusData = DEMO_MODE
        ? await simulateAdminStatus()
        : (await axios.get(`${API_BASE}/api/status`)).data;
      const { sellerAddress, contractUsdcPool: pool, contractUsycReserve: reserve } = statusData;

      if (sellerAddress) {
        setAdminAddress(sellerAddress);
      }
      setContractUsdcPool(pool || '0');
      setContractUsycReserve(reserve || '0');

      if (sellerAddress) {
        const balData = DEMO_MODE
          ? await simulateAdminBalance(sellerAddress)
          : (await axios.get(`${API_BASE}/api/balance/${sellerAddress}`)).data;
        setAdminUsdcBalance(balData.usdc || '0');
        setAdminUsycBalance(balData.usyc || '0');
      }
    } catch (e) {
      console.error('Failed to fetch admin data:', e);
      setTransactionStatus(
        DEMO_MODE
          ? 'Demo admin state failed to initialise - reload the tab'
          : 'Failed to load admin data - is the backend running?'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Live premium feed: poll /api/health every 3s so the admin sees the
  // in-memory counter update on every accepted x402 payment, well before
  // the on-chain seller-wallet balance settles. Skip in demo mode (no
  // backend) and on transient network errors.
  const fetchHealth = async () => {
    if (DEMO_MODE) return;
    try {
      const { data } = await axios.get(`${API_BASE}/api/health`);
      if (typeof data?.totalPremiumsUsdc === 'number') {
        setServerPremiumsUsdc(data.totalPremiumsUsdc);
      }
      if (Array.isArray(data?.lastTxs)) {
        setRecentTxs(data.lastTxs.slice(-100).reverse());
      }
    } catch {
      // Stay silent — fetchData() already surfaces a backend-down error.
    }
  };

  useEffect(() => {
    fetchData();
    fetchHealth();
    if (DEMO_MODE) return;
    const healthId = window.setInterval(fetchHealth, 3000);
    const balanceId = window.setInterval(fetchData, 8000);
    return () => {
      window.clearInterval(healthId);
      window.clearInterval(balanceId);
    };
  }, []);

  // --- Deposit USYC to reserve ---
  const handleDepositReserve = async () => {
    const amount = parseFloat(reserveAmount);
    if (!amount || amount <= 0) return;
    setReserveLoading(true);
    try {
      const data = DEMO_MODE
        ? await simulateDepositReserve(amount)
        : (await axios.post(`${API_BASE}/api/admin/deposit-reserve`, { amountUsyc: amount })).data;
      if (data.success) {
        setTransactionStatus(`Deposited ${amount} USYC to reserve. Tx: ${data.txId}`);
        setReserveAmount('');
        setTimeout(() => fetchData(), DEMO_MODE ? 600 : 4000);
      }
    } catch (e: any) {
      setTransactionStatus(`Deposit failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setReserveLoading(false);
      setTimeout(() => setTransactionStatus(''), 10000);
    }
  };

  // --- Trigger claim payout ---
  const handleTriggerClaim = async () => {
    if (!claimRecipient || !claimAmount) return;
    setClaimLoading(true);
    try {
      const amountUsdc = parseFloat(claimAmount);
      const data = DEMO_MODE
        ? await simulateTriggerClaim(claimRecipient, amountUsdc)
        : (await axios.post(`${API_BASE}/api/admin/trigger-claim`, {
            recipientAddress: claimRecipient,
            amountUsdc,
          })).data;
      if (data.success) {
        setTransactionStatus(`Claim triggered! ${claimAmount} USDC sent to ${claimRecipient.slice(0, 10)}... Tx: ${data.txId}`);
        setClaimRecipient('');
        setClaimAmount('');
        setTimeout(() => fetchData(), DEMO_MODE ? 600 : 4000);
      }
    } catch (e: any) {
      setTransactionStatus(`Claim failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setClaimLoading(false);
      setTimeout(() => setTransactionStatus(''), 10000);
    }
  };

  const roleStatuses = [
    { name: 'Admin', status: true },
    { name: 'Insurance Admin', status: true },
    { name: 'Reserve Manager', status: true }
  ];

  return (
    <div className="min-h-screen bg-[#080808] text-[#f0f0f0]">

      {/* Top bar */}
      <div className="border-b border-[#1a1a1a] px-6 py-4 flex items-center justify-between">
        <button
          onClick={() => setUserType && setUserType(null)}
          className="flex items-center gap-2 text-[#666666] hover:text-[#f0f0f0] text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </button>

        <div className="flex items-center gap-3">
          <span className="font-bebas text-xl tracking-widest text-[#f0f0f0]">BLINK</span>
          <span className="text-[#333333]">·</span>
          <span className="text-[#666666] text-sm">Admin Portal</span>
          <span className="font-dm-mono text-xs border border-[#e8a020]/50 text-[#e8a020] px-2 py-0.5 uppercase tracking-widest">
            Admin
          </span>
          {DEMO_MODE && (
            <span className="font-dm-mono text-[10px] border border-[#2a2a2a] text-[#888888] px-2 py-0.5 uppercase tracking-widest">
              Demo · simulated
            </span>
          )}
        </div>

        <button
          onClick={fetchData}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-[#555555] hover:text-[#f0f0f0] text-xs transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span className="uppercase tracking-widest">Refresh</span>
        </button>
      </div>

      {/* Main */}
      <div className="max-w-xl mx-auto px-6 py-8 space-y-3">

        {/* Live premium pool (Circle Dev Wallet) */}
        <div className="bg-[#0e0e0e] border border-[#1a1a1a]">
          <div className="px-6 py-4 border-b border-[#1a1a1a] flex items-center gap-2">
            <Wallet className="h-3.5 w-3.5 text-[#e8a020]" />
            <span className="text-xs uppercase tracking-widest text-[#e8a020]">Live premium pool</span>
          </div>
          <div className="p-6">
            <p className="text-xs text-[#555555] leading-relaxed mb-4">
              Every customer premium lands here via x402 micropayments. Sweep
              the USDC to the on-contract reserve below when it accumulates.
            </p>
            <div className="bg-[#141414] border border-[#1e1e1e] p-4 mb-4">
              <div className="text-xs text-[#444444] uppercase tracking-widest mb-2">Pool address (Circle DCV)</div>
              <p className="font-dm-mono text-sm text-[#cccccc] break-all leading-relaxed">
                {isLoading ? (
                  <span className="text-[#333333]">Loading...</span>
                ) : (
                  adminAddress || 'Not configured'
                )}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#141414] border border-[#1e1e1e] px-4 py-3">
                <div className="text-xs text-[#444444] uppercase tracking-widest mb-1">Collected premiums</div>
                <div className="font-dm-mono text-lg text-[#e8a020]">
                  {(serverPremiumsUsdc ?? parseFloat(adminUsdcBalance)).toFixed(6)}
                  <span className="text-[#555555] text-xs ml-1">USDC</span>
                </div>
                <div className="text-[10px] text-[#444444] mt-1 font-dm-mono">
                  on-chain: {parseFloat(adminUsdcBalance).toFixed(6)} USDC
                </div>
              </div>
              <div className="bg-[#141414] border border-[#1e1e1e] px-4 py-3">
                <div className="text-xs text-[#444444] uppercase tracking-widest mb-1">USYC on hand</div>
                <div className="font-dm-mono text-lg text-[#f0f0f0]">
                  {parseFloat(adminUsycBalance).toFixed(4)}
                  <span className="text-[#555555] text-xs ml-1">USYC</span>
                </div>
              </div>
            </div>

            {!DEMO_MODE && recentTxs.length > 0 && (
              <div className="mt-4 border border-[#1a1a1a] bg-[#080808]">
                <div className="px-3 py-2 border-b border-[#1a1a1a] flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-[#666666]">
                    Recent x402 receipts
                  </span>
                  <span className="text-[10px] font-dm-mono text-[#444444]">
                    {recentTxs.length} total
                  </span>
                </div>
                <ul
                  className="divide-y divide-[#1a1a1a] overflow-y-auto"
                  style={{ maxHeight: 180 }}
                  data-testid="admin-recent-receipts"
                >
                  {recentTxs.slice(0, 20).map((tx, i) => (
                    <li
                      key={`${tx.txHash || tx.timestamp}-${i}`}
                      className="px-3 py-1.5 flex items-center gap-2 text-[11px] font-dm-mono"
                    >
                      <span className="text-[#555555] tabular-nums w-14 truncate">
                        {new Date(tx.timestamp).toLocaleTimeString([], { hour12: false })}
                      </span>
                      <span className="text-[#888888] truncate flex-1">
                        {tx.path?.replace('/api/insure/', '') || '—'}
                      </span>
                      <span className="text-[#e8a020] tabular-nums">
                        +{tx.premiumMicroUsdc} µUSDC
                      </span>
                      <span className="text-[#444444] tabular-nums w-20 truncate text-right">
                        {tx.txHash ? `${tx.txHash.slice(0, 6)}…${tx.txHash.slice(-4)}` : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Reserve Pool */}
        <div className="bg-[#0e0e0e] border border-[#1a1a1a]">
          <div className="px-6 py-4 border-b border-[#1a1a1a] flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-[#666666]" />
            <span className="text-xs uppercase tracking-widest text-[#666666]">Reserve Pool</span>
          </div>
          <div className="p-6">
            <p className="text-xs text-[#555555] leading-relaxed mb-3">
              Reserve backing held by the Blink contract. Funded with USYC
              via the deposit below; the USDC pool fills when premiums are
              swept from the live pool above.
            </p>
            <div className="bg-[#141414] border border-[#1e1e1e] divide-y divide-[#1e1e1e] mb-4">
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-[#555555]">USDC on contract</span>
                <span className="font-dm-mono text-[#f0f0f0]">{parseFloat(contractUsdcPool).toFixed(6)} USDC</span>
              </div>
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-[#555555]">USYC reserve</span>
                <span className="font-dm-mono text-[#e8a020]">{parseFloat(contractUsycReserve).toFixed(6)} USYC</span>
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="number"
                placeholder="USYC amount"
                value={reserveAmount}
                onChange={e => setReserveAmount(e.target.value)}
                className="flex-1 bg-[#141414] border border-[#1e1e1e] focus:border-[#e8a020] text-[#f0f0f0] font-dm-mono px-4 py-3 text-sm outline-none transition-colors"
                min="0"
              />
              <button
                onClick={handleDepositReserve}
                disabled={reserveLoading || !reserveAmount}
                className="bg-[#e8a020] hover:bg-[#d49018] disabled:bg-[#1e1e1e] disabled:text-[#444444] text-[#080808] font-bold px-5 text-xs uppercase tracking-widest transition-colors whitespace-nowrap"
              >
                {reserveLoading ? 'Depositing...' : 'Deposit USYC'}
              </button>
            </div>
          </div>
        </div>

        {/* Trigger Claim */}
        <div className="bg-[#0e0e0e] border border-[#3a1a1a]">
          <div className="px-6 py-4 border-b border-[#3a1a1a] flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
            <span className="text-xs uppercase tracking-widest text-red-500/70">Trigger Claim Payout</span>
          </div>
          <div className="p-6 space-y-3">
            <p className="text-xs text-[#555555] leading-relaxed">
              Sends USDC from the reserve pool to a user's wallet as a claim payout.
            </p>

            <input
              type="text"
              placeholder="Recipient address (0x...)"
              value={claimRecipient}
              onChange={e => setClaimRecipient(e.target.value)}
              className="w-full bg-[#141414] border border-[#1e1e1e] focus:border-red-500/50 text-[#f0f0f0] font-dm-mono px-4 py-3 text-sm outline-none transition-colors"
            />

            <div className="flex gap-2">
              <input
                type="number"
                placeholder="USDC amount"
                value={claimAmount}
                onChange={e => setClaimAmount(e.target.value)}
                className="flex-1 bg-[#141414] border border-[#1e1e1e] focus:border-red-500/50 text-[#f0f0f0] font-dm-mono px-4 py-3 text-sm outline-none transition-colors"
                min="0"
                step="0.01"
              />
              <button
                onClick={handleTriggerClaim}
                disabled={claimLoading || !claimRecipient || !claimAmount}
                className="bg-red-700 hover:bg-red-600 disabled:bg-[#1e1e1e] disabled:text-[#444444] text-white font-bold px-5 text-xs uppercase tracking-widest transition-colors whitespace-nowrap"
              >
                {claimLoading ? 'Sending...' : 'Trigger Claim'}
              </button>
            </div>
          </div>
        </div>

        {/* Roles */}
        <div className="bg-[#0e0e0e] border border-[#1a1a1a]">
          <div className="px-6 py-4 border-b border-[#1a1a1a]">
            <span className="text-xs uppercase tracking-widest text-[#666666]">Role Assignments</span>
          </div>
          <div className="divide-y divide-[#141414]">
            {roleStatuses.map((role, index) => (
              <div key={index} className="flex items-center justify-between px-6 py-4">
                <span className="text-sm text-[#888888]">{role.name}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${role.status ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className={`font-dm-mono text-xs ${role.status ? 'text-green-500' : 'text-red-500'}`}>
                    {role.status ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Status message */}
        {transactionStatus && (
          <div className={`flex items-start gap-3 p-4 border ${
            transactionStatus.includes('Deposited') || transactionStatus.includes('triggered') || transactionStatus.includes('success')
              ? 'bg-[#0a160a] border-[#1a3a1a]'
              : transactionStatus.includes('failed') || transactionStatus.includes('Failed')
              ? 'bg-[#160a0a] border-[#3a1a1a]'
              : 'bg-[#0a0a16] border-[#1a1a3a]'
          }`}>
            {transactionStatus.includes('Deposited') || transactionStatus.includes('triggered') || transactionStatus.includes('success') ? (
              <CheckCircle className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            )}
            <span className="text-sm text-[#cccccc] leading-relaxed break-all">{transactionStatus}</span>
          </div>
        )}

        {/* Footer note */}
        <div className="text-center pt-4 pb-2">
          <p className="text-xs text-[#2a2a2a] font-dm-mono uppercase tracking-widest">
            x402 · Arc Testnet · Circle Gateway
          </p>
        </div>

      </div>
    </div>
  );
}
