import { describe, it, expect } from 'vitest';
import { __internals } from './window.js';

describe('window', () => {
  it('DEFAULT_STATE has sensible defaults', () => {
    expect(__internals.DEFAULT_STATE.width).toBeGreaterThanOrEqual(960);
    expect(__internals.DEFAULT_STATE.height).toBeGreaterThanOrEqual(640);
    expect(__internals.DEFAULT_STATE.maximized).toBe(false);
  });

  it('resolveRendererEntry falls back to file load when ELECTRON_RENDERER_URL is absent', () => {
    const prior = process.env.ELECTRON_RENDERER_URL;
    delete process.env.ELECTRON_RENDERER_URL;
    const entry = __internals.resolveRendererEntry();
    expect(entry.kind).toBe('file');
    expect(entry.target).toMatch(/index\.html$/);
    if (prior !== undefined) process.env.ELECTRON_RENDERER_URL = prior;
  });

  it('resolvePreload returns an absolute path ending in preload/index.js', () => {
    const p = __internals.resolvePreload();
    expect(p.replace(/\\/g, '/')).toMatch(/preload\/index\.js$/);
  });
});
