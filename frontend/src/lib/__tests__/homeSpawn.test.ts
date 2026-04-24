import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHomeSpawn,
  HOME_SPAWN_STORAGE_KEY,
  readHomeSpawn,
  writeHomeSpawn,
} from '../homeSpawn';

describe('homeSpawn persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('returns null when nothing has been written', () => {
    expect(readHomeSpawn()).toBeNull();
  });

  it('round-trips a written spawn', () => {
    const written = writeHomeSpawn({ lat: 51.5074, lng: -0.1278, country: 'GB' });
    expect(written.setAt).toBe(Date.parse('2026-04-21T12:00:00Z'));
    const read = readHomeSpawn();
    expect(read).toEqual(written);
  });

  it('honours an explicit setAt when provided', () => {
    const written = writeHomeSpawn({
      lat: 1,
      lng: 2,
      country: 'GB',
      setAt: 123,
    });
    expect(written.setAt).toBe(123);
    expect(readHomeSpawn()?.setAt).toBe(123);
  });

  it('persists without a country when none is supplied', () => {
    const written = writeHomeSpawn({ lat: 0, lng: 0 });
    expect(written.country).toBeUndefined();
    expect(readHomeSpawn()?.country).toBeUndefined();
  });

  it('clearHomeSpawn removes the storage entry', () => {
    writeHomeSpawn({ lat: 0, lng: 0 });
    clearHomeSpawn();
    expect(readHomeSpawn()).toBeNull();
    expect(localStorage.getItem(HOME_SPAWN_STORAGE_KEY)).toBeNull();
  });

  it('returns null on corrupted JSON', () => {
    localStorage.setItem(HOME_SPAWN_STORAGE_KEY, '{not json');
    expect(readHomeSpawn()).toBeNull();
  });

  it('returns null on missing required fields', () => {
    localStorage.setItem(HOME_SPAWN_STORAGE_KEY, JSON.stringify({ lat: 0 }));
    expect(readHomeSpawn()).toBeNull();
  });

  it('returns null when lat is not finite', () => {
    localStorage.setItem(HOME_SPAWN_STORAGE_KEY, JSON.stringify({ lat: NaN, lng: 0 }));
    expect(readHomeSpawn()).toBeNull();
  });

  it('returns null when lat is out of range', () => {
    localStorage.setItem(
      HOME_SPAWN_STORAGE_KEY,
      JSON.stringify({ lat: 91, lng: 0, setAt: 0 }),
    );
    expect(readHomeSpawn()).toBeNull();
  });

  it('returns null when lng is out of range', () => {
    localStorage.setItem(
      HOME_SPAWN_STORAGE_KEY,
      JSON.stringify({ lat: 0, lng: 181, setAt: 0 }),
    );
    expect(readHomeSpawn()).toBeNull();
  });

  it('ignores extra fields', () => {
    localStorage.setItem(
      HOME_SPAWN_STORAGE_KEY,
      JSON.stringify({ lat: 1, lng: 2, setAt: 1000, extra: 'junk' }),
    );
    const read = readHomeSpawn();
    expect(read).toEqual({ lat: 1, lng: 2, country: undefined, setAt: 1000 });
  });

  it('coerces missing setAt to 0 rather than rejecting the record', () => {
    localStorage.setItem(HOME_SPAWN_STORAGE_KEY, JSON.stringify({ lat: 1, lng: 2 }));
    expect(readHomeSpawn()?.setAt).toBe(0);
  });

  it('drops a non-string country without rejecting the record', () => {
    localStorage.setItem(
      HOME_SPAWN_STORAGE_KEY,
      JSON.stringify({ lat: 1, lng: 2, setAt: 0, country: 42 }),
    );
    expect(readHomeSpawn()?.country).toBeUndefined();
  });
});
