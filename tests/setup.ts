import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  process.env.TZ = 'UTC';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
});
