import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Wallet, Database, Coins, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type TokenBalance = {
  amount?: string;
  token?: { symbol?: string; name?: string };
};

type WalletBalanceResponse = {
  walletId?: string;
  address?: string | null;
  tokenBalances: TokenBalance[];
  error?: string;
};

type OnChainBalance = {
  address: string;
  usdc: string;
  usyc: string;
  error?: string;
};

type HealthTx = {
  band?: string;
  charging?: boolean;
  premiumMicroUsdc?: number;
  txPayer?: string;
  txAmount?: string | number;
  network?: string;
  txHash?: string;
  path?: string;
  timestamp?: string;
};

type HealthResponse = {
  status: string;
  uptime: number;
  totalPremiumsUsdc: number;
  lastTxs: HealthTx[];
};

const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) || "http://localhost:3001";
// The seller wallet IS the pool. Premiums and per-second streaming charges
// both settle here, so we treat this address as the single source of truth
// for "what's in the pool" on the admin dashboard.
const SELLER_ADDRESS =
  (import.meta.env.VITE_SELLER_ADDRESS as string | undefined) ||
  // Backward-compat with existing .env files that still use VITE_ADMIN_ADDRESS.
  (import.meta.env.VITE_ADMIN_ADDRESS as string | undefined) ||
  "";
const CIRCLE_WALLET_ID =
  (import.meta.env.VITE_CIRCLE_WALLET_ID as string | undefined) || "";

function formatAmount(raw: string | undefined, decimals = 6): string {
  if (!raw) return "0";
  const n = Number(raw);
  if (Number.isFinite(n)) return n.toFixed(decimals);
  return raw;
}

function short(address: string | null | undefined): string {
  if (!address) return "—";
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const Admin: React.FC = () => {
  const [onchain, setOnchain] = useState<OnChainBalance | null>(null);
  const [onchainErr, setOnchainErr] = useState<string | null>(null);

  const [wallet, setWallet] = useState<WalletBalanceResponse | null>(null);
  const [walletErr, setWalletErr] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);

  const [health, setHealth] = useState<HealthResponse | null>(null);

  const [depositAmount, setDepositAmount] = useState<string>("");
  const [depositing, setDepositing] = useState(false);
  const [lastDepositTxId, setLastDepositTxId] = useState<string | null>(null);

  const fetchOnchain = useCallback(async () => {
    if (!SELLER_ADDRESS) {
      setOnchainErr("VITE_SELLER_ADDRESS not set");
      return;
    }
    try {
      const r = await fetch(`${BACKEND_URL}/api/admin/balance/${SELLER_ADDRESS}`);
      const body = (await r.json()) as OnChainBalance;
      if (!r.ok || body.error) {
        setOnchainErr(body.error || `HTTP ${r.status}`);
      } else {
        setOnchain(body);
        setOnchainErr(null);
      }
    } catch (e: unknown) {
      setOnchainErr(e instanceof Error ? e.message : "network error");
    }
  }, []);

  const fetchWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/admin/wallet-balance`);
      const body = (await r.json()) as WalletBalanceResponse;
      if (!r.ok || body.error) {
        setWalletErr(body.error || `HTTP ${r.status}`);
        setWallet({ tokenBalances: [] });
      } else {
        setWallet(body);
        setWalletErr(null);
      }
    } catch (e: unknown) {
      setWalletErr(e instanceof Error ? e.message : "network error");
      setWallet({ tokenBalances: [] });
    } finally {
      setWalletLoading(false);
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/health`);
      const body = (await r.json()) as HealthResponse;
      setHealth(body);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchOnchain();
    fetchWallet();
    fetchHealth();
  }, [fetchOnchain, fetchWallet, fetchHealth]);

  useEffect(() => {
    const id = window.setInterval(fetchOnchain, 10_000);
    return () => window.clearInterval(id);
  }, [fetchOnchain]);

  useEffect(() => {
    const id = window.setInterval(fetchHealth, 5_000);
    return () => window.clearInterval(id);
  }, [fetchHealth]);

  const refreshAll = useCallback(() => {
    fetchOnchain();
    fetchWallet();
    fetchHealth();
    toast.success("Refreshing pool data");
  }, [fetchOnchain, fetchWallet, fetchHealth]);

  const onDeposit = useCallback(async () => {
    const amount = Number(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a positive USYC amount");
      return;
    }
    setDepositing(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/admin/deposit-reserve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsyc: amount }),
      });
      const body = (await r.json()) as { ok?: boolean; txId?: string | null; error?: string };
      if (!r.ok || !body.ok) {
        toast.error(body.error || `Deposit failed (HTTP ${r.status})`);
        return;
      }
      setLastDepositTxId(body.txId || null);
      toast.success(`Deposit submitted${body.txId ? ` · tx ${body.txId.slice(0, 8)}` : ""}`);
      setDepositAmount("");
      setTimeout(() => {
        fetchWallet();
        fetchOnchain();
      }, 4_000);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "network error");
    } finally {
      setDepositing(false);
    }
  }, [depositAmount, fetchWallet, fetchOnchain]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-100 text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
          <span className="text-slate-600">/</span>
          <span className="text-sm uppercase tracking-widest text-slate-300">
            Blink · Seller pool & Reserves
          </span>
        </div>
        <Button
          onClick={refreshAll}
          variant="outline"
          size="sm"
          className="border-slate-700 text-slate-200 hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Seller wallet identity */}
        <Card className="bg-slate-900 border-slate-800 text-slate-100">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4 text-slate-400" />
              Seller wallet
            </CardTitle>
            <CardDescription className="text-slate-400">
              The pool. Every policy premium and every per-second streaming
              charge settles into this wallet; USYC yield is earned here too.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-500 mb-1">
                Seller address
              </div>
              <div className="font-mono break-all text-slate-100">
                {SELLER_ADDRESS || "—"}
              </div>
            </div>
            {CIRCLE_WALLET_ID ? (
              <div>
                <div className="text-xs uppercase tracking-widest text-slate-500 mb-1">
                  DCV wallet ID
                </div>
                <div className="font-mono break-all text-slate-100">
                  {CIRCLE_WALLET_ID}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Seller pool — on-chain balances */}
          <Card className="bg-slate-900 border-slate-800 text-slate-100">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Coins className="h-4 w-4 text-slate-400" />
                Seller pool · on-chain
              </CardTitle>
              <CardDescription className="text-slate-400">
                Live Arc RPC reads for {short(SELLER_ADDRESS)}. USYC is the
                yield-bearing reserve; USDC is what's available for payouts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {onchainErr ? (
                <div className="text-amber-400 text-xs">Error: {onchainErr}</div>
              ) : null}
              <div className="flex items-baseline justify-between">
                <span className="text-slate-400">USDC</span>
                <span className="font-mono text-lg text-slate-100">
                  {onchain ? formatAmount(onchain.usdc) : "—"}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-slate-400">USYC</span>
                <span className="font-mono text-lg text-slate-100">
                  {onchain ? formatAmount(onchain.usyc) : "—"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* DCV balances */}
          <Card className="bg-slate-900 border-slate-800 text-slate-100">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4 text-slate-400" />
                Circle Gateway / DCV balances
              </CardTitle>
              <CardDescription className="text-slate-400">
                Server-side Circle API — reflects reserved/spendable balance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {walletErr ? (
                <div className="text-amber-400 text-xs">
                  Error: {walletErr}
                </div>
              ) : null}
              {walletLoading && !wallet ? (
                <div className="text-slate-500">Loading…</div>
              ) : null}
              {wallet && wallet.tokenBalances.length === 0 && !walletErr ? (
                <div className="text-slate-500">No balances reported.</div>
              ) : null}
              {wallet?.tokenBalances.map((tb, i) => {
                const sym = tb.token?.symbol || tb.token?.name || `token-${i}`;
                return (
                  <div
                    key={`${sym}-${i}`}
                    className="flex items-baseline justify-between"
                  >
                    <span className="text-slate-400">{sym}</span>
                    <span className="font-mono text-lg text-slate-100">
                      {tb.amount ?? "0"}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* Deposit USYC */}
        <Card className="bg-slate-900 border-slate-800 text-slate-100">
          <CardHeader>
            <CardTitle className="text-base">Top up USYC reserve</CardTitle>
            <CardDescription className="text-slate-400">
              Approves the Blink contract, then calls depositReserve(amount).
              Signed by the Circle DCV wallet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                type="number"
                min="0"
                step="0.000001"
                placeholder="USYC amount"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-500"
                disabled={depositing}
              />
              <Button
                onClick={onDeposit}
                disabled={depositing}
                className="bg-slate-100 text-slate-900 hover:bg-white"
              >
                {depositing ? "Depositing…" : "Deposit"}
              </Button>
            </div>
            {lastDepositTxId ? (
              <div className="text-xs font-mono text-emerald-400 break-all">
                last tx: {lastDepositTxId}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Recent x402 receipts */}
        <Card className="bg-slate-900 border-slate-800 text-slate-100">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4 text-slate-400" />
              Recent x402 receipts
            </CardTitle>
            <CardDescription className="text-slate-400">
              Live from /api/health every 5s. Total premiums:{" "}
              <span className="font-mono text-slate-200">
                {health ? health.totalPremiumsUsdc.toFixed(6) : "—"}
              </span>{" "}
              USDC
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-y-auto border border-slate-800 rounded">
              <table className="w-full text-xs font-mono">
                <thead className="bg-slate-950 text-slate-500 uppercase tracking-widest">
                  <tr>
                    <th className="text-left px-3 py-2">Time</th>
                    <th className="text-left px-3 py-2">Band</th>
                    <th className="text-right px-3 py-2">µUSDC</th>
                    <th className="text-left px-3 py-2">Payer</th>
                    <th className="text-left px-3 py-2">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {(health?.lastTxs || []).slice().reverse().map((tx, i) => (
                    <tr
                      key={`${tx.txHash || i}-${i}`}
                      className="border-t border-slate-800 text-slate-300"
                    >
                      <td className="px-3 py-2 text-slate-500">
                        {tx.timestamp ? tx.timestamp.slice(11, 19) : "—"}
                      </td>
                      <td className="px-3 py-2">{tx.band || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {tx.premiumMicroUsdc ?? "—"}
                      </td>
                      <td className="px-3 py-2">{short(tx.txPayer)}</td>
                      <td className="px-3 py-2">{short(tx.txHash)}</td>
                    </tr>
                  ))}
                  {!health?.lastTxs?.length ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-6 text-center text-slate-500"
                      >
                        No receipts yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Admin;
