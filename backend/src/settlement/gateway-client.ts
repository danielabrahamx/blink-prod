/**
 * Wraps `@circlefin/x402-batching` into a typed, testable surface.
 *
 * The module exports a small factory + an interface so the accrual loop and
 * tests can swap the real Circle middleware for a mock. In prod this loads
 * `createGatewayMiddleware` lazily (the package is a thin pass-through over
 * HTTP; we only need it when the backend actually issues 402s).
 *
 * Key responsibility: replace the `setTimeout(3000)` race at server.js:184
 * with a promise that resolves once the Circle settlement webhook confirms
 * the receipt, and rejects on timeout / failure.
 *
 * The caller registers a receiptId; the webhook handler pokes the resolver
 * when Circle reports confirmation. If no webhook arrives within
 * `DEFAULT_TIMEOUT_MS`, the promise rejects and the receipt is marked failed.
 */
import type { CircleWebhookEvent } from './types';

export const DEFAULT_TIMEOUT_MS = 30_000;

type Resolver = { resolve: (value: CircleWebhookEvent) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

export interface GatewayClientOptions {
  sellerAddress: string;
  networks: readonly string[];
  timeoutMs?: number;
}

/** Exposed to server.js so the Express app can mount the Circle middleware. */
export interface GatewayFacade {
  /** Returns an express-compatible 402 middleware. */
  requireMiddleware(pricing: string): unknown;
  /**
   * Register interest in confirmation for a receipt. Resolves when a webhook
   * with matching receiptId is delivered, or rejects on timeout/failure.
   */
  awaitConfirmation(receiptId: string): Promise<CircleWebhookEvent>;
  /**
   * Webhook handler calls this to poke waiters. Returns true if a waiter was
   * found and resolved; false otherwise (e.g., late webhook after timeout).
   */
  notify(event: CircleWebhookEvent, receiptId: string | undefined): boolean;
  /** For tests and graceful shutdown. */
  rejectAll(reason: string): void;
}

export function createGatewayFacade(opts: GatewayClientOptions): GatewayFacade {
  const waiters = new Map<string, Resolver>();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function loadRealMiddleware(pricing: string): unknown {
    // Lazy-require so tests that never exercise the real path don't need the
    // Circle private package resolvable.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('@circlefin/x402-batching/server') as {
      createGatewayMiddleware?: (cfg: unknown) => { require: (p: string) => unknown };
    };
    if (!pkg.createGatewayMiddleware) {
      throw new Error('createGatewayMiddleware not exported by @circlefin/x402-batching');
    }
    const gateway = pkg.createGatewayMiddleware({
      sellerAddress: opts.sellerAddress,
      networks: [...opts.networks],
    });
    return gateway.require(pricing);
  }

  return {
    requireMiddleware: loadRealMiddleware,
    awaitConfirmation(receiptId: string): Promise<CircleWebhookEvent> {
      return new Promise<CircleWebhookEvent>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(receiptId);
          reject(new Error(`gateway confirmation timeout for receipt ${receiptId}`));
        }, timeoutMs);
        waiters.set(receiptId, { resolve, reject, timer });
      });
    },
    notify(event: CircleWebhookEvent, receiptId: string | undefined): boolean {
      if (!receiptId) return false;
      const w = waiters.get(receiptId);
      if (!w) return false;
      clearTimeout(w.timer);
      waiters.delete(receiptId);
      if (event.type === 'settlement.failed' || event.type === 'transaction.failed') {
        w.reject(new Error(`gateway reported failure: ${event.type}`));
      } else {
        w.resolve(event);
      }
      return true;
    },
    rejectAll(reason: string): void {
      for (const [, w] of waiters) {
        clearTimeout(w.timer);
        w.reject(new Error(reason));
      }
      waiters.clear();
    },
  };
}

/**
 * Helper used by server.js to replace the admin deposit-reserve race. Awaits a
 * Circle DCW transaction.confirmed webhook keyed on the Circle txId.
 */
export async function awaitTxConfirmed(
  facade: GatewayFacade,
  txId: string,
  timeoutMs?: number,
): Promise<CircleWebhookEvent> {
  void timeoutMs; // reserved; facade owns the timer
  return facade.awaitConfirmation(txId);
}
