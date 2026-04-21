// Allowlist unit tests. Kept pure to survive Agent A's Wave 3 TS rewrite.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseAllowlist,
  resolveRole,
  requireAdmin,
} = require('../allowlist');

describe('parseAllowlist', () => {
  it('splits a comma list and lowercases entries', () => {
    const s = parseAllowlist('0xABC, 0xdef ,0x123');
    expect(s.has('0xabc')).toBe(true);
    expect(s.has('0xdef')).toBe(true);
    expect(s.has('0x123')).toBe(true);
    expect(s.size).toBe(3);
  });

  it('returns an empty set for undefined / empty input', () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist('').size).toBe(0);
    expect(parseAllowlist(null).size).toBe(0);
  });

  it('skips empty entries created by trailing commas', () => {
    const s = parseAllowlist('0xabc,,0xdef,');
    expect(s.size).toBe(2);
  });
});

describe('resolveRole', () => {
  beforeEach(() => {
    process.env.ADMIN_WALLETS = '0xAbC123';
  });
  it('returns admin role for an allowlisted wallet (case-insensitive)', () => {
    expect(resolveRole('0xabc123').role).toBe('admin');
    expect(resolveRole('0xABC123').role).toBe('admin');
  });
  it('returns null for an unlisted wallet', () => {
    expect(resolveRole('0xdead')).toBeNull();
    expect(resolveRole('')).toBeNull();
    expect(resolveRole(null)).toBeNull();
  });
});

describe('requireAdmin middleware', () => {
  beforeEach(() => {
    process.env.ADMIN_WALLETS = '0xallow';
  });

  function fakeReq(wallet) {
    return {
      header(name) {
        if (name.toLowerCase() === 'x-admin-wallet') return wallet || '';
        return '';
      },
    };
  }
  function fakeRes() {
    return {
      status(s) {
        this._status = s;
        return this;
      },
      json(body) {
        this._body = body;
        return this;
      },
    };
  }

  it('calls next() and attaches req.adminRole on allowlisted wallet', () => {
    const req = fakeReq('0xallow');
    const res = fakeRes();
    let called = false;
    requireAdmin(req, res, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(req.adminRole).toMatchObject({ role: 'admin' });
  });

  it('returns 403 and does not call next() for unlisted wallets', () => {
    const req = fakeReq('0xdead');
    const res = fakeRes();
    let called = false;
    requireAdmin(req, res, () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(res._status).toBe(403);
    expect(res._body.error).toBe('admin_wallet_not_allowlisted');
  });
});
