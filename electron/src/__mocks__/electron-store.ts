// electron-store mock for vitest.
// Behaves as a typed Map honouring the `defaults` constructor option.

export default class Store<T extends Record<string, unknown>> {
  private data: Map<string, unknown>;

  constructor(options?: { defaults?: T }) {
    this.data = new Map<string, unknown>();
    if (options?.defaults) {
      for (const [k, v] of Object.entries(options.defaults)) {
        this.data.set(k, v);
      }
    }
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.data.get(key as string) as T[K];
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data.set(key as string, value);
  }

  has(key: keyof T): boolean {
    return this.data.has(key as string);
  }

  delete(key: keyof T): void {
    this.data.delete(key as string);
  }

  clear(): void {
    this.data.clear();
  }

  get store(): T {
    const out = {} as T;
    for (const [k, v] of this.data.entries()) {
      (out as Record<string, unknown>)[k] = v;
    }
    return out;
  }
}
