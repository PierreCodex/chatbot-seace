import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    setupFiles: ['test/setup.ts'],
    // Specs hablan contra Supabase dev real; un solo fork serializa accesos
    // y evita carreras al truncar tablas entre specs.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true, isolate: false },
    },
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});