import { defineConfig } from 'vitest/config';

// Explicit, minimal config so Vitest doesn't walk up to the repo root and
// pick up the main app's vite.config.ts (React/Tailwind plugins meant for a
// completely different package) — this service is plain Node/Express, no
// bundler plugins needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
