import { describe, it, expect } from 'vitest';
import { sampleAppCategory, APP_CATEGORY_TABLE } from '../src/signal-collector/app-category';

describe('sampleAppCategory', () => {
  it('returns idle when isIdle is true', async () => {
    const r = await sampleAppCategory({
      isIdle: true,
      getActiveWindow: async () => undefined,
    });
    expect(r).toBe('idle');
  });

  it('returns null when get-windows returns undefined', async () => {
    const r = await sampleAppCategory({
      isIdle: false,
      getActiveWindow: async () => undefined,
    });
    expect(r).toBeNull();
  });

  it('returns null when get-windows throws (null-tolerance)', async () => {
    const r = await sampleAppCategory({
      isIdle: false,
      getActiveWindow: async () => {
        throw new Error('permission denied');
      },
    });
    expect(r).toBeNull();
  });

  it('matches by macOS bundleId', async () => {
    const r = await sampleAppCategory({
      isIdle: false,
      getActiveWindow: async () => ({
        owner: { bundleId: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
      }),
    });
    expect(r).toBe('productivity');
  });

  it('matches by Windows exe basename', async () => {
    const r = await sampleAppCategory({
      isIdle: false,
      getActiveWindow: async () => ({
        owner: {
          path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          name: 'Google Chrome',
        },
      }),
    });
    expect(r).toBe('browser');
  });

  it('falls through to unknown for unmapped processes', async () => {
    const r = await sampleAppCategory({
      isIdle: false,
      getActiveWindow: async () => ({
        owner: { bundleId: 'com.example.obscure-app', name: 'Obscure' },
      }),
    });
    expect(r).toBe('unknown');
  });

  it('lookup table is lower-case-only', () => {
    for (const key of Object.keys(APP_CATEGORY_TABLE)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('does not include window title (privacy invariant)', async () => {
    // The ingest endpoint only accepts whitelisted signals, so even if a
    // window title leaks through get-windows it must never reach the
    // envelope. This test sanity-checks that the sampler returns only a
    // category label, not any string sourced from the title.
    const r = await sampleAppCategory({
      isIdle: false,
      getActiveWindow: async () => ({
        title: 'Secret banking.com',
        owner: { bundleId: 'com.google.Chrome' },
      }),
    });
    expect(r).toBe('browser');
  });
});
