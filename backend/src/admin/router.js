// Express router for the admin portal. Wave 1 wiring; Agent A's TS
// conversion will port these to TypeScript in a later wave.

'use strict';

const express = require('express');
const { requireAdmin } = require('./allowlist');
const repo = require('./repository');
const { policyToCsv } = require('./csv');

function createAdminRouter() {
  const router = express.Router();

  router.get('/role', (req, res) => {
    // Role endpoint: used by the frontend gate. Requires allowlist match.
    const wallet = req.header('x-admin-wallet') || '';
    const { resolveRole } = require('./allowlist');
    const role = resolveRole(wallet);
    if (!role) {
      res.status(403).json({ error: 'admin_wallet_not_allowlisted' });
      return;
    }
    res.json(role);
  });

  router.use(requireAdmin);

  router.get('/policy/:id', async (req, res, next) => {
    try {
      const data = await repo.getPolicy(req.params.id);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  router.post('/replay', express.json(), async (req, res, next) => {
    try {
      const { policy_id, window_start, window_end, model_version } = req.body || {};
      if (!policy_id || !window_start || !window_end || !model_version) {
        res
          .status(400)
          .json({ error: 'missing_fields: policy_id,window_start,window_end,model_version' });
        return;
      }
      const result = await repo.computeReplay({
        policy_id,
        window_start,
        window_end,
        model_version,
      });
      res.json(result);
    } catch (err) {
      if (err && err.statusCode === 400) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.get('/metrics', async (_req, res, next) => {
    try {
      const m = await repo.getMetrics();
      res.json(m);
    } catch (err) {
      next(err);
    }
  });

  router.get('/export/:id', async (req, res, next) => {
    try {
      const policy = await repo.getPolicy(req.params.id);
      const csv = policyToCsv(policy);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="blink-policy-${req.params.id}.csv"`,
      );
      res.send(csv);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createAdminRouter };
