import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Refuses to test against an old copy of the shared Kotlin rules (see scripts/kotlinFresh.mjs).
    globalSetup: ['./scripts/kotlinFreshSetup.mjs'],
    // Tests run in a time zone far from the UK and from CI's UTC, so a test or a text that mixes up
    // UTC and local time fails everywhere, not only for users abroad. (Set here, in each test
    // worker: Node on Windows ignores a TZ variable set before it starts.)
    env: { TZ: 'America/Los_Angeles' },
  },
});
