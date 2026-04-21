# Claims v1 deviations

## Sanctions screening

The design doc requires OFAC + UK list screening via Circle's tooling. As of
2026-04-21 the Circle Compliance Engine is gated on plan entitlement; we have
not yet confirmed the hackathon Circle account has access to
`/v1/w3s/compliance/screening/addresses`.

**Current behaviour:**
- `backend/src/claims/sanctions.ts` calls the live Circle endpoint when
  `CIRCLE_COMPLIANCE_API_KEY` is set in env.
- When the key is absent it falls back to `makeBlocklistScreener()` which
  loads from `SANCTIONS_BLOCKLIST_PATH` (optional JSON file) plus a baseline
  of two well-known test addresses.

**Follow-up (production blocker):**
- Confirm Circle Compliance plan entitlement before launching real money flows.
- Replace or augment the blocklist with a live OFAC + HMT feed if the Circle
  endpoint is unavailable in our plan.

## BlinkReserve payout ABI

`backend/src/claims/payout.ts` calls `BlinkReserve.payoutClaim(bytes32, address, uint256)`,
matching `contracts/mocks/MockBlinkReserve.sol`. The live `BlinkReserve.sol`
must expose the same function signature before real-mode claim payouts can run.

## Runtime TypeScript

`backend/server.js` (CommonJS) now imports from `./src/claims` which resolves
to TypeScript via the `tsx` loader (`node --import tsx/esm server.js`). Tests
run under `bun test` using `bun:test`.
