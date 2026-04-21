// Vitest setup: registers @testing-library matchers and a minimal
// Response/URL stub so admin tests can run under jsdom.

import '@testing-library/jest-dom/vitest';

// jsdom ships fetch in newer releases but not all. Tests stub fetch per case.
const urlApi = globalThis.URL as unknown as {
  createObjectURL?: (b: unknown) => string;
  revokeObjectURL?: (u: string) => void;
};
if (typeof urlApi.createObjectURL === 'undefined') {
  urlApi.createObjectURL = () => 'blob:mock';
  urlApi.revokeObjectURL = () => undefined;
}
