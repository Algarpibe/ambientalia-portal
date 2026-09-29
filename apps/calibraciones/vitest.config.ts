import { defineConfig } from 'vitest/config';

// Pure-logic tests only (format, parsing, CSV, draft mapping, API errors): the
// node environment is enough, so there is no jsdom and none of the Node 22+
// localStorage collision the portal suite works around.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
