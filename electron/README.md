# blink-electron

Windows-first Electron desktop shell for Blink. Hosts the signal agent
(Module 1), session + device keys, and the x402 client-side auto-signer
(Module 3). Wraps the existing React UI from `../frontend/src/` via a
Vite alias so every UI change ships to both the web demo and the
desktop app.

## Layout

```
electron/
  src/
    main/              main process (BrowserWindow, IPC, menu, logger, updater)
    preload/           contextBridge surface exposed as window.electron
    renderer/          minimal React mount that renders ../frontend/src/App.tsx
    session-key/       Ed25519 session key, stored in Windows Credential Manager via keytar
    device-key/        Ed25519 device-identity key (separate namespace)
    signal-collector/  interface stub -- Agent D implements on feat/signal-agent
    auto-signer/       interface stub -- Agent F implements on feat/settlement-x402
    shared/            types + IPC channel names + config keys
    __mocks__/         in-memory keytar / electron-store / electron mocks for vitest
  resources/           icon + build resources
  electron.vite.config.ts
  electron-builder.yml NSIS config, Windows x64, unsigned for pilot
  vitest.config.ts
  tsconfig.json        strict TS, @main / @preload / @renderer / @shared / @frontend aliases
```

## Commands

All commands assume you `cd electron/` first. Dependencies are installed with
`bun install` (or `npm install`) at the repo root because electron/ is a
workspace member.

| Command | Purpose |
|---|---|
| `bun run dev` | Launch electron-vite -- spins up main + preload + renderer pipelines in watch mode and opens the Electron window. **No separate `cd frontend && npm run dev` required**; the `@frontend` alias pulls the React source into the renderer build. |
| `bun run build` | Build all three targets into `out/{main,preload,renderer}/`. |
| `bun run typecheck` | `tsc --noEmit` across the whole package. |
| `bun run test` | vitest in run mode. Tests for session-key + device-key + IPC + window. |
| `bun run test:watch` | vitest in watch mode. |
| `bun run package:win` | Build then invoke `electron-builder --win --x64 --publish=never`. Produces `dist-installer/Blink-<version>-x64.exe`. |
| `bun run clean` | Remove `out/` and `dist-installer/`. |

### Dev

`bun run dev` launches the Electron window pointed at the electron-vite
renderer dev server. The React app (`frontend/src/App.tsx`) is loaded via
the `@frontend` Vite alias -- there is no separate Vite instance for
`frontend/`, and no `cd frontend && npm run dev` step.

Press Ctrl+Shift+I (or use View > Toggle DevTools) to open the Chromium
devtools against the renderer.

### Package Windows installer

```
bun run package:win
```

Produces `electron/dist-installer/Blink-<version>-x64.exe`. The NSIS config
(`electron-builder.yml`) sets:

- `oneClick: false` + `allowToChangeInstallationDirectory: true` -- user sees
  the standard install wizard and can pick the install path.
- `perMachine: false` -- installs per-user under
  `C:\Users\<user>\AppData\Local\Programs\Blink`.
- `createDesktopShortcut: true`, `createStartMenuShortcut: true`.

The installer is **unsigned** in the pilot. Windows SmartScreen will warn on
first run; users click More info > Run anyway. When the EV cert arrives
(Phase 6), flip `signAndEditExecutable: true` and add the signing config to
`electron-builder.yml`.

## Runtime paths

| Concern | Path |
|---|---|
| Logs | `%APPDATA%\Blink\logs\main.log` (JSON lines from pino) |
| Config store | `%APPDATA%\Blink\config.json` (electron-store) |
| Session key | Windows Credential Manager -- generic credential `Blink:session-key` |
| Device key | Windows Credential Manager -- generic credential `Blink:device-key` |

Open the logs folder from Help > Open Logs Folder in the app menu.

## IPC contract

Renderer accesses the main process **only** via `window.electron`. The full
surface lives at `src/shared/constants.ts` (channel names) and
`src/preload/api.ts` (typed API). Every channel has a matching
`ipcMain.handle` registration in `src/main/ipc.ts` -- tests assert the two
stay in sync.

```ts
window.electron.session.getPublicKey() // -> hex string
window.electron.session.rotate()
window.electron.session.sign(bytes)

window.electron.device.getPublicKey()
window.electron.device.fingerprint() // sha256(host || mac || platform)

window.electron.signals.start(policyId)
window.electron.signals.stop()
window.electron.signals.getLatest() // SignalEnvelope | null

window.electron.settlement.registerAuthorization(eip3009Auth)
window.electron.settlement.getStatus()

window.electron.config.get('backendUrl')
window.electron.config.set('backendUrl', 'http://localhost:3001')

window.electron.telemetry.track('event', { prop: 1 })
```

## Security posture

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` on the
  renderer.
- CSP enforced at the main-process level via `webRequest.onHeadersReceived`,
  with a belt-and-braces `<meta>` tag in `index.html`.
- `will-navigate` blocks off-origin navigations so a bug in the React app
  cannot load remote HTML into the Electron window.
- Private keys never leave the main process; the renderer can only request
  signatures over the IPC boundary.

## Tests

`bun run test` executes:

- `src/session-key/index.test.ts` -- generate/retrieve/rotate/sign roundtrip, corruption path, reset.
- `src/device-key/index.test.ts` -- separate namespace from session, fingerprint stability.
- `src/main/ipc.test.ts` -- every advertised channel has a handler; preload exposes the expected top-level namespaces.
- `src/main/window.test.ts` -- window-state defaults + renderer entry resolver.

`keytar`, `electron-store`, and `electron` are aliased to in-memory mocks in
`vitest.config.ts` so the suite runs on any platform without a real
credential store or an Electron binary.

## Known limitations

- **Unsigned Windows builds** trigger SmartScreen on install. Tracked for Phase 6 (EV cert).
- **Mac target deferred.** `electron-builder.yml` sets `mac.identity: null` so
  the config does not blow up on macOS dev machines, but no `.dmg` target is
  built. Add the Mac target once notarization is set up.
- **electron-updater disabled.** Stub wired in `src/main/updater.ts`; flip
  `ENABLED` once artifacts are published.
- **keytar native rebuild**: `postinstall` runs `electron-builder install-app-deps`
  which rebuilds `keytar` for the Electron ABI. On Windows, if the rebuild
  fails, check that the Windows 10 SDK and Visual Studio Build Tools
  (C++ workload) are installed, then rerun `bun run postinstall`.

## Handoff

- `src/signal-collector/` and `src/auto-signer/` export contracts only. Agent D
  and Agent F fill in the implementations on their respective branches.
- Wave 3 wires the integration tests -- this package ships all four green:
  `typecheck`, `test`, `build`, and a wired-but-not-yet-run `package:win`.
