import type { Request, Response } from 'express';

/**
 * Legacy `/api/insure/active` and `/api/insure/idle` handlers.
 *
 * The hackathon-era frontend depends on the contract of these endpoints
 * unchanged: JSON body with `{ covered, mode, timestamp, duration, payer,
 * amount, network, transaction }`. The x402 gateway middleware runs before
 * these handlers and attaches `req.payment` in real mode; in local mode
 * the handler mirrors that shape from request metadata.
 *
 * The pilot-era rich flow (signed envelopes + per-policy multipliers) lives
 * in /signals and the new /policies/* surface.
 */

// We don't have the @circlefin/x402-batching types declared. Fall back to
// runtime property access for the `payment` object.
interface PaymentMeta {
  payer?: string;
  amount?: string;
  network?: string;
  transaction?: string;
}

function extractPayment(req: Request): PaymentMeta {
  const raw = (req as Request & { payment?: PaymentMeta }).payment;
  return raw ?? {};
}

let totalPremiumsUsdc = 0;

export function getTotalPremiumsUsdc(): number {
  return totalPremiumsUsdc;
}

export function _resetLegacyCountersForTests(): void {
  totalPremiumsUsdc = 0;
}

function respond(
  req: Request,
  res: Response,
  mode: 'active' | 'idle',
  pricePerSecond: number,
): void {
  totalPremiumsUsdc += pricePerSecond;
  const payment = extractPayment(req);
  res.json({
    covered: true,
    mode,
    timestamp: new Date().toISOString(),
    duration: '1s',
    payer: payment.payer,
    amount: payment.amount,
    network: payment.network,
    transaction: payment.transaction,
  });
}

export function insureActiveHandler(req: Request, res: Response): void {
  respond(req, res, 'active', 0.000005);
}

export function insureIdleHandler(req: Request, res: Response): void {
  respond(req, res, 'idle', 0.00001);
}
