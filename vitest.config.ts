import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'tests/**/*.test.ts',
      // v0.7.0: server-internal tests live alongside the package they cover
      // (e.g. packages/server/tests/util/resolve-project.test.ts). The
      // include pattern below is required so vitest actually picks them up
      // — without it, those files would be dead code.
      'packages/server/tests/**/*.test.ts',
      // v0.7.0: opencode-plugin-internal tests live under src/ (e.g.
      // packages/opencode-plugin/src/derive-project.test.ts). Same
      // rationale — without this pattern, vitest never sees them.
      'packages/opencode-plugin/src/**/*.test.ts'
    ],
    // Start a memweave-server before tests run, stop it after.
    // Skip if MEMWEAVE_TEST_URL is set or MEMWEAVE_NO_AUTOSTART=1.
    globalSetup: ['./tests/global-setup.ts']
  }
});
