import { describe, it, expect } from 'vitest';
import { MemoryRedis } from '../lib/memoryRedis.js';
import { claim } from './nonceStore.js';
import { ConflictError } from '../lib/errors.js';

describe('nonceStore', () => {
  it('accepts a novel nonce', async () => {
    const r = new MemoryRedis();
    await expect(claim(r, 'pol_1', 'n1')).resolves.toBeUndefined();
  });

  it('rejects a duplicate nonce', async () => {
    const r = new MemoryRedis();
    await claim(r, 'pol_1', 'n1');
    await expect(claim(r, 'pol_1', 'n1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('isolates per policy', async () => {
    const r = new MemoryRedis();
    await claim(r, 'pol_1', 'n1');
    await expect(claim(r, 'pol_2', 'n1')).resolves.toBeUndefined();
  });

  it('accepts different nonces on same policy', async () => {
    const r = new MemoryRedis();
    await claim(r, 'pol_1', 'n1');
    await expect(claim(r, 'pol_1', 'n2')).resolves.toBeUndefined();
  });
});
