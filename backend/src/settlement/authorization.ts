/**
 * Authorization layer for the x402 client-side auto-signer.
 *
 * - storeAuthorization: persist the user-signed EIP-3009 pre-authorization
 *   that bounds the Electron session key's spending authority.
 * - getActive: fetch the live (non-revoked, not-expired) auth for a policy.
 * - consume: idempotent charge against the remaining cap. Uses a
 *   conditional UPDATE so two concurrent settlements cannot over-consume;
 *   the SQL `consumed_usdc + $1 <= cap_usdc AND revoked_at IS NULL AND
 *   valid_until > NOW()` predicate is the single atomic gate.
 * - revoke: mark auth revoked. Subsequent consume() calls return null.
 *
 * Signature verification: we trust the Gateway to verify the EIP-3009
 * signature against its own domain when it settles. Our server-side check is
 * structural (addresses well-formed, amounts non-negative, chainId matches,
 * validity not already expired). This mirrors what Circle's
 * `BatchFacilitatorClient` asserts on its side.
 */
import { getAddress, isAddress } from 'ethers';
import type { QueryResult } from 'pg';
import { getPool, type Queryable } from '../db/pool';
import type {
  AuthorizationInput,
  HexString,
  StoredAuthorization,
} from './types';
import { toUnits } from './money';

const EXPECTED_CHAIN_ID = 5_042_002; // Arc testnet

function rowToAuth(row: Record<string, unknown>): StoredAuthorization {
  return {
    authId: row['auth_id'] as string,
    policyId: row['policy_id'] as string,
    userWallet: row['user_wallet'] as HexString,
    sessionPubkey: row['session_pubkey'] as HexString,
    capUsdc: row['cap_usdc'] as string,
    consumedUsdc: row['consumed_usdc'] as string,
    validFrom: new Date(row['valid_from'] as string | Date),
    validUntil: new Date(row['valid_until'] as string | Date),
    signature: row['signature'] as HexString,
    nonce: row['nonce'] as HexString,
    chainId: Number(row['chain_id']),
    revokedAt: row['revoked_at'] ? new Date(row['revoked_at'] as string | Date) : null,
    createdAt: new Date(row['created_at'] as string | Date),
  };
}

function assertAddress(v: string, label: string): HexString {
  if (!isAddress(v)) throw new Error(`${label} is not a valid EVM address: ${v}`);
  return getAddress(v) as HexString;
}

function assertHexNonce(v: string): HexString {
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) {
    throw new Error(`nonce must be 32-byte hex (0x + 64 chars): ${v}`);
  }
  return v.toLowerCase() as HexString;
}

function assertHexSignature(v: string): HexString {
  if (!/^0x[0-9a-fA-F]{130}$/.test(v)) {
    throw new Error(`signature must be 65-byte hex (0x + 130 chars): ${v.slice(0, 10)}...`);
  }
  return v.toLowerCase() as HexString;
}

/**
 * Validates and persists a user authorization. Throws on any structural issue.
 * The returned object is exactly what was saved, with all DB defaults applied.
 */
export async function storeAuthorization(
  input: AuthorizationInput,
  db: Queryable = getPool(),
): Promise<StoredAuthorization> {
  const chainId = input.chainId ?? EXPECTED_CHAIN_ID;
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`chainId must be ${EXPECTED_CHAIN_ID} (Arc testnet); got ${chainId}`);
  }
  const userWallet = assertAddress(input.userWallet, 'userWallet');
  const sessionPubkey = assertAddress(input.sessionPubkey, 'sessionPubkey');
  const signature = assertHexSignature(input.signature);
  const nonce = assertHexNonce(input.nonce);

  const capUnits = toUnits(input.capUsdc);
  if (capUnits <= 0n) throw new Error('capUsdc must be > 0');

  const validFrom = input.validFrom ?? new Date();
  if (input.validUntil.valueOf() <= validFrom.valueOf()) {
    throw new Error('validUntil must be after validFrom');
  }
  if (input.validUntil.valueOf() <= Date.now()) {
    throw new Error('validUntil is already in the past');
  }

  const res: QueryResult = await db.query(
    `INSERT INTO x402_authorizations
      (policy_id, user_wallet, session_pubkey, cap_usdc, valid_from, valid_until,
       signature, nonce, chain_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.policyId,
      userWallet,
      sessionPubkey,
      input.capUsdc,
      validFrom,
      input.validUntil,
      signature,
      nonce,
      chainId,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error('INSERT x402_authorizations returned no rows');
  return rowToAuth(row);
}

/** Returns the current non-revoked authorization for a policy, or null. */
export async function getActive(
  policyId: string,
  db: Queryable = getPool(),
): Promise<StoredAuthorization | null> {
  const res: QueryResult = await db.query(
    `SELECT * FROM x402_authorizations
     WHERE policy_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [policyId],
  );
  const row = res.rows[0];
  if (!row) return null;
  const auth = rowToAuth(row);
  if (auth.validUntil.valueOf() <= Date.now()) return null;
  return auth;
}

/** Returns an auth by id regardless of revoked/expired state. */
export async function getById(
  authId: string,
  db: Queryable = getPool(),
): Promise<StoredAuthorization | null> {
  const res: QueryResult = await db.query(
    `SELECT * FROM x402_authorizations WHERE auth_id = $1`,
    [authId],
  );
  const row = res.rows[0];
  return row ? rowToAuth(row) : null;
}

export class ConsumeRejected extends Error {
  constructor(
    public readonly reason:
      | 'cap_exceeded'
      | 'revoked'
      | 'expired'
      | 'not_found',
    public readonly authId: string,
    public readonly amountUsdc: string,
  ) {
    super(`consume rejected (${reason}) for auth ${authId} amount ${amountUsdc}`);
  }
}

/**
 * Idempotent conditional consume.
 *
 * The SQL predicate performs all four checks atomically:
 *  - auth still exists,
 *  - not revoked,
 *  - not expired,
 *  - consumed + delta does not exceed cap.
 *
 * If ANY fails, rowCount = 0 and we fetch the row to report a specific reason.
 * Concurrency: two parallel callers cannot both pass this predicate because
 * Postgres serializes the UPDATE under MVCC row locks.
 */
export async function consume(
  authId: string,
  amountUsdc: string,
  db: Queryable = getPool(),
): Promise<StoredAuthorization> {
  const amountUnits = toUnits(amountUsdc);
  if (amountUnits < 0n) {
    throw new Error(`amountUsdc must be >= 0: ${amountUsdc}`);
  }
  if (amountUnits === 0n) {
    // Zero-dollar consume is a no-op that must still return the current state.
    const current = await getById(authId, db);
    if (!current) throw new ConsumeRejected('not_found', authId, amountUsdc);
    return current;
  }
  const res: QueryResult = await db.query(
    `UPDATE x402_authorizations
     SET consumed_usdc = consumed_usdc + $1
     WHERE auth_id = $2
       AND consumed_usdc + $1 <= cap_usdc
       AND revoked_at IS NULL
       AND valid_until > NOW()
     RETURNING *`,
    [amountUsdc, authId],
  );
  const row = res.rows[0];
  if (row) return rowToAuth(row);

  const current = await getById(authId, db);
  if (!current) throw new ConsumeRejected('not_found', authId, amountUsdc);
  if (current.revokedAt) throw new ConsumeRejected('revoked', authId, amountUsdc);
  if (current.validUntil.valueOf() <= Date.now()) {
    throw new ConsumeRejected('expired', authId, amountUsdc);
  }
  throw new ConsumeRejected('cap_exceeded', authId, amountUsdc);
}

/** Irrevocably marks an authorization revoked. Idempotent. */
export async function revoke(
  authId: string,
  db: Queryable = getPool(),
): Promise<StoredAuthorization | null> {
  const res: QueryResult = await db.query(
    `UPDATE x402_authorizations
     SET revoked_at = NOW()
     WHERE auth_id = $1 AND revoked_at IS NULL
     RETURNING *`,
    [authId],
  );
  const row = res.rows[0];
  return row ? rowToAuth(row) : null;
}

export const __testing = { rowToAuth };
