import { defineConfig } from 'vitest/config';

// Los specs de `test/repos/` hablan contra la BD dev real y hacen `truncateAll`
// en cada `beforeEach` → BORRAN datos reales (p.ej. el catálogo de `entities` del
// pre-crawl F4.5). Por eso NO corren con el `pnpm test` por defecto: quedan detrás
// de `pnpm test:repos` (TEST_REPOS=1), opt-in y consciente.
const reposOnly = process.env.TEST_REPOS === '1';

export default defineConfig({
  test: {
    include: reposOnly ? ['test/repos/**/*.spec.ts'] : ['test/**/*.spec.ts'],
    exclude: reposOnly ? ['node_modules/**'] : ['node_modules/**', 'test/repos/**'],
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