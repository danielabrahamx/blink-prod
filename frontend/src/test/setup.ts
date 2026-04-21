// Vitest setup: registers @testing-library matchers and DOM stubs for
// admin + claims component tests running under jsdom.

import { expect, afterEach } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

// URL.createObjectURL / revokeObjectURL — PolicyExport CSV download uses these.
const urlApi = globalThis.URL as unknown as {
  createObjectURL?: (b: unknown) => string;
  revokeObjectURL?: (u: string) => void;
};
if (typeof urlApi.createObjectURL === 'undefined') {
  urlApi.createObjectURL = () => 'blob:mock';
  urlApi.revokeObjectURL = () => undefined;
}

// Stub IntersectionObserver for shadcn Select / Radix components.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class IO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  // @ts-expect-error jsdom stub, not a full implementation
  globalThis.IntersectionObserver = IO;
}

if (typeof Element !== 'undefined' && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element !== 'undefined' && !Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => undefined;
}
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined;
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}
