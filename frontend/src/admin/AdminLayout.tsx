// AdminLayout wraps every /admin route. Gate order:
// 1. Wallet must be connected (injected provider on window.ethereum or a
//    Circle-hosted wallet; the user-facing dashboard already handles this so
//    we only read the active address here).
// 2. Wallet must resolve to an admin-allowlisted role via /admin/role.
//
// Styling mirrors InsuracleDashboard.tsx: #080808 background, #0e0e0e card,
// #1a1a1a borders, #e8a020 accent, Bebas Neue display, DM Mono for hashes,
// DM Sans for body. No emojis anywhere.

import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ArrowLeft, Shield, Activity, RotateCcw, FileDown, Gauge } from 'lucide-react';
import { getAdminRole, AdminApiError } from './adminClient';
import type { AdminRole } from './types';
import { shortHash } from './formatters';

interface AdminLayoutProps {
  // Injected from the host app (Index.tsx wires this to the connected wallet).
  walletAddress?: string | null;
  onDisconnect?: () => void;
}

type GateStatus = 'connecting' | 'checking' | 'allowed' | 'denied' | 'error';

export default function AdminLayout({
  walletAddress,
  onDisconnect,
}: AdminLayoutProps) {
  const [status, setStatus] = useState<GateStatus>('connecting');
  const [role, setRole] = useState<AdminRole | null>(null);
  const [error, setError] = useState<string>('');
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    if (!walletAddress) {
      setStatus('connecting');
      setRole(null);
      return;
    }
    setStatus('checking');
    setError('');
    getAdminRole(walletAddress)
      .then((r) => {
        if (cancelled) return;
        setRole(r);
        setStatus('allowed');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof AdminApiError && e.status === 403) {
          setStatus('denied');
          return;
        }
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Unknown error');
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  return (
    <div className="min-h-screen bg-[#080808] text-[#f0f0f0]">
      <div className="border-b border-[#1a1a1a] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onDisconnect}
            className="flex items-center gap-2 text-[#666666] hover:text-[#f0f0f0] text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </button>
          <span className="font-bebas text-xl tracking-widest text-[#f0f0f0]">
            BLINK
          </span>
          <span className="text-[#333333]">/</span>
          <span className="text-[#666666] text-sm uppercase tracking-widest">
            Admin
          </span>
        </div>
        <div className="flex items-center gap-3">
          {walletAddress && (
            <span
              className="font-dm-mono text-xs text-[#888888]"
              data-testid="admin-wallet"
            >
              {shortHash(walletAddress, 6, 6)}
            </span>
          )}
          {role && (
            <span className="text-[10px] uppercase tracking-widest text-[#e8a020] border border-[#e8a020]/30 px-2 py-0.5">
              {role.role}
            </span>
          )}
        </div>
      </div>

      {status === 'allowed' && (
        <AdminNav currentPath={location.pathname} />
      )}

      <main className="max-w-6xl mx-auto px-6 py-8">
        {status === 'connecting' && (
          <GateMessage
            title="Wallet required"
            body="Connect an admin-allowlisted wallet to access the portal."
          />
        )}
        {status === 'checking' && (
          <GateMessage title="Verifying role" body="Checking wallet against the admin allowlist." />
        )}
        {status === 'denied' && (
          <GateMessage
            title="Access denied"
            body="This wallet is not on the admin allowlist."
            tone="destructive"
          />
        )}
        {status === 'error' && (
          <GateMessage
            title="Role lookup failed"
            body={error || 'Backend unreachable.'}
            tone="destructive"
          />
        )}
        {status === 'allowed' && <Outlet context={{ wallet: walletAddress, role }} />}
      </main>
    </div>
  );
}

function AdminNav({ currentPath }: { currentPath: string }) {
  const items = [
    { to: '/admin/metrics', label: 'Metrics', Icon: Gauge },
    { to: '/admin/policy', label: 'Policy Inspector', Icon: Activity },
    { to: '/admin/replay', label: 'Replay', Icon: RotateCcw },
    { to: '/admin/export', label: 'Export', Icon: FileDown },
  ];
  return (
    <nav className="border-b border-[#1a1a1a] px-6">
      <div className="max-w-6xl mx-auto flex gap-6">
        {items.map(({ to, label, Icon }) => {
          const active = currentPath.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-2 py-3 text-xs uppercase tracking-widest transition-colors ${
                active
                  ? 'text-[#e8a020] border-b border-[#e8a020]'
                  : 'text-[#666666] hover:text-[#f0f0f0]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function GateMessage({
  title,
  body,
  tone = 'muted',
}: {
  title: string;
  body: string;
  tone?: 'muted' | 'destructive';
}) {
  const toneClass =
    tone === 'destructive' ? 'text-[#e05656]' : 'text-[#888888]';
  return (
    <div className="bg-[#0e0e0e] border border-[#1a1a1a] p-8 flex items-start gap-4">
      <Shield className={`h-5 w-5 mt-0.5 ${toneClass}`} />
      <div>
        <div className="font-bebas text-lg tracking-widest text-[#f0f0f0] mb-2">
          {title}
        </div>
        <div className={`text-sm leading-relaxed ${toneClass}`}>{body}</div>
      </div>
    </div>
  );
}
