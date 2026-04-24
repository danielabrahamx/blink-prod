import { microUsdcToGbpDisplay } from '@/lib/rulebookV2';

interface Props {
  balanceUsdc: string | null;
  currentRateMicroUsdc: number;
  spentMicroUsdc: number;
  active: boolean;
  policyTotalSeconds: number;
  policyRemainingSeconds: number;
}

function formatRuntime(seconds: number): { primary: string; secondary: string } {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { primary: '0m', secondary: 'cover expired' };
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const mins = Math.floor((seconds % 3_600) / 60);
  const secs = Math.floor(seconds % 60);
  if (days > 0) return { primary: `${days}d ${hours}h`, secondary: 'of cover remaining' };
  if (hours > 0) return { primary: `${hours}h ${mins}m`, secondary: 'of cover remaining' };
  if (mins > 0) return { primary: `${mins}m ${secs}s`, secondary: 'of cover remaining' };
  return { primary: `${secs}s`, secondary: 'of cover remaining' };
}

function describePolicyLength(seconds: number): string {
  if (seconds >= 86_400) {
    const d = Math.round(seconds / 86_400);
    return d === 1 ? '1-day policy' : `${d}-day policy`;
  }
  if (seconds >= 3600) {
    const h = Math.round(seconds / 3600);
    return h === 1 ? '1-hour policy' : `${h}-hour policy`;
  }
  return `${seconds}s policy`;
}

export function LiveTicker({
  balanceUsdc,
  currentRateMicroUsdc,
  spentMicroUsdc,
  active,
  policyTotalSeconds,
  policyRemainingSeconds,
}: Props) {
  const balanceMicroUsdc =
    balanceUsdc !== null ? Math.floor(Number(balanceUsdc) * 1_000_000) : 0;
  const secondsFromBalance =
    currentRateMicroUsdc > 0 ? balanceMicroUsdc / currentRateMicroUsdc : 0;
  // When cover is active, show the policy countdown. When idle, show the
  // policy length the user has picked so the hero doesn't advertise a
  // stale balance-derived runway before activation.
  const displaySeconds = active ? policyRemainingSeconds : policyTotalSeconds;
  const runtime = formatRuntime(displaySeconds);

  const balanceDisplay =
    balanceUsdc !== null ? Number(balanceUsdc).toFixed(6) : '—';
  const lowBalance =
    active && secondsFromBalance > 0 && secondsFromBalance < policyRemainingSeconds;
  const runOut = active && policyRemainingSeconds <= 0;
  const progress = policyTotalSeconds > 0
    ? Math.min(100, Math.max(0, (policyRemainingSeconds / policyTotalSeconds) * 100))
    : 0;

  return (
    <div
      className="border border-[#1e1e1e] bg-[#0e0e0e] p-8"
      data-testid="live-ticker"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-widest text-[#666666]">
          {active ? 'Cover remaining' : describePolicyLength(policyTotalSeconds)}
        </div>
        <div
          className={`flex items-center gap-2 text-[11px] uppercase tracking-widest ${
            active ? 'text-[#34d399]' : 'text-[#666666]'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              active ? 'bg-[#34d399]' : 'bg-[#444444]'
            } ${active ? 'blink-pulse' : ''}`}
          />
          {active ? 'Active' : 'Not active'}
        </div>
      </div>

      <div
        className="font-bebas text-6xl text-[#f0f0f0] leading-none tracking-wide"
        data-testid="ticker-runtime"
      >
        {runtime.primary}
      </div>
      <div className="text-[#888888] text-sm mt-2 leading-relaxed">
        {active ? runtime.secondary : `tap Activate to start your ${describePolicyLength(policyTotalSeconds)}`}
      </div>

      {active ? (
        <div className="mt-4 h-1 bg-[#1a1a1a] overflow-hidden">
          <div
            className="h-full bg-[#e8a020] transition-[width] ease-linear"
            style={{ width: `${progress}%`, transitionDuration: '1000ms' }}
          />
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-6 pt-6 border-t border-[#1a1a1a]">
        <div>
          <div className="text-xs uppercase tracking-widest text-[#666666] mb-1">
            Balance
          </div>
          <div
            className="font-dm-mono text-[#f0f0f0] tabular-nums"
            data-testid="ticker-balance"
          >
            {balanceDisplay} USDC
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-[#666666] mb-1">
            Current rate
          </div>
          <div className="font-dm-mono text-[#f0f0f0] tabular-nums">
            £{microUsdcToGbpDisplay(currentRateMicroUsdc * 60)}/min
          </div>
        </div>
      </div>

      {spentMicroUsdc > 0 ? (
        <div className="mt-3 text-[11px] text-[#555555] font-dm-mono normal-case tracking-normal">
          paid so far: £{microUsdcToGbpDisplay(spentMicroUsdc)}
        </div>
      ) : null}

      {lowBalance ? (
        <div
          className="mt-6 border border-[#e8a020]/40 bg-[#e8a020]/5 text-[#e8a020] px-3 py-2 text-xs"
          data-testid="low-balance-warning"
        >
          Balance won't last the full policy — top up to stay covered.
        </div>
      ) : null}
      {runOut ? (
        <div
          className="mt-6 border border-[#ef4444]/50 bg-[#ef4444]/5 text-[#ef4444] px-3 py-2 text-xs"
          data-testid="no-balance-warning"
        >
          Policy has expired. Start a new one to stay covered.
        </div>
      ) : null}
    </div>
  );
}
