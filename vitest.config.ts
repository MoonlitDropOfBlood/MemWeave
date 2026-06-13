import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Start a memweave-server before tests run, stop it after.
    // Skip if MEMWEAVE_TEST_URL is set or MEMWEAVE_NO_AUTOSTART=1.
    globalSetup: ['./tests/global-setup.ts']
  }
});
