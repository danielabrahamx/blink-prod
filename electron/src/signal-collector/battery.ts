/**
 * battery.ts - battery_health_pct signal collector.
 *
 * wear = 1 - (maxCapacity / designedCapacity)
 * battery_health_pct = round(100 * (maxCapacity / designedCapacity))
 *
 * Polled once per hour. Windows OEM coverage is roughly 70-90 percent - some
 * drivers return zero for designedCapacity or maxCapacity. We treat any
 * missing / zero / negative reading as `null`. The risk rulebook is marked
 * null-tolerant so a missing value does not break scoring.
 */

type BatteryInfo = {
  hasBattery?: boolean;
  cycleCount?: number;
  isCharging?: boolean;
  designedCapacity?: number;
  maxCapacity?: number;
  currentCapacity?: number;
  voltage?: number;
  capacityUnit?: string;
  percent?: number;
  timeRemaining?: number | null;
  acConnected?: boolean;
  type?: string;
  model?: string;
  manufacturer?: string;
  serial?: string;
};

type SystemInfoLib = {
  battery: () => Promise<BatteryInfo>;
};

let cachedLib: SystemInfoLib | null = null;

function loadSysInfo(): SystemInfoLib {
  if (cachedLib) return cachedLib;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cachedLib = require('systeminformation') as SystemInfoLib;
  return cachedLib;
}

export async function sampleBatteryHealth(
  override?: SystemInfoLib,
): Promise<number | null> {
  const lib = override ?? loadSysInfo();
  let info: BatteryInfo;
  try {
    info = await lib.battery();
  } catch {
    return null;
  }
  if (!info || info.hasBattery === false) return null;
  const designed = info.designedCapacity;
  const max = info.maxCapacity;
  if (
    typeof designed !== 'number' ||
    typeof max !== 'number' ||
    !isFinite(designed) ||
    !isFinite(max) ||
    designed <= 0 ||
    max < 0
  ) {
    return null;
  }
  // Clamp pathological values (some drivers report maxCapacity > designed).
  const ratio = Math.min(1, max / designed);
  const pct = Math.round(ratio * 100);
  if (pct < 0 || pct > 100) return null;
  return pct;
}
