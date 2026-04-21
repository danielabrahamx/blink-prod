// Express router for the Claims v1 HTTP surface.
//
// Routes:
//  POST   /claims/submit            user intake + eligibility + SLA stamp
//  GET    /claims/:id               user or admin — user must match wallet
//  GET    /claims/user/:wallet      user history
//  POST   /claims/:id/approve       admin — triggers payout
//  POST   /claims/:id/deny          admin — writes denial_reason
//  POST   /claims/:id/review        admin — sanctions + flags
//  GET    /claims/admin/queue       admin — pending claims sorted by SLA
//  GET    /claims/admin/:id         admin — full inspector payload

import express, { type Request, type Response, type NextFunction } from 'express';
import type { ClaimsRepository } from './repository.js';
import { defaultRepository } from './repository.js';
import { submitClaim } from './intake.js';
import { decide, isAdminWallet, submitForReview, buildInspector } from './review.js';
import { executePayout } from './payout.js';
import type { ReserveClient } from './payout.js';
import type { SanctionsScreener } from './sanctions.js';
import { makeSanctionsScreener } from './sanctions.js';
import type { AdminContext } from './types.js';

export interface CreateRouterOptions {
  repository?: ClaimsRepository;
  reserveClient: ReserveClient;
  sanctionsScreener?: SanctionsScreener;
  clock?: () => number;
  adminWallets?: string[];
}

function requireAdmin(adminWallets: string[] | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const wallet =
      (req.header('x-admin-wallet') ?? '').trim() ||
      ((req.body as { adminWallet?: string } | undefined)?.adminWallet ?? '').trim();
    const allowed = adminWallets ?? deriveAdminWallets();
    if (!wallet) {
      res.status(401).json({ error: 'admin_wallet_required' });
      return;
    }
    const lowered = wallet.toLowerCase();
    const permitted = allowed.map((w) => w.toLowerCase()).includes(lowered);
    if (!permitted) {
      res.status(403).json({ error: 'not_an_admin' });
      return;
    }
    const admin: AdminContext = {
      adminId: req.header('x-admin-id') ?? wallet,
      wallet,
    };
    (req as Request & { admin?: AdminContext }).admin = admin;
    next();
  };
}

function deriveAdminWallets(): string[] {
  const src = process.env.ADMIN_WALLETS ?? process.env.VITE_ADMIN_WALLETS ?? '';
  return src
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
}

function userScoped(req: Request): string {
  return (
    req.header('x-user-wallet') ??
    ((req.query as { wallet?: string } | undefined)?.wallet ?? '') ??
    ''
  );
}

export function createClaimsRouter(options: CreateRouterOptions): express.Router {
  const {
    repository = defaultRepository,
    reserveClient,
    sanctionsScreener = makeSanctionsScreener(),
    clock = Date.now,
    adminWallets,
  } = options;
  const gate = requireAdmin(adminWallets);

  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));

  // POST /claims/submit
  router.post('/submit', (req, res) => {
    const out = submitClaim(req.body ?? {}, { repository, clock });
    res.status(out.status).json(out);
  });

  // GET /claims/admin/queue
  router.get('/admin/queue', gate, (req, res) => {
    const status = req.query.status
      ? String(req.query.status).split(',')
      : ['submitted', 'under_review'];
    const filtered = repository
      .listClaims({ status: status as Array<'submitted' | 'under_review'> })
      .sort((a, b) => a.reviewByAt - b.reviewByAt);
    res.json({ claims: filtered });
  });

  // GET /claims/admin/:id
  router.get('/admin/:id', gate, (req, res) => {
    const inspector = buildInspector(req.params.id, repository);
    if ('error' in inspector) {
      res.status(404).json(inspector);
      return;
    }
    res.json({ inspector });
  });

  // POST /claims/:id/review
  router.post('/:id/review', gate, async (req, res) => {
    const reviewer = (req as Request & { admin: AdminContext }).admin;
    const result = await submitForReview(req.params.id, reviewer, {
      repository,
      sanctionsScreener,
      clock,
    });
    if (!result.ok) {
      res.status(result.error === 'claim_not_found' ? 404 : 409).json(result);
      return;
    }
    res.json(result);
  });

  // POST /claims/:id/approve
  router.post('/:id/approve', gate, async (req, res) => {
    const reviewer = (req as Request & { admin: AdminContext }).admin;
    const result = await decide(
      req.params.id,
      'approve',
      reviewer,
      { repository, sanctionsScreener, reserveClient, clock },
      undefined,
    );
    res.status(result.ok ? 200 : 409).json(result);
  });

  // POST /claims/:id/deny
  router.post('/:id/deny', gate, async (req, res) => {
    const reviewer = (req as Request & { admin: AdminContext }).admin;
    const reason = String((req.body as { reason?: string })?.reason ?? '').trim();
    const result = await decide(
      req.params.id,
      'deny',
      reviewer,
      { repository, sanctionsScreener, reserveClient, clock },
      reason,
    );
    if (!result.ok) {
      res.status(result.error === 'reason_required' ? 400 : 409).json(result);
      return;
    }
    res.json(result);
  });

  // POST /claims/:id/payout - manual retry (admin only)
  router.post('/:id/payout', gate, async (req, res) => {
    const payout = await executePayout(req.params.id, {
      repository,
      reserveClient,
      clock,
    });
    res.status(payout.ok ? 200 : 502).json(payout);
  });

  // GET /claims/user/:wallet
  router.get('/user/:wallet', (req, res) => {
    const caller = userScoped(req);
    if (
      caller &&
      caller.toLowerCase() !== req.params.wallet.toLowerCase() &&
      !isAdminWallet(caller)
    ) {
      res.status(403).json({ error: 'wallet_mismatch' });
      return;
    }
    const claims = repository.listByWallet(req.params.wallet);
    res.json({ claims });
  });

  // GET /claims/:id
  router.get('/:id', (req, res) => {
    const claim = repository.getClaim(req.params.id);
    if (!claim) {
      res.status(404).json({ error: 'claim_not_found' });
      return;
    }
    const caller = userScoped(req);
    if (
      caller &&
      caller.toLowerCase() !== claim.policyholderWallet.toLowerCase() &&
      !isAdminWallet(caller)
    ) {
      res.status(403).json({ error: 'wallet_mismatch' });
      return;
    }
    const receipt = repository.getReceipt(claim.id);
    res.json({ claim, receipt });
  });

  return router;
}

export { requireAdmin };
