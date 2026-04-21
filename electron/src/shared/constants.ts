// Centralised string constants: IPC channel names and config keys.
// Keeping these in one module prevents drift between main and preload.

export const IPC_CHANNELS = {
  session: {
    getPublicKey: 'blink:session:getPublicKey',
    rotate: 'blink:session:rotate',
    sign: 'blink:session:sign',
  },
  device: {
    getPublicKey: 'blink:device:getPublicKey',
    fingerprint: 'blink:device:fingerprint',
  },
  signals: {
    start: 'blink:signals:start',
    stop: 'blink:signals:stop',
    getLatest: 'blink:signals:getLatest',
  },
  settlement: {
    registerAuthorization: 'blink:settlement:registerAuthorization',
    getStatus: 'blink:settlement:getStatus',
  },
  config: {
    get: 'blink:config:get',
    set: 'blink:config:set',
  },
  telemetry: {
    track: 'blink:telemetry:track',
  },
} as const;

export const CONFIG_KEYS = {
  onboardingComplete: 'onboardingComplete',
  walletAddress: 'walletAddress',
  backendUrl: 'backendUrl',
  rpcUrl: 'rpcUrl',
  homeSsidHashes: 'homeSsidHashes',
  windowState: 'windowState',
  telemetryEnabled: 'telemetryEnabled',
  lastSignalAt: 'lastSignalAt',
} as const;

export const KEYCHAIN = {
  service: 'Blink',
  accounts: {
    sessionKey: 'session-key',
    deviceKey: 'device-key',
  },
} as const;

export const DEFAULT_BACKEND_URL = 'http://localhost:3001';
export const DEFAULT_RPC_URL = 'https://rpc.testnet.arc.network';
