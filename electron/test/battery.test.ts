import { describe, it, expect } from 'vitest';
import { sampleBatteryHealth } from '../src/signal-collector/battery';

describe('sampleBatteryHealth', () => {
  it('null when hasBattery is false', async () => {
    const lib = { battery: async () => ({ hasBattery: false }) };
    expect(await sampleBatteryHealth(lib)).toBeNull();
  });

  it('null when library throws', async () => {
    const lib = {
      battery: async () => {
        throw new Error('sysinfo failure');
      },
    };
    expect(await sampleBatteryHealth(lib)).toBeNull();
  });

  it('null when designedCapacity is zero (OEM driver blank)', async () => {
    const lib = {
      battery: async () => ({
        hasBattery: true,
        designedCapacity: 0,
        maxCapacity: 4000,
      }),
    };
    expect(await sampleBatteryHealth(lib)).toBeNull();
  });

  it('null when maxCapacity is missing', async () => {
    const lib = {
      battery: async () => ({
        hasBattery: true,
        designedCapacity: 5000,
      }),
    };
    expect(await sampleBatteryHealth(lib)).toBeNull();
  });

  it('null when designedCapacity is missing', async () => {
    const lib = {
      battery: async () => ({
        hasBattery: true,
        maxCapacity: 4000,
      }),
    };
    expect(await sampleBatteryHealth(lib)).toBeNull();
  });

  it('computes 100 percent on brand-new battery', async () => {
    const lib = {
      battery: async () => ({
        hasBattery: true,
        designedCapacity: 5000,
        maxCapacity: 5000,
      }),
    };
    expect(await sampleBatteryHealth(lib)).toBe(100);
  });

  it('computes 80 percent on worn battery (wear = 0.20)', async () => {
    const lib = {
      battery: async () => ({
        hasBattery: true,
        designedCapacity: 5000,
        maxCapacity: 4000,
      }),
    };
    expect(await sampleBatteryHealth(lib)).toBe(80);
  });

  it('clamps maxCapacity > designed to 100 percent', async () => {
    const lib = {
      battery: async () => ({
        hasBattery: true,
        designedCapacity: 5000,
        maxCapacity: 5500,
      }),
    };
    expect(await sampleBatteryHealth(lib)).toBe(100);
  });

  it('null when library returns null', async () => {
    const lib = { battery: async () => null as unknown as { hasBattery?: boolean } };
    expect(await sampleBatteryHealth(lib)).toBeNull();
  });
});
