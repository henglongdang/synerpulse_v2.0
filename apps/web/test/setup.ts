import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
// Type-only: brings in the matcher typings for `expect(...)` without loading the adapter at runtime.
import type {} from '@testing-library/jest-dom/vitest';

// Register jest-dom matchers on the same `expect` instance the tests use. (The
// '@testing-library/jest-dom/vitest' adapter resolves vitest on its own; on Windows, a drive-letter
// casing difference between invocation paths can load a second vitest copy and the matchers vanish.)
expect.extend(matchers);

afterEach(() => cleanup());

// jsdom lacks ResizeObserver; charts measure their container with it.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
