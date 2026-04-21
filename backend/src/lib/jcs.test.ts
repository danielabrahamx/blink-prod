import { describe, it, expect } from 'vitest';
import { jcs } from './jcs.js';

describe('jcs', () => {
  it('serializes primitives', () => {
    expect(jcs(null)).toBe('null');
    expect(jcs(true)).toBe('true');
    expect(jcs(false)).toBe('false');
    expect(jcs(0)).toBe('0');
    expect(jcs(1)).toBe('1');
    expect(jcs(-1.5)).toBe('-1.5');
    expect(jcs('hi')).toBe('"hi"');
  });

  it('sorts object keys lexically', () => {
    const a = jcs({ b: 1, a: 2 });
    expect(a).toBe('{"a":2,"b":1}');
  });

  it('drops undefined values', () => {
    expect(jcs({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it('handles nested structures deterministically', () => {
    const out = jcs({
      z: [1, 2, { d: 4, a: 3 }],
      a: 'x',
    });
    expect(out).toBe('{"a":"x","z":[1,2,{"a":3,"d":4}]}');
  });

  it('escapes control characters and quotes', () => {
    expect(jcs('a"b')).toBe('"a\\"b"');
    expect(jcs('\n')).toBe('"\\n"');
  });

  it('throws on non-finite numbers', () => {
    expect(() => jcs(NaN)).toThrow();
    expect(() => jcs(Infinity)).toThrow();
  });

  it('throws on unsupported types', () => {
    expect(() => jcs(Symbol('x') as unknown)).toThrow();
  });
});
