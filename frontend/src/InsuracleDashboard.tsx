import { useState, useEffect, useRef, useCallback } from 'react';
import { Laptop, Shield, Wallet, AlertCircle, CheckCircle, ArrowLeft, Power, Copy } from 'lucide-react';
import { getGatewayClient } from './lib/gatewayClient';
import { DEMO_MODE, DEMO_LIMIT_SECONDS } from './lib/simulationClient';
import type { Balances, PayResult } from '@circlefin/x402-batching/client';

const API_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

// Internal rate constants - NOT shown in UI
const ACTIVE_RATE = 0.000005;
const IDLE_RATE = 0.00001;

interface PaymentReceipt {
  second: number;
  mode: string;
  amount: string;
  transaction: string;
  timestamp: string;
}

interface InsuracleDashboardProps {
  setUserType?: (userType: string | null) => void;
}

export default function InsuracleDashboard({ setUserType }: InsuracleDashboardProps) {
  // Gateway state
  const [balances, setBalances] = useState<Balances | null>(null);
  const [displayBalance, setDisplayBalance] = useState<string>('0.000000');
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);

  // Policy configuration (user-entered)
  const [coverageAmount, setCoverageAmount] = useState<string>('5');
  const [policyDuration, setPolicyDuration] = useState<string>('5');
  const [selectedMode, setSelectedMode] = useState<'active' | 'idle'>('active');

  // Policy running state
  const [isPolicyRunning, setIsPolicyRunning] = useState(false);
  const [policySeconds, setPolicySeconds] = useState(0);
  const [policyComplete, setPolicyComplete] = useState(false);
  const [paymentReceipts, setPaymentReceipts] = useState<PaymentReceipt[]>([]);

  // Deposit state
  const [isDepositing, setIsDepositing] = useState(false);

  // UI state
  const [transactionStatus, setTransactionStatus] = useState('');
  const [copiedAddress, setCopiedAddress] = useState(false);

  // Refs for timer
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const policySecondsRef = useRef(0);

  const client = getGatewayClient();

  // --- Fetch balances ---
  const fetchBalances = useCallback(async () => {
    setIsLoadingBalances(true);
    try {
      const b = await client.getBalances();
      setBalances(b);
      setDisplayBalance(b.gateway.formattedAvailable);
    } catch (e) {
      console.error('Failed to fetch balances:', e);
    } finally {
      setIsLoadingBalances(false);
    }
  }, [client]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  // --- Deposit to Gateway ---
  const handleDeposit = async () => {
    setIsDepositing(true);
    setTransactionStatus('Depositing 1 USDC to Gateway...');
    try {
      const result = await client.deposit('1');
      setTransactionStatus(`Deposited ${result.formattedAmount} USDC to Gateway!`);
      await fetchBalances();
    } catch (e: any) {
      setTransactionStatus(`Deposit failed: ${e.message || 'Unknown error'}`);
    } finally {
      setIsDepositing(false);
      setTimeout(() => setTransactionStatus(''), 8000);
    }
  };

  // --- Copy buyer address ---
  const copyAddress = () => {
    navigator.clipboard.writeText(client.address);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  // --- Start policy ---
  const startPolicy = () => {
    if (isPolicyRunning) return;
    const duration = parseInt(policyDuration);
    if (!duration || duration <= 0) return;

    setIsPolicyRunning(true);
    setPolicyComplete(false);
    setPaymentReceipts([]);

    const endpoint = selectedMode === 'active'
      ? `${API_BASE}/api/insure/active`
      : `${API_BASE}/api/insure/idle`;

    const rate = selectedMode === 'active' ? ACTIVE_RATE : IDLE_RATE;

    // Fire first payment immediately, then set counter to 1
    firePayment(endpoint, rate, 1);
    policySecondsRef.current = 1;
    setPolicySeconds(1);

    if (duration === 1) {
      setIsPolicyRunning(false);
      setPolicyComplete(true);
      fetchBalances();
      return;
    }

    timerRef.current = setInterval(() => {
      policySecondsRef.current += 1;
      const currentSecond = policySecondsRef.current;

      setPolicySeconds(currentSecond);
      firePayment(endpoint, rate, currentSecond);

      if (currentSecond >= duration) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setIsPolicyRunning(false);
        setPolicyComplete(true);
        fetchBalances();
      }
    }, 1000);
  };

  const firePayment = async (endpoint: string, rate: number, second: number) => {
    try {
      const result: PayResult = await client.pay(endpoint);
      // Optimistically decrease displayed balance
      setDisplayBalance(prev => {
        const current = parseFloat(prev);
        return (current - rate).toFixed(6);
      });
      setPaymentReceipts(prev => [...prev, {
        second,
        mode: selectedMode,
        amount: result.formattedAmount,
        transaction: result.transaction,
        timestamp: new Date().toISOString(),
      }]);
    } catch (e: any) {
      console.error(`Payment ${second} failed:`, e.message);
      setTransactionStatus(`Payment #${second} failed: ${e.message}`);
    }
  };

  // --- Reset for new policy ---
  const resetPolicy = () => {
    setPolicyComplete(false);
    setPolicySeconds(0);
    setPaymentReceipts([]);
    fetchBalances();
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // --- Derived state ---
  const buyerAddress = client.address;
  const duration = parseInt(policyDuration) || 0;
  const rate = selectedMode === 'active' ? ACTIVE_RATE : IDLE_RATE;
  const estimatedCost = (rate * duration).toFixed(6);
  const progressPct = duration > 0 ? (policySeconds / duration) * 100 : 0;

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
          <span className="text-[#666666] text-sm">Laptop Micro-Insurance</span>
          {DEMO_MODE && (
            <span className="font-dm-mono text-[10px] border border-[#2a2a2a] text-[#888888] px-2 py-0.5 uppercase tracking-widest">
              Demo · simulated
            </span>
          )}
        </div>

        <div className="font-dm-mono text-sm text-[#e8a020]">
          {isLoadingBalances ? (
            <span className="text-[#444444]">···</span>
          ) : (
            `${displayBalance} USDC`
          )}
        </div>
      </div>

      {/* Main */}
      <div className="max-w-xl mx-auto px-6 py-8 space-y-3">

        {/* Wallet card */}
        <div className="bg-[#0e0e0e] border border-[#1a1a1a]">
          <div className="px-6 py-4 border-b border-[#1a1a1a] flex items-center gap-2">
            <Wallet className="h-3.5 w-3.5 text-[#666666]" />
            <span className="text-xs uppercase tracking-widest text-[#666666]">Gateway Wallet</span>
          </div>
          <div className="p-6">
            {/* Address row */}
            <div className="bg-[#141414] border border-[#1e1e1e] p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#444444] uppercase tracking-widest">Buyer Address</span>
                <button
                  onClick={copyAddress}
                  className="p-1 text-[#444444] hover:text-[#f0f0f0] transition-colors"
                  title="Copy address"
                >
                  {copiedAddress
                    ? <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    : <Copy className="h-3.5 w-3.5" />
                  }
                </button>
              </div>
              <p className="font-dm-mono text-sm text-[#cccccc] break-all leading-relaxed">{buyerAddress}</p>
              {balances && (
                <div className="mt-3 pt-3 border-t border-[#1e1e1e] flex gap-6 font-dm-mono text-xs">
                  <span className="text-[#555555]">
                    Wallet <span className="text-[#888888] ml-1">{balances.wallet.formatted} USDC</span>
                  </span>
                  <span className="text-[#555555]">
                    Gateway <span className="text-[#e8a020] ml-1">{balances.gateway.formattedAvailable} USDC</span>
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={handleDeposit}
              disabled={isDepositing}
              className="w-full bg-[#e8a020] hover:bg-[#d49018] disabled:bg-[#1e1e1e] disabled:text-[#444444] text-[#080808] font-bold py-3 text-xs uppercase tracking-widest transition-colors"
            >
              {isDepositing ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3 h-3 border border-[#080808]/40 border-t-[#080808] rounded-full animate-spin" />
                  Depositing...
                </span>
              ) : (
                'Deposit 1 USDC to Gateway'
              )}
            </button>
          </div>
        </div>

        {/* Policy configuration */}
        {!isPolicyRunning && !policyComplete && (
          <div className="bg-[#0e0e0e] border border-[#1a1a1a]">
            <div className="px-6 py-4 border-b border-[#1a1a1a] flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-[#666666]" />
              <span className="text-xs uppercase tracking-widest text-[#666666]">Configure Policy</span>
            </div>
            <div className="p-6 space-y-5">

              {/* Duration */}
              <div>
                <label className="block text-xs uppercase tracking-widest text-[#555555] mb-2">
                  Duration (seconds)
                </label>
                <input
                  type="number"
                  value={policyDuration}
                  onChange={e => setPolicyDuration(e.target.value)}
                  placeholder="5"
                  min="1"
                  max={DEMO_MODE ? DEMO_LIMIT_SECONDS : undefined}
                  className="w-full bg-[#141414] border border-[#1e1e1e] focus:border-[#e8a020] text-[#f0f0f0] font-dm-mono px-4 py-3 text-sm outline-none transition-colors"
                />
                {DEMO_MODE && (
                  <p className="text-[10px] uppercase tracking-widest text-[#444444] mt-2 font-dm-mono">
                    Demo session capped at {DEMO_LIMIT_SECONDS}s · payments simulated
                  </p>
                )}
              </div>

              {/* Coverage amount */}
              <div>
                <label className="block text-xs uppercase tracking-widest text-[#555555] mb-2">
                  Coverage Amount (USDC)
                </label>
                <input
                  type="number"
                  value={coverageAmount}
                  onChange={e => setCoverageAmount(e.target.value)}
                  placeholder="5"
                  min="1"
                  className="w-full bg-[#141414] border border-[#1e1e1e] focus:border-[#e8a020] text-[#f0f0f0] font-dm-mono px-4 py-3 text-sm outline-none transition-colors"
                />
              </div>

              {/* Mode */}
              <div>
                <label className="block text-xs uppercase tracking-widest text-[#555555] mb-2">
                  Coverage Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSelectedMode('active')}
                    className={`flex items-center gap-2.5 p-4 border text-left transition-colors ${
                      selectedMode === 'active'
                        ? 'border-[#e8a020] bg-[#141414] text-[#f0f0f0]'
                        : 'border-[#1e1e1e] text-[#555555] hover:border-[#2a2a2a] hover:text-[#888888]'
                    }`}
                  >
                    <Laptop className="h-4 w-4 shrink-0" />
                    <div>
                      <div className="text-sm font-medium">At Desk</div>
                    </div>
                  </button>
                  <button
                    onClick={() => setSelectedMode('idle')}
                    className={`flex items-center gap-2.5 p-4 border text-left transition-colors ${
                      selectedMode === 'idle'
                        ? 'border-[#e8a020] bg-[#141414] text-[#f0f0f0]'
                        : 'border-[#1e1e1e] text-[#555555] hover:border-[#2a2a2a] hover:text-[#888888]'
                    }`}
                  >
                    <Power className="h-4 w-4 shrink-0" />
                    <div>
                      <div className="text-sm font-medium">Away</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Summary */}
              <div className="bg-[#141414] border border-[#1e1e1e] divide-y divide-[#1e1e1e]">
                <div className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-[#555555]">Coverage</span>
                  <span className="font-dm-mono text-[#cccccc]">{coverageAmount || '0'} USDC</span>
                </div>
                <div className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-[#555555]">Duration</span>
                  <span className="font-dm-mono text-[#cccccc]">{duration}s</span>
                </div>
                <div className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-[#555555]">Mode</span>
                  <span className="font-dm-mono text-[#cccccc]">{selectedMode === 'active' ? 'At Desk' : 'Away'}</span>
                </div>
                <div className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-[#666666]">Premium</span>
                  <span className="font-dm-mono text-[#e8a020] font-medium">{estimatedCost} USDC</span>
                </div>
              </div>

              <button
                onClick={startPolicy}
                disabled={!duration || duration <= 0}
                className="w-full bg-[#e8a020] hover:bg-[#d49018] disabled:bg-[#1e1e1e] disabled:text-[#444444] text-[#080808] font-bold py-4 text-xs uppercase tracking-widest transition-colors"
              >
                Start Policy
              </button>
            </div>
          </div>
        )}

        {/* Running / complete view */}
        {(isPolicyRunning || policyComplete) && (
          <div className="bg-[#0e0e0e] border border-[#1a1a1a]">
            <div className="px-6 py-4 border-b border-[#1a1a1a] flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-[#666666]" />
              <span className="text-xs uppercase tracking-widest text-[#666666]">
                {isPolicyRunning ? 'Policy Active' : 'Policy Complete'}
              </span>
              {isPolicyRunning && (
                <span className="w-2 h-2 rounded-full bg-[#e8a020] blink-pulse ml-auto" />
              )}
            </div>

            <div className="p-6">
              {/* Big timer */}
              <div className="text-center py-10 mb-4 border border-[#1a1a1a] bg-[#090909]">
                <div className="font-dm-mono leading-none">
                  <span className="text-[clamp(64px,12vw,96px)] text-[#e8a020]">{policySeconds}</span>
                  <span className="text-[clamp(40px,7vw,64px)] text-[#2a2a2a]">/</span>
                  <span className="text-[clamp(64px,12vw,96px)] text-[#333333]">{duration}</span>
                  <span className="text-2xl text-[#2a2a2a] ml-1">s</span>
                </div>
                <div className="text-xs uppercase tracking-widest text-[#444444] mt-3 font-dm-mono">
                  {selectedMode === 'active' ? 'at desk' : 'away'} mode · ${rate}/s
                </div>
              </div>

              {/* Thin progress bar */}
              <div className="w-full bg-[#141414] h-0.5 mb-6">
                <div
                  className="bg-[#e8a020] h-0.5 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {/* Balance */}
              <div className="text-center mb-6">
                <div className="font-dm-mono text-3xl text-[#f0f0f0]">
                  {displayBalance}
                  <span className="text-[#444444] text-lg ml-2">USDC</span>
                </div>
                <div className="text-xs text-[#444444] mt-1 uppercase tracking-widest">Gateway balance</div>
              </div>

              {policyComplete && (
                <div className="space-y-3">
                  <div className="bg-[#0a160a] border border-[#1a3a1a] px-4 py-3">
                    <p className="text-green-400 text-sm font-medium">Policy complete</p>
                    <p className="text-[#555555] text-xs mt-1 font-dm-mono">
                      {paymentReceipts.length} payments · {duration}s · {selectedMode === 'active' ? 'at desk' : 'away'}
                    </p>
                  </div>
                  <button
                    onClick={resetPolicy}
                    className="w-full border border-[#2a2a2a] hover:border-[#444444] text-[#888888] hover:text-[#f0f0f0] font-bold py-3 text-xs uppercase tracking-widest transition-colors"
                  >
                    New Policy
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Payment receipts */}
        {paymentReceipts.length > 0 && (
          <div className="bg-[#0e0e0e] border border-[#1a1a1a]">
            <div className="px-6 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-[#666666]">Payment Receipts</span>
              <span className="font-dm-mono text-xs text-[#444444]">{paymentReceipts.length} tx</span>
            </div>
            <div className="max-h-52 overflow-y-auto divide-y divide-[#141414]">
              {paymentReceipts.map((receipt, i) => (
                <div key={i} className="flex items-center justify-between px-6 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="font-dm-mono text-[#444444] w-7 text-xs">#{receipt.second}</span>
                    <span className="font-dm-mono text-[#cccccc]">{receipt.amount} USDC</span>
                    <span className={`text-xs border px-1.5 py-0.5 font-dm-mono ${
                      receipt.mode === 'active'
                        ? 'border-[#e8a020]/30 text-[#e8a020]'
                        : 'border-[#555555]/30 text-[#555555]'
                    }`}>
                      {receipt.mode === 'active' ? 'at desk' : 'away'}
                    </span>
                  </div>
                  <span className="font-dm-mono text-xs text-[#333333] truncate max-w-[120px]">
                    {receipt.transaction?.slice(0, 10)}...
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status message */}
        {transactionStatus && (
          <div className={`flex items-start gap-3 p-4 border ${
            transactionStatus.includes('Deposited') || transactionStatus.includes('success')
              ? 'bg-[#0a160a] border-[#1a3a1a]'
              : transactionStatus.includes('failed') || transactionStatus.includes('Error')
              ? 'bg-[#160a0a] border-[#3a1a1a]'
              : 'bg-[#0a0a16] border-[#1a1a3a]'
          }`}>
            {transactionStatus.includes('Deposited') || transactionStatus.includes('success') ? (
              <CheckCircle className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            )}
            <span className="text-sm text-[#cccccc] leading-relaxed">{transactionStatus}</span>
          </div>
        )}

        {/* Footer note */}
        <div className="text-center pt-4 pb-2">
          <p className="text-xs text-[#2a2a2a] font-dm-mono uppercase tracking-widest">
            {DEMO_MODE ? 'x402 · Simulated Demo · Arc Testnet' : 'x402 · Arc Testnet · Circle Gateway'}
          </p>
        </div>

      </div>
    </div>
  );
}
