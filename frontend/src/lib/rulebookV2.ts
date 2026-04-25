/**
 * Blink rulebook — charging-state pricing.
 *
 * One rating factor: whether the laptop is plugged in (At Desk) or running
 * on battery (On The Move). Plugged is the 1× baseline; on battery doubles
 * it. In the live demo narration plug/unplug stands in as a proxy for
 * "at desk vs. on the move" — judges who can't move physically during the
 * pitch can still trigger a visible rate change.
 *
 * Settlement math stays integer micro-USDC (1 µ-USDC = 1e-6 USDC); the
 * battery factor is exactly 1 or 2, so every base × factor is still
 * representable. GBP display is a convenience conversion, never settled on.
 */

export const MICRO_USDC_PER_USDC = 1_000_000;

/** Baseline per-second rate in integer µ-USDC (laptop plugged in). */
export const BASE_RATE_MICRO_USDC_PER_SEC = 3;

/** Display-only GBP conversion factor. Never use for settlement. */
export const GBP_PER_USDC_DISPLAY_ONLY = 0.79;

/**
 * Battery factor. 2× when we have explicit evidence of on-battery
 * operation (Battery Status API says charging is false). Anything else
 * (pending, unsupported, plugged in) collapses to 1×, so users on
 * Firefox/Safari where the API is absent are never penalised.
 */
export const BATTERY_MULTIPLIER_UNPLUGGED = 2;

export interface ScoreInput {
  charging?: boolean;
}

export interface ScoreOutput {
  /** The charging state used for this score (undefined if unknown). */
  charging: boolean | undefined;
  /** Multiplier applied — 1.00 when plugged/unknown, 2.00 when on battery. */
  multiplier: number;
  /** Integer micro-USDC per second including the battery factor. */
  microUsdcPerSec: number;
  /** Human-readable state label: "At Desk" | "On The Move". */
  reason: string;
}

function batteryFactor(charging: boolean | undefined): number {
  return charging === false ? BATTERY_MULTIPLIER_UNPLUGGED : 1;
}

export function scoreV2(input: ScoreInput): ScoreOutput {
  const multiplier = batteryFactor(input.charging);
  const reason = input.charging === false ? 'On The Move' : 'At Desk';
  return {
    charging: input.charging,
    multiplier,
    microUsdcPerSec: BASE_RATE_MICRO_USDC_PER_SEC * multiplier,
    reason,
  };
}

export function microUsdcToUsdcDisplay(micro: number): string {
  return (micro / MICRO_USDC_PER_USDC).toFixed(6);
}

export function microUsdcToGbpDisplay(micro: number): string {
  const usdc = micro / MICRO_USDC_PER_USDC;
  return (usdc * GBP_PER_USDC_DISPLAY_ONLY).toFixed(6);
}
