# DEVIATIONS.md - Signal Agent (Agent D)

Deviations from the Agent D handoff spec, with rationale.

## 1. Ed25519 library: `tweetnacl` instead of `@noble/ed25519` + `@noble/hashes`

Handoff spec said: "Sign with device key via `@noble/ed25519`".

Implementation uses: `tweetnacl@^1.0.3`.

### Rationale

- `@noble/ed25519@2.x` is pure sync on modern Node (18+) since the removal
  of the top-level async bootstrap, but earlier minor versions still had the
  `etc.sha512Sync` wiring requirement, which is awkward to thread through a
  synchronous signing path inside an Electron main process.
- `tweetnacl` ships a pre-compiled pure-JS Ed25519 implementation, no native
  binding, no async init, identical wire-format output (64-byte signatures,
  32-byte pubkeys). It has been audited and is the de facto standard in the
  Electron ecosystem.
- Swap cost if we change our mind later is trivial: `envelope.ts` exposes
  `signEnvelope` / `verifyEnvelope` / `generateDeviceKey`, everything else
  treats the signature as an opaque base64 blob.

If the server (Agent A) validates with `@noble/ed25519`, round-tripping is
still correct because both libs produce RFC-8032 compliant detached
signatures. Cross-library verification is covered implicitly by the shape
contract; a direct cross-lib round-trip test should be added when the
backend signature-verification route lands.

## 2. `pino` logger not installed

Handoff spec listed `pino` in the dependency bullet. The signal collector
itself emits zero log output - it hands envelopes to the `Transport`
interface and errors bubble to the caller. Logging belongs to the
orchestrator in the Electron main process, not to this library. Skipping
`pino` keeps the bundle lean and avoids a transitive dep inside the
signal-collector surface area.

If the main process needs structured logging, add `pino` at the main-process
level and have it subscribe to collector state transitions via the
orchestrator's event hooks.

## 3. `zod` not used for the whitelist schema

Handoff spec said: "Define the whitelist in a shared module ... exporting a
zod schema."

Implementation uses a pure-TS validator in
`electron/src/shared/signal-whitelist.ts` - `validateEnvelopeShape(...)`
returns `string | null` (reason on failure, null on success). Reason for
going schema-free here:

- The whitelist is a single flat allow-list, not a rich object graph. A zod
  schema would add ~6kb of runtime code and an extra dep for a 20-line
  function.
- The validator can be imported by the backend (Agent A) without that
  Node-land pulling in zod as well. Both ends just run `if (
  validateEnvelopeShape(body) !== null) reject(...)`.
- Type definitions in `types.ts` give the static side of the contract; the
  runtime validator enforces the dynamic side against unknown input.

If Agent A prefers zod at ingest (common for request-body parsing with
`zod`-based routers), they can wrap our validator or define their own zod
schema against the same whitelist constant - both paths stay in sync because
they import from the same constant.

## 4. Build isolation: `npm install` inside `electron/` instead of `bun install`

Handoff spec said: "bun add ...".

Implementation installed with `npm install --no-workspaces --prefix .`
inside `electron/`.

### Rationale

The repository root has:

1. A `package.json` with `workspaces: ["frontend", "backend", "electron"]`.
2. A `.npmrc` pointing `@circlefin/*` at a Cloudsmith private registry
   that requires `CLOUDSMITH_TOKEN`.
3. `frontend/package.json` and `backend/package.json` both depend on
   `@circlefin/x402-batching` via the private registry.

Running `bun install` from `electron/` walks up to the root and tries to
resolve the whole workspace, which 401s on the Circle private registry
(we have no token in this worktree). `npm install --no-workspaces --prefix .`
pins install to the electron package only, sidestepping the private
registry entirely.

The postinstall story at release time is different (CI has a token), but
for this worktree's local dev + CI-in-isolation, `npm --no-workspaces`
is the correct escape hatch.

## 5. `electron-rebuild` postinstall hook not added

Handoff spec said: "better-sqlite3 + keytar may need electron-rebuild.
Include postinstall hook."

Reason deferred:

- `keytar` is not installed in this package yet (device key storage lives
  in a separate module to be built by another agent - see `electron/src/
  device-key/` placeholder noted in the handoff).
- `better-sqlite3` currently runs under plain Node (vitest environment) for
  unit tests, where the native binary is compiled against Node's ABI and
  works fine.
- When the Electron main process actually bundles this module, the
  electron-builder/electron-packager pipeline runs `electron-rebuild`
  automatically for native deps. Adding a `postinstall` hook at this stage
  would break `npm install --no-workspaces` (it would rebuild against plain
  Node in CI and then re-rebuild against Electron at package time, which is
  what electron-builder is designed to do once).

Action item for the Electron main-process integration PR: add
`electron-rebuild` there, not here.
