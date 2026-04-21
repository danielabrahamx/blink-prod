// In-memory keytar mock. Vitest aliases `keytar` to this file so tests
// do NOT touch the real Windows Credential Manager / macOS Keychain.

const store = new Map<string, string>();

function k(service: string, account: string): string {
  return `${service}::${account}`;
}

export async function getPassword(service: string, account: string): Promise<string | null> {
  return store.get(k(service, account)) ?? null;
}

export async function setPassword(
  service: string,
  account: string,
  password: string,
): Promise<void> {
  store.set(k(service, account), password);
}

export async function deletePassword(service: string, account: string): Promise<boolean> {
  return store.delete(k(service, account));
}

export async function findCredentials(
  service: string,
): Promise<Array<{ account: string; password: string }>> {
  const prefix = `${service}::`;
  const out: Array<{ account: string; password: string }> = [];
  for (const [key, password] of store.entries()) {
    if (key.startsWith(prefix)) {
      out.push({ account: key.slice(prefix.length), password });
    }
  }
  return out;
}

// Test-only helpers (not part of the real keytar surface).
export function __reset(): void {
  store.clear();
}

export function __size(): number {
  return store.size;
}

export function __seed(service: string, account: string, value: string): void {
  store.set(k(service, account), value);
}

export default {
  getPassword,
  setPassword,
  deletePassword,
  findCredentials,
};
