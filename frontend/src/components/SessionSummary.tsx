import {
  BASE_RATE_MICRO_USDC_PER_SEC,
  microUsdcToGbpDisplay,
  microUsdcToUsdcDisplay,
} from '@/lib/rulebookV2';

export interface SecondsByState {
  plugged: number;
  unplugged: number;
}

export interface SessionResult {
  totalMicroUsdc: number;
  secondsByState: SecondsByState;
  txId: string | null;
  durationSeconds: number;
}

interface Props {
  result: SessionResult;
  onRunAgain: () => void;
  onBackToHome: () => void;
}

const STATE_LABEL: Record<keyof SecondsByState, string> = {
  plugged: 'AT DESK',
  unplugged: 'ON THE MOVE',
};

function totalSeconds(state: SecondsByState): number {
  return state.plugged + state.unplugged;
}

function averageMultiplier(result: SessionResult): number {
  const total = totalSeconds(result.secondsByState);
  if (total === 0) return 1;
  return result.totalMicroUsdc / (total * BASE_RATE_MICRO_USDC_PER_SEC);
}

export function SessionSummary({ result, onRunAgain, onBackToHome }: Props) {
  const total = totalSeconds(result.secondsByState);
  const avg = averageMultiplier(result);

  return (
    <div
      className="border border-[#1e1e1e] bg-[#0e0e0e] p-8"
      data-testid="session-summary"
    >
      <div className="text-xs uppercase tracking-widest text-[#e8a020] mb-3">
        Just charged
      </div>
      <div
        className="font-dm-mono text-5xl text-[#f0f0f0] leading-none"
        data-testid="summary-total-usdc"
      >
        {microUsdcToUsdcDisplay(result.totalMicroUsdc)} USDC
      </div>
      <div className="text-[#888888] text-lg mt-2 font-dm-mono">
        ≈ £{microUsdcToGbpDisplay(result.totalMicroUsdc)} · {total} s
      </div>

      <div className="mt-8 pt-6 border-t border-[#1a1a1a] space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-[#666666] uppercase tracking-widest text-xs">
            Avg multiplier
          </span>
          <span className="font-dm-mono text-[#f0f0f0]">{avg.toFixed(2)}×</span>
        </div>
        {(Object.keys(result.secondsByState) as Array<keyof SecondsByState>).map(state => (
          <div key={state} className="flex justify-between text-sm">
            <span className="text-[#666666] uppercase tracking-widest text-xs">
              {STATE_LABEL[state]} seconds
            </span>
            <span className="font-dm-mono text-[#f0f0f0]">
              {result.secondsByState[state]}
            </span>
          </div>
        ))}
        <div className="flex justify-between text-sm">
          <span className="text-[#666666] uppercase tracking-widest text-xs">
            Settlement tx
          </span>
          <span className="font-dm-mono text-[#888888] text-xs truncate max-w-[60%]">
            {result.txId ?? 'pending'}
          </span>
        </div>
      </div>

      <div className="mt-8 flex gap-3">
        <button
          type="button"
          onClick={onRunAgain}
          className="flex-1 bg-[#e8a020] text-[#080808] font-dm-mono uppercase text-sm tracking-widest py-3 hover:bg-[#f5b530] transition-colors"
        >
          Keep going
        </button>
        <button
          type="button"
          onClick={onBackToHome}
          className="flex-1 border border-[#1e1e1e] text-[#888888] font-dm-mono uppercase text-sm tracking-widest py-3 hover:border-[#666666] hover:text-[#f0f0f0] transition-colors"
        >
          Back to home
        </button>
      </div>
    </div>
  );
}
