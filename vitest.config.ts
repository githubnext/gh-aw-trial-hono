import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./.vitest.config/setup-vitest.ts'],
    // Performance optimizations
    // Coverage disabled by default for faster test runs - re-enable with --coverage flag when needed
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
    // Optimize test execution by increasing concurrency
    maxConcurrency: 10,
    coverage: {
      enabled: false,
      provider: 'v8',
      reportsDirectory: './coverage/raw/default',
      reporter: ['json', 'text', 'html'],
      exclude: [
        ...(configDefaults.coverage.exclude ?? []),
        'benchmarks',
        'runtime-tests',
        'build/build.ts',
        'src/test-utils',
        'perf-measures',

        // types are compile-time only, so their coverage cannot be measured
        'src/**/types.ts',
        'src/jsx/intrinsic-elements.ts',
        'src/utils/http-status.ts',
      ],
    },
    projects: [
      // Runtime test projects (Node, Lambda, Workers, etc.) are opt-in for faster local development
      // Enable with: HONO_TEST_RUNTIME=1 bun run test
      // CI should always run with HONO_TEST_RUNTIME=1 for full coverage
      ...(process.env.HONO_TEST_RUNTIME === '1' ? ['./runtime-tests/*/vitest.config.ts'] : []),
      {
        esbuild: {
          jsx: 'automatic',
          jsxImportSource: './src/jsx',
        },
        extends: true,
        test: {
          exclude: [...configDefaults.exclude, '**/sandbox/**', '**/*.case.test.*'],
          include: [
            'src/**/(*.)+(spec|test).+(ts|tsx|js)',
            'scripts/**/(*.)+(spec|test).+(ts|tsx|js)',
            'build/**/(*.)+(spec|test).+(ts|tsx|js)',
          ],
          name: 'main',
        },
      },
      {
        esbuild: {
          jsx: 'automatic',
          jsxImportSource: './src/jsx',
        },
        extends: true,
        test: {
          include: ['src/jsx/dom/**/(*.)+(spec|test).+(ts|tsx|js)', 'src/jsx/hooks/dom.test.tsx'],
          name: 'jsx-runtime-default',
        },
      },
      {
        esbuild: {
          jsx: 'automatic',
          jsxImportSource: './src/jsx/dom',
        },
        extends: true,
        test: {
          include: ['src/jsx/dom/**/(*.)+(spec|test).+(ts|tsx|js)', 'src/jsx/hooks/dom.test.tsx'],
          name: 'jsx-runtime-dom',
        },
      },
    ],
  },
})
