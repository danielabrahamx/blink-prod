import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ethers } from 'ethers';
import {
  Plug,
  Unplug,
  Play,
  Square,
  ArrowLeft,
  Copy,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { hasPassedGate } from '@/lib/emailGate';
import { useBattery } from '@/lib/battery';
import {
  BASE_RATE_MICRO_USDC_PER_SEC,
  BATTERY_MULTIPLIER_UNPLUGGED,
  scoreV2,
} from '@/lib/rulebookV2';
import { getGatewayClient, type PayResult } from '@/lib/gatewayClient';
import { buyInsurance as blinkBuyInsurance } from '@/lib/blinkContract';
import { MultiplierDial } from '@/components/MultiplierDial';
import { LiveTicker } from '@/components/LiveTicker';
import {
  SessionSummary,
  type SecondsByState,
  type SessionResult,
} from '@/components/SessionSummary';

const SESSION_DURATION_SECONDS = 60;

const ENDPOINT_CHARGING = '/api/insure/charging';
const ENDPOINT_BATTERY = '/api/insure/battery';

function endpointFor(charging: boolean): string {
  return charging ? ENDPOINT_CHARGING : ENDPOINT_BATTERY;
}

function priceFor(endpoint: string): number {
  if (endpoint === ENDPOINT_BATTERY) {
    return BASE_RATE_MICRO_USDC_PER_SEC * BATTERY_MULTIPLIER_UNPLUGGED;
  }
  return BASE_RATE_MICRO_USDC_PER_SEC;
}

// ---- Wallet-panel helpers -------------------------------------------------

const USDC_PRECOMPILE = '0x3600000000000000000000000000000000000000';
const ARC_RPC_FALLBACK = 'https://rpc.arc-testnet.circle.com';
// ERC-20 balanceOf(address) selector: keccak256("balanceOf(address)")[:4]
const BALANCE_OF_SELECTOR = '0x70a08231';

interface TxReceipt {
  ts: string;
  endpoint: string;
  microUsdc: number;
  id: string;
}

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortenId(id: string): string {
  if (!id) return '';
  if (id.length <= 11) return id;
  return `${id.slice(0, 10)}…`;
}

function hhmmss(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function deriveBuyerAddress(): string {
  const pk = import.meta.env.VITE_BUYER_PRIVATE_KEY as string | undefined;
  if (!pk) return '';
  try {
    return new ethers.Wallet(pk).address;
  } catch {
    return '';
  }
}

function endpointLabel(endpoint: string): string {
  // "/api/insure/charging" -> "charging"
  const parts = endpoint.split('/');
  return parts[parts.length - 1] || endpoint;
}

function formatDuration(seconds: number): string {
  const totalHours = Math.max(1, Math.round(seconds / 3600));
  if (totalHours < 24) return `${totalHours} hour${totalHours === 1 ? '' : 's'}`;
  const days = Math.floor(totalHours / 24);
  const remH = totalHours % 24;
  if (remH === 0) return `${days} day${days === 1 ? '' : 's'}`;
  return `${days}d ${remH}h`;
}

const POLICY_MIN_HOURS = 1;
const POLICY_MAX_HOURS = 30 * 24;

async function fetchBuyerUsdcBalance(
  rpcUrl: string,
  buyer: string,
): Promise<bigint | null> {
  if (!buyer) return null;
  try {
    const data =
      BALANCE_OF_SELECTOR + buyer.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: USDC_PRECOMPILE, data }, 'latest'],
    };
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: string; error?: unknown };
    if (!json.result || typeof json.result !== 'string') return null;
    return BigInt(json.result);
  } catch {
    return null;
  }
}

function formatUsdc6(raw: bigint | null): string {
  if (raw === null) return '—';
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0');
  return `${neg ? '-' : ''}${whole.toString()}.${frac}`;
}

interface SettleResponse {
  txId?: string;
  ok?: boolean;
  [key: string]: unknown;
}

async function settleSession(
  totalMicroUsdc: number,
  state: SecondsByState,
  txHashes: string[],
): Promise<SettleResponse> {
  const base =
    (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
    'http://localhost:3001';
  const res = await fetch(`${base}/api/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalMicroUsdc, state, txHashes }),
  });
  return (await res.json()) as SettleResponse;
}

export default function LiveDemo() {
  const navigate = useNavigate();
  const battery = useBattery();

  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [totalMicroUsdc, setTotalMicroUsdc] = useState(0);
  const [secondsByState, setSecondsByState] = useState<SecondsByState>({
    plugged: 0,
    unplugged: 0,
  });
  const [result, setResult] = useState<SessionResult | null>(null);

  // Wallet-visibility panel state
  const buyerAddress = useMemo(() => deriveBuyerAddress(), []);
  const sellerAddress = (import.meta.env.VITE_SELLER_ADDRESS as string | undefined) ?? '';
  const rpcUrl =
    (import.meta.env.VITE_RPC_URL as string | undefined) ?? ARC_RPC_FALLBACK;
  const [buyerBalance, setBuyerBalance] = useState<bigint | null>(null);
  const [txReceipts, setTxReceipts] = useState<TxReceipt[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [gatewayAvailableUsdc, setGatewayAvailableUsdc] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState<string>('1');
  const [depositing, setDepositing] = useState(false);
  const [depositStatus, setDepositStatus] = useState<string>('');
  const [policyDurationSeconds, setPolicyDurationSeconds] = useState<number>(24 * 3600);
  const [policyRemainingSeconds, setPolicyRemainingSeconds] = useState<number>(24 * 3600);
  const [laptopValueUsd, setLaptopValueUsd] = useState<string>('1500');
  const [policyPurchasing, setPolicyPurchasing] = useState(false);
  const [policyPurchaseStatus, setPolicyPurchaseStatus] = useState<string>('');
  const [policyPurchaseTxHash, setPolicyPurchaseTxHash] = useState<string>('');
  const [lastDepositTxHash, setLastDepositTxHash] = useState<string>('');

  const refreshGatewayBalance = useCallback(async () => {
    try {
      const client = getGatewayClient();
      const b = await client.getBalances();
      setGatewayAvailableUsdc(b.gatewayAvailableUsdc);
    } catch {
      setGatewayAvailableUsdc(null);
    }
  }, []);

  const handleDeposit = useCallback(async () => {
    const amt = depositAmount.trim();
    if (!amt || Number(amt) <= 0) {
      setDepositStatus('Enter an amount greater than 0');
      return;
    }
    setDepositing(true);
    setDepositStatus(`Depositing ${amt} USDC to Gateway...`);
    setLastDepositTxHash('');
    try {
      const client = getGatewayClient();
      const result = await client.deposit(amt);
      if (result.ok) {
        setLastDepositTxHash(result.txHash);
        setDepositStatus(`Deposited ${result.formattedAmount} USDC to Gateway.`);
        await refreshGatewayBalance();
      } else {
        setDepositStatus(`Deposit failed: ${result.error}`);
      }
    } catch (e) {
      setDepositStatus(`Deposit failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDepositing(false);
      setTimeout(() => setDepositStatus(''), 10000);
    }
  }, [depositAmount, refreshGatewayBalance]);

  useEffect(() => {
    void refreshGatewayBalance();
    const id = setInterval(() => { void refreshGatewayBalance(); }, 10000);
    return () => clearInterval(id);
  }, [refreshGatewayBalance]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const totalRef = useRef(0);
  const stateRef = useRef<SecondsByState>({ plugged: 0, unplugged: 0 });
  const txHashesRef = useRef<string[]>([]);
  // Live-signal ref: the interval reads this every tick, so mid-session
  // charger toggles always feed the scorer (a closure would capture stale
  // values at setInterval time).
  const chargingRef = useRef<boolean | null>(null);

  useEffect(() => {
    chargingRef.current = battery.charging;
  }, [battery.charging]);

  useEffect(() => {
    if (!hasPassedGate()) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  const score = useMemo(
    () => scoreV2({ charging: battery.charging ?? undefined }),
    [battery.charging],
  );
  const currentRate = score.microUsdcPerSec;
  const currentMultiplier = score.multiplier;

  const endSession = useCallback(
    async (finalTotal: number, state: SecondsByState) => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      let txId = '';
      try {
        const settlement = await settleSession(
          finalTotal,
          state,
          [...txHashesRef.current],
        );
        txId = typeof settlement.txId === 'string' ? settlement.txId : '';
      } catch (err) {
        // Swallow settlement failures so the UI still shows the summary —
        // the per-second txHashes remain as the source of truth on-chain.
        console.error('[LiveDemo] settleSession failed', err);
      }
      setResult({
        totalMicroUsdc: finalTotal,
        secondsByState: state,
        txId,
        durationSeconds: SESSION_DURATION_SECONDS,
      });
    },
    [],
  );

  const startSession = useCallback(async () => {
    const valueUsd = Math.max(0, Number(laptopValueUsd) || 0);
    if (valueUsd <= 0) {
      setPolicyPurchaseStatus('Enter your laptop value before activating.');
      return;
    }
    // Placeholder on-chain coverage so the policy contract accepts the buy.
    // The actuarial pricing model is being designed separately — nothing
    // user-facing is derived from this.
    const coverageMicroUsdc = BigInt(Math.round(Math.max(1, valueUsd / 1000) * 1_000_000));

    setPolicyPurchasing(true);
    setPolicyPurchaseStatus('Buying policy — paying premium into the reserve pool...');
    setPolicyPurchaseTxHash('');
    const result = await blinkBuyInsurance(coverageMicroUsdc);
    setPolicyPurchasing(false);
    if (!result.ok) {
      const already = /Already has active policy/i.test(result.error);
      setPolicyPurchaseStatus(
        already
          ? 'You already have an active policy on-chain. Starting the live cover anyway.'
          : `Policy purchase failed: ${result.error}`,
      );
      if (!already) return;
    } else {
      setPolicyPurchaseTxHash(result.txHash);
      setPolicyPurchaseStatus('Policy active · cover running.');
    }

    setStarted(true);
    setElapsed(0);
    setTotalMicroUsdc(0);
    setSecondsByState({ plugged: 0, unplugged: 0 });
    totalRef.current = 0;
    stateRef.current = { plugged: 0, unplugged: 0 };
    txHashesRef.current = [];
    setTxReceipts([]);
    setPolicyRemainingSeconds(policyDurationSeconds);

    const client = getGatewayClient();

    intervalRef.current = setInterval(() => {
      // Treat unknown charging state as plugged-in (At Desk baseline) so
      // Firefox/Safari don't get penalised.
      const charging = chargingRef.current === false ? false : true;
      const endpoint = endpointFor(charging);
      const stateKey: keyof SecondsByState = charging ? 'plugged' : 'unplugged';

      // Fire-and-track: the interval tick doesn't await pay, but we chain
      // the bookkeeping onto the promise so totals only advance on
      // confirmed charges. A failed pay is logged and skipped.
      void (async () => {
        try {
          const result: PayResult = await client.pay(endpoint);
          if (!result.ok) {
            console.warn('[LiveDemo] pay failed', endpoint, result);
            return;
          }
          if (typeof result.txHash === 'string' && result.txHash) {
            txHashesRef.current = [...txHashesRef.current, result.txHash];
          }
          const charge = priceFor(endpoint);
          totalRef.current += charge;
          stateRef.current = {
            ...stateRef.current,
            [stateKey]: stateRef.current[stateKey] + 1,
          };
          setTotalMicroUsdc(totalRef.current);
          setSecondsByState({ ...stateRef.current });
          setGatewayAvailableUsdc(prev => {
            if (prev === null) return prev;
            const next = Math.max(0, Number(prev) - charge / 1_000_000);
            return next.toFixed(6);
          });
          const receiptId = result.txHash || '';
          setTxReceipts(prev => {
            const next: TxReceipt[] = [
              {
                ts: hhmmss(new Date()),
                endpoint: endpointLabel(endpoint),
                microUsdc: charge,
                id: receiptId,
              },
              ...prev,
            ];
            return next.length > 100 ? next.slice(0, 100) : next;
          });
        } catch (err) {
          console.warn('[LiveDemo] pay threw', endpoint, err);
        }
      })();

      setElapsed(prev => {
        const next = prev + 1;
        if (next >= SESSION_DURATION_SECONDS) {
          void endSession(totalRef.current, { ...stateRef.current });
        }
        return next;
      });
      setPolicyRemainingSeconds(prev => {
        const next = Math.max(0, prev - 1);
        if (next === 0 && prev > 0) {
          void endSession(totalRef.current, { ...stateRef.current });
        }
        return next;
      });
    }, 1_000);
  }, [endSession, policyDurationSeconds, laptopValueUsd]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleEarlyExit = useCallback(() => {
    void endSession(totalRef.current, { ...stateRef.current });
  }, [endSession]);

  const handleRunAgain = useCallback(() => {
    setResult(null);
    setStarted(false);
    setElapsed(0);
    setTotalMicroUsdc(0);
    setSecondsByState({ plugged: 0, unplugged: 0 });
    txHashesRef.current = [];
  }, []);

  // Poll the buyer's USDC balance every 5s while this page is mounted.
  useEffect(() => {
    if (!buyerAddress) return;
    let cancelled = false;
    const tick = async () => {
      const b = await fetchBuyerUsdcBalance(rpcUrl, buyerAddress);
      if (!cancelled) setBuyerBalance(b);
    };
    void tick();
    const id = setInterval(() => {
      void tick();
    }, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [buyerAddress, rpcUrl]);

  if (result) {
    return (
      <div className="min-h-screen bg-[#080808] text-[#f0f0f0]">
        <LiveHeader sessionActive={false} />
        <main className="max-w-xl mx-auto px-8 pt-16 pb-12">
          <SessionSummary
            result={result}
            onRunAgain={handleRunAgain}
            onBackToHome={() => navigate('/')}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] text-[#f0f0f0]">
      <LiveHeader sessionActive={started} />
      <main className="max-w-3xl mx-auto px-8 pt-12 pb-12">
        <div className="mb-6">
          <h1 className="font-bebas text-5xl tracking-wide">YOUR COVER</h1>
          <p className="text-[#888888] leading-relaxed mt-2">
            You're covered while you have funds. Plug in at your desk for the
            baseline rate; unplug and hit the road and it doubles — top up any
            time to keep the policy running.
          </p>
        </div>

        <WalletPanel
          open={panelOpen}
          onToggle={() => setPanelOpen(o => !o)}
          buyerAddress={buyerAddress}
          sellerAddress={sellerAddress}
          buyerBalance={buyerBalance}
          txReceipts={txReceipts}
          gatewayAvailableUsdc={gatewayAvailableUsdc}
          depositAmount={depositAmount}
          onDepositAmountChange={setDepositAmount}
          onDeposit={handleDeposit}
          depositing={depositing}
          depositStatus={depositStatus}
          lastDepositTxHash={lastDepositTxHash}
        />

        <LiveSignalStrip battery={battery} />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <MultiplierDial charging={battery.charging} multiplier={currentMultiplier} />
          <LiveTicker
            balanceUsdc={gatewayAvailableUsdc}
            currentRateMicroUsdc={currentRate}
            spentMicroUsdc={totalMicroUsdc}
            active={started}
            policyTotalSeconds={policyDurationSeconds}
            policyRemainingSeconds={policyRemainingSeconds}
          />
        </div>

        <div className="flex flex-wrap gap-2 mb-6" data-testid="live-pills">
          <StatusPill
            icon={battery.charging ? <Plug className="h-3 w-3" /> : <Unplug className="h-3 w-3" />}
            label={
              !battery.supported
                ? 'battery API unsupported — assuming At Desk'
                : battery.charging === null
                  ? 'battery pending…'
                  : battery.charging
                    ? 'at desk · plugged in'
                    : 'on the move · on battery'
            }
          />
          <StatusPill
            icon={<Plug className="h-3 w-3" />}
            label={`elapsed: ${elapsed}s`}
            muted
          />
        </div>

        {!started ? (
          <div className="border border-[#1e1e1e] bg-[#0e0e0e] p-4 mb-4 space-y-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-[#666666] mb-2">
                Laptop value
              </div>
              <div className="flex items-stretch gap-2">
                <span className="flex items-center px-3 bg-[#141414] border border-[#1e1e1e] text-[#888888] font-dm-mono text-sm">$</span>
                <input
                  type="number"
                  min="100"
                  step="50"
                  value={laptopValueUsd}
                  onChange={e => setLaptopValueUsd(e.target.value)}
                  className="flex-1 bg-[#141414] border border-[#1e1e1e] focus:border-[#e8a020]/60 text-[#f0f0f0] font-dm-mono px-3 py-2 text-sm outline-none transition-colors tabular-nums"
                  data-testid="laptop-value"
                  placeholder="1500"
                />
                <span className="flex items-center px-3 bg-[#141414] border border-[#1e1e1e] text-[#666666] font-dm-mono text-xs uppercase tracking-widest">USD</span>
              </div>
              <p className="text-[11px] text-[#555555] mt-2 leading-relaxed">
                Replacement cost if it's damaged, stolen, or lost.
              </p>
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-3">
                <div className="text-xs uppercase tracking-widest text-[#666666]">
                  Policy length
                </div>
                <div
                  className="font-dm-mono text-sm text-[#e8a020] tabular-nums"
                  data-testid="policy-length-display"
                >
                  {formatDuration(policyDurationSeconds)}
                </div>
              </div>
              <input
                type="range"
                min={POLICY_MIN_HOURS}
                max={POLICY_MAX_HOURS}
                step={1}
                value={Math.max(
                  POLICY_MIN_HOURS,
                  Math.min(POLICY_MAX_HOURS, Math.round(policyDurationSeconds / 3600)),
                )}
                onChange={e => {
                  const hours = Number(e.target.value);
                  const seconds = hours * 3600;
                  setPolicyDurationSeconds(seconds);
                  setPolicyRemainingSeconds(seconds);
                }}
                className="w-full accent-[#e8a020] cursor-pointer"
                data-testid="policy-length-slider"
              />
              <div className="flex justify-between text-[10px] font-dm-mono uppercase tracking-widest text-[#555555] mt-1">
                <span>1 hr</span>
                <span>30 days</span>
              </div>
            </div>

            {policyPurchaseStatus ? (
              <div className="text-[11px] text-[#888888] leading-relaxed" data-testid="policy-purchase-status">
                {policyPurchaseStatus}
              </div>
            ) : null}
            {policyPurchaseTxHash ? (
              <div className="text-[11px] font-dm-mono text-emerald-400 break-all">
                policy tx · {policyPurchaseTxHash.slice(0, 10)}…{policyPurchaseTxHash.slice(-6)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {!started ? (
            <button
              type="button"
              onClick={startSession}
              disabled={policyPurchasing}
              className="flex-1 bg-[#e8a020] text-[#080808] font-dm-mono uppercase text-sm tracking-widest py-4 hover:bg-[#f5b530] transition-colors disabled:bg-[#1a1a1a] disabled:text-[#444444] flex items-center justify-center gap-2"
              data-testid="start-session"
            >
              <Play className="h-4 w-4" />
              {policyPurchasing ? 'Buying policy...' : 'Activate cover'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleEarlyExit}
              className="flex-1 border border-[#1e1e1e] text-[#888888] font-dm-mono uppercase text-sm tracking-widest py-4 hover:border-[#666666] hover:text-[#f0f0f0] transition-colors flex items-center justify-center gap-2"
              data-testid="end-session"
            >
              <Square className="h-4 w-4" />
              Pause cover
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

function LiveHeader({ sessionActive = false }: { sessionActive?: boolean }) {
  return (
    <nav className="border-b border-[#1a1a1a] px-8 py-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Link
          to="/"
          aria-label="Back to home"
          data-testid="back-home"
          className="inline-flex items-center gap-1 text-xs uppercase tracking-widest text-[#888888] hover:text-[#f0f0f0] transition-colors font-dm-mono"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </Link>
        <span className="font-bebas text-2xl tracking-widest">BLINK</span>
      </div>
      <span className="text-xs uppercase tracking-widest text-[#666666]">
        {sessionActive ? '/live · session active' : '/live'}
      </span>
    </nav>
  );
}

function StatusPill({
  icon,
  label,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 border px-3 py-1 font-dm-mono text-xs uppercase tracking-widest ${
        muted
          ? 'border-[#1e1e1e] text-[#666666]'
          : 'border-[#e8a020]/40 text-[#e8a020]'
      }`}
    >
      {icon}
      {label}
    </span>
  );
}

/**
 * Live-signal strip above the dials so it's visible — before the session
 * even starts — that the Battery API is receiving data from the browser.
 */
function LiveSignalStrip({
  battery,
}: {
  battery: { supported: boolean; charging: boolean | null; level: number | null };
}) {
  const dotClass = !battery.supported
    ? 'bg-[#666666]'
    : battery.charging === null
      ? 'bg-[#e8a020] animate-pulse'
      : battery.charging
        ? 'bg-[#34d399]'
        : 'bg-[#888888]';

  return (
    <div
      className="border border-[#1e1e1e] bg-[#0e0e0e] px-4 py-3 mb-4 font-dm-mono text-xs"
      data-testid="live-signals"
    >
      <div className="flex items-center gap-2 uppercase tracking-widest text-[#888888]">
        <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
        Power
      </div>
      <div className="text-[#f0f0f0] mt-2">
        {!battery.supported
          ? 'battery info unavailable — defaulting to At Desk'
          : battery.charging === null
            ? 'checking…'
            : battery.charging
              ? 'at desk · plugged in'
              : 'on the move · on battery'}
      </div>
      <div className="text-[#888888]">
        {battery.level !== null
          ? `${Math.round(battery.level * 100)}% charge`
          : 'charge unknown'}
      </div>
      <div className="text-[#555555]">
        {battery.charging === false
          ? 'higher risk · rate doubled'
          : 'baseline risk · normal rate'}
      </div>
    </div>
  );
}

/**
 * Always-visible wallet panel. Shows the buyer/seller addresses used by the
 * x402 flow, the live buyer USDC balance polled from Arc RPC, the network,
 * and a rolling tx-receipt log populated by each successful pay() during a
 * session.
 */
function WalletPanel({
  open,
  onToggle,
  buyerAddress,
  sellerAddress,
  buyerBalance,
  txReceipts,
  gatewayAvailableUsdc,
  depositAmount,
  onDepositAmountChange,
  onDeposit,
  depositing,
  depositStatus,
  lastDepositTxHash,
}: {
  open: boolean;
  onToggle: () => void;
  buyerAddress: string;
  sellerAddress: string;
  buyerBalance: bigint | null;
  txReceipts: TxReceipt[];
  gatewayAvailableUsdc: string | null;
  depositAmount: string;
  onDepositAmountChange: (value: string) => void;
  onDeposit: () => void;
  depositing: boolean;
  depositStatus: string;
  lastDepositTxHash: string;
}) {
  const copy = useCallback((text: string) => {
    if (!text) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  }, []);

  return (
    <div
      className="border border-[#1e1e1e] bg-[#0e0e0e] mb-4 font-dm-mono text-xs"
      data-testid="wallet-panel"
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#121212] transition-colors"
        aria-expanded={open}
        data-testid="wallet-panel-toggle"
      >
        <span className="uppercase tracking-widest text-[#888888] flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Your wallet
        </span>
        <span className="text-[#666666] normal-case tracking-normal">
          balance: {gatewayAvailableUsdc ?? formatUsdc6(buyerBalance)} USDC
        </span>
      </button>

      {open && (
        <div className="border-t border-[#1e1e1e] px-4 py-3 grid gap-3">
          <WalletRow
            label="Your wallet"
            address={buyerAddress}
            onCopy={() => copy(buyerAddress)}
          />
          <WalletRow
            label="Insurer"
            address={sellerAddress}
            onCopy={() => copy(sellerAddress)}
          />
          <div className="grid grid-cols-2 gap-3 text-[#888888]">
            <div>
              <div className="uppercase tracking-widest text-[#666666]">
                Your balance
              </div>
              <div
                className="text-[#e8a020] mt-1 tabular-nums text-sm"
                data-testid="gateway-usdc-balance"
              >
                {gatewayAvailableUsdc ?? '—'} USDC
              </div>
            </div>
            <div>
              <div className="uppercase tracking-widest text-[#666666]">
                In main wallet
              </div>
              <div
                className="text-[#f0f0f0] mt-1 tabular-nums text-sm"
                data-testid="buyer-usdc-balance"
              >
                {formatUsdc6(buyerBalance)} USDC
              </div>
            </div>
          </div>

          <div className="border border-[#1e1e1e] bg-[#080808] p-3 grid gap-2">
            <div className="uppercase tracking-widest text-[#666666]">
              Add funds
            </div>
            <p className="text-[#666666] normal-case tracking-normal leading-relaxed text-[11px]">
              Move USDC from your main wallet into your cover balance. You'll
              be covered until this balance runs out.
            </p>
            <div className="flex items-stretch gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={depositAmount}
                onChange={e => onDepositAmountChange(e.target.value)}
                disabled={depositing}
                placeholder="USDC amount"
                className="flex-1 bg-[#0e0e0e] border border-[#1e1e1e] focus:border-[#e8a020]/60 text-[#f0f0f0] font-dm-mono px-3 py-2 text-xs outline-none transition-colors tabular-nums"
                data-testid="gateway-deposit-amount"
              />
              <button
                type="button"
                onClick={onDeposit}
                disabled={depositing}
                className="bg-[#e8a020] hover:bg-[#d49018] disabled:bg-[#1e1e1e] disabled:text-[#444444] text-[#080808] font-bold px-4 py-2 text-xs uppercase tracking-widest transition-colors whitespace-nowrap"
                data-testid="gateway-deposit-button"
              >
                {depositing ? 'Adding...' : 'Add funds'}
              </button>
            </div>
            {depositStatus ? (
              <div className="text-[11px] text-[#888888] normal-case tracking-normal" data-testid="gateway-deposit-status">
                {depositStatus}
              </div>
            ) : null}
            {lastDepositTxHash ? (
              <div className="text-[11px] font-dm-mono text-emerald-400 break-all normal-case tracking-normal">
                confirmed · tx {lastDepositTxHash.slice(0, 10)}…{lastDepositTxHash.slice(-6)}
              </div>
            ) : null}
          </div>

          <div>
            <div className="uppercase tracking-widest text-[#666666] mb-2">
              Activity ({txReceipts.length})
            </div>
            <div
              className="border border-[#1a1a1a] bg-[#080808] overflow-y-auto"
              style={{ maxHeight: 200 }}
              data-testid="tx-receipts"
            >
              {txReceipts.length === 0 ? (
                <div className="px-3 py-4 text-[#555555] text-center">
                  Nothing yet — start your cover to see each charge appear here.
                </div>
              ) : (
                <ul className="divide-y divide-[#1a1a1a]">
                  {txReceipts.map((r, i) => (
                    <li
                      key={`${r.ts}-${i}`}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <span className="text-[#666666] tabular-nums">{r.ts}</span>
                      <span className="text-[#e8a020]">{r.endpoint}</span>
                      <span className="text-[#888888] tabular-nums">
                        {r.microUsdc} µUSDC
                      </span>
                      <span className="text-[#f0f0f0] ml-auto tabular-nums">
                        {r.id ? shortenId(r.id) : '—'}
                      </span>
                      {r.id && (
                        <button
                          type="button"
                          onClick={() => copy(r.id)}
                          aria-label="Copy receipt id"
                          className="text-[#666666] hover:text-[#f0f0f0] transition-colors"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WalletRow({
  label,
  address,
  onCopy,
}: {
  label: string;
  address: string;
  onCopy: () => void;
}) {
  const hasAddress = Boolean(address);
  return (
    <div className="flex items-center gap-3">
      <span className="uppercase tracking-widest text-[#666666] w-14">
        {label}
      </span>
      <span
        className="text-[#f0f0f0] tabular-nums"
        title={address || 'unset'}
        data-testid={`wallet-${label.toLowerCase()}`}
      >
        {hasAddress ? shortenAddress(address) : 'unset'}
      </span>
      {hasAddress && (
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${label.toLowerCase()} address`}
          className="text-[#666666] hover:text-[#f0f0f0] transition-colors"
        >
          <Copy className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
