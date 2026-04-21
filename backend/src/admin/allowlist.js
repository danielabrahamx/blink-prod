// Admin wallet allowlist + role resolver.
//
// The allowlist lives in env (ADMIN_WALLETS = comma-separated, case-insensitive).
// Wave 3 may replace this with a DB-backed table + role rows. Until then,
// every listed wallet is role=admin; unlisted wallets resolve to 403.
//
// Agent G's worktree provides the shape; Agent A may merge different
// middleware wiring in Wave 3 — keep this module pure so it survives rebase.

'use strict';

function parseAllowlist(envValue) {
  if (!envValue || typeof envValue !== 'string') return new Set();
  return new Set(
    envValue
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

function getAllowlist() {
  return parseAllowlist(process.env.ADMIN_WALLETS);
}

function resolveRole(walletAddr) {
  if (!walletAddr) return null;
  const key = String(walletAddr).trim().toLowerCase();
  if (!key) return null;
  const allow = getAllowlist();
  if (allow.has(key)) {
    return { wallet_addr: walletAddr, role: 'admin' };
  }
  return null;
}

function requireAdmin(req, res, next) {
  const wallet = req.header('x-admin-wallet') || '';
  const role = resolveRole(wallet);
  if (!role) {
    res.status(403).json({ error: 'admin_wallet_not_allowlisted' });
    return;
  }
  req.adminRole = role;
  next();
}

module.exports = {
  parseAllowlist,
  getAllowlist,
  resolveRole,
  requireAdmin,
};
