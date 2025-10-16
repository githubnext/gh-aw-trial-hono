# Build and Development Performance Guide for Hono

This guide covers optimizations for build times, test execution, and development workflow to enable faster performance engineering iterations.

## Current Build System

### Build Process Overview
```bash
bun run build
```

**Steps** (from `build/build.ts`):
1. **ESM Build**: Bundle with esbuild, output to `dist/`
2. **CJS Build**: Bundle with esbuild, output to `dist/cjs/`
3. **Type Definitions**: Generate with `tsc --emitDeclarationOnly`
4. **Private Field Removal**: Post-process `.d.ts` files
5. **Package JSON Copy**: Copy CJS package.json markers

### Current Performance
- Typical full build: ~5-10 seconds (measure on your machine)
- Watch mode available: `bun run watch`
- Incremental builds: ~1-2 seconds

## Build Time Optimization Opportunities

### 1. Parallelize Independent Steps

**Current**: Sequential execution
```typescript
// build/build.ts
await Promise.all([esmBuild(), cjsBuild()])  // ✓ Already parallel
await $`tsc ...`  // Sequential
// Private field removal  // Sequential
```

**Opportunity**: Parallelize more aggressively
```typescript
// Run type generation in parallel with builds
const [esmResult, cjsResult, tscResult] = await Promise.all([
  esmBuild(),
  cjsBuild(),
  $`tsc --emitDeclarationOnly ...`.nothrow()
]);

// Then do private field removal (depends on tsc)
await removePrivateFields();
```

**Measurement**:
```bash
# Before
time bun run build

# Make changes to build/build.ts
# After
time bun run build

# Should see 10-30% improvement
```

### 2. Incremental Type Checking

**Current**: Full type-check every build
```bash
tsc --emitDeclarationOnly --declaration
```

**Optimization**: Use incremental mode
```typescript
// tsconfig.build.json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": ".tsbuildinfo"
  }
}
```

**Trade-off**:
- First build: Same speed or slightly slower
- Subsequent builds: 50-80% faster
- Requires cache management (`.tsbuildinfo` file)

**Validation**:
```bash
# Clean build
rm -rf dist .tsbuildinfo
time bun run build

# Incremental (touch one file)
touch src/hono.ts
time bun run build  # Should be much faster
```

### 3. Optimize Private Field Removal

**Current** (`build/build.ts:107-116`):
```typescript
await Promise.all(
  dtsEntries.map(async (e) => {
    await fs.promises.writeFile(e, await removePrivateFields(e))
  })
)
```

**Optimization**: Batch processing, reduce I/O
```typescript
// Process files in chunks to reduce worker overhead
const CHUNK_SIZE = 50;
for (let i = 0; i < dtsEntries.length; i += CHUNK_SIZE) {
  const chunk = dtsEntries.slice(i, i + CHUNK_SIZE);
  await Promise.all(
    chunk.map(async (e) => {
      const content = await removePrivateFields(e);
      await fs.promises.writeFile(e, content);
    })
  );
}
```

### 4. Build Output Caching

**Opportunity**: Skip rebuilding unchanged files
```typescript
// Check file modification times
const needsRebuild = (srcFile: string, distFile: string) => {
  if (!fs.existsSync(distFile)) return true;

  const srcMtime = fs.statSync(srcFile).mtimeMs;
  const distMtime = fs.statSync(distFile).mtimeMs;

  return srcMtime > distMtime;
};

// Only rebuild changed files
const entryPoints = glob.sync('./src/**/*.ts')
  .filter(src => needsRebuild(src, getDistPath(src)));
```

**Trade-off**: More complex, watch mode may be better solution

## Test Execution Performance

### Current Test Setup
```json
// package.json
"test": "tsc --noEmit && vitest --run"
```

**Test Projects**: Multiple runtime configurations (Node, Bun, Deno, Fastly, etc.)

### Optimization Opportunities

### 1. Skip Type-Check for Rapid Iteration

**During development**:
```bash
# Fast: Skip type-check
vitest --run

# Normal: With type-check
bun run test
```

**Add script** (package.json):
```json
"test:fast": "vitest --run",
"test:watch:fast": "vitest --watch"
```

### 2. Optimize Vitest Configuration

**Current** (`vitest.config.ts`): Check for parallelization settings

**Optimizations**:
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    // Increase parallelism (adjust based on CPU cores)
    maxConcurrency: 10,

    // Reduce overhead for simple tests
    isolate: false,  // Run tests in same context (if safe)

    // Only run changed tests in watch mode
    watch: {
      include: ['src/**/*.test.ts']
    },

    // Faster test execution
    pool: 'forks',  // or 'threads' - test which is faster
  }
})
```

**Measurement**:
```bash
# Before
time bun run test

# Make config changes

# After
time bun run test
```

### 3. Test File Organization

**Strategy**: Split large test files
```typescript
// Before: One large file with 100+ tests
// src/router/reg-exp-router/router.test.ts

// After: Split by feature
// src/router/reg-exp-router/router.basic.test.ts
// src/router/reg-exp-router/router.params.test.ts
// src/router/reg-exp-router/router.advanced.test.ts
```

**Benefit**: Better parallelization, easier to run focused tests

### 4. Focused Test Execution

**During performance work**:
```bash
# Run only router tests
vitest --run src/router

# Run specific test file
vitest --run src/router/reg-exp-router/router.test.ts

# Watch mode for rapid iteration
vitest --watch src/router
```

## Development Workflow Optimization

### 1. Fast Rebuild Workflow

**For runtime performance work**:
```bash
# Terminal 1: Watch mode
bun run watch

# Terminal 2: Test/benchmark loop
while true; do
  bun run test:fast
  sleep 1
done
```

**Or use combined script** (package.json):
```json
"dev": "concurrently \"bun run watch\" \"vitest --watch\""
```

### 2. Quick Performance Check Script

Create `scripts/perf-check.sh`:
```bash
#!/bin/bash
set -e

echo "=== Quick Performance Check ==="

# Fast rebuild
bun run build

# Quick test
bun run test:fast

# Quick HTTP benchmark (reduced duration)
cd benchmarks/http-server
BENCHMARK_DURATION=5 bun run benchmark.ts
cd ../..

echo "=== Performance check complete ==="
```

**Usage**:
```bash
chmod +x scripts/perf-check.sh
./scripts/perf-check.sh
```

### 3. Benchmark Iteration Loop

```bash
# Create iteration script
cat > /tmp/gh-aw/agent/bench-loop.sh << 'EOF'
#!/bin/bash
while true; do
  echo "=== Building ==="
  bun run build
  echo "=== Benchmarking ==="
  cd benchmarks/http-server
  bun run benchmark.ts | grep "req/s"
  cd ../..
  read -p "Press enter to run again, Ctrl-C to stop..."
done
EOF

chmod +x /tmp/gh-aw/agent/bench-loop.sh
/tmp/gh-aw/agent/bench-loop.sh
```

## CI Performance Optimization

### Opportunities in CI Workflow

**Current** (`.github/workflows/ci.yml`):
- Multiple jobs run in parallel (✓ good)
- Each job installs dependencies independently (opportunity)

**Optimization**: Cache dependencies
```yaml
# Already using bun install --frozen-lockfile (good)
# Consider adding cache:

- uses: oven-sh/setup-bun@v2
  with:
    bun-version-file: '.tool-versions'

- name: Cache bun dependencies
  uses: actions/cache@v3
  with:
    path: ~/.bun/install/cache
    key: ${{ runner.os }}-bun-${{ hashFiles('**/bun.lockb') }}
    restore-keys: |
      ${{ runner.os }}-bun-

- run: bun install --frozen-lockfile
```

## Profiling Build Performance

### Identify Bottlenecks

**1. Time each build step**:
```typescript
// build/build.ts
const timeStep = async (name: string, fn: () => Promise<void>) => {
  const start = performance.now();
  await fn();
  const duration = performance.now() - start;
  console.log(`[${name}] ${duration.toFixed(2)}ms`);
};

await timeStep('ESM Build', esmBuild);
await timeStep('CJS Build', cjsBuild);
await timeStep('Type Gen', () => $`tsc ...`);
await timeStep('Private Fields', removePrivateFieldsFromAll);
```

**2. Profile esbuild**:
```typescript
// build/build.ts
const esmBuild = () =>
  build({
    ...commonOptions,
    metafile: true,  // Generate build metadata
    outdir: './dist',
  }).then(result => {
    // Analyze result.metafile
    console.log('ESM build analysis:', result.metafile);
  });
```

**3. Profile TypeScript compilation**:
```bash
# Enable diagnostics
tsc --emitDeclarationOnly --diagnostics --extendedDiagnostics
```

## Build Performance Checklist

For build optimization PRs:

- [ ] Baseline build time measured (`time bun run build`)
- [ ] Clean build tested (removed `dist/`, `.tsbuildinfo`)
- [ ] Incremental build tested (touched one file)
- [ ] Watch mode verified still works
- [ ] All build outputs validated (dist/cjs, dist/types)
- [ ] Tests pass (`bun run test`)
- [ ] CI workflow considered
- [ ] Trade-offs documented (cache management, complexity)

## Quick Wins Checklist

Easiest optimizations to try first:

1. [ ] Enable TypeScript incremental builds
2. [ ] Parallelize tsc with esbuild
3. [ ] Add `test:fast` script (skip type-check)
4. [ ] Optimize vitest `maxConcurrency`
5. [ ] Create perf-check script for iteration

## Next Steps

- See `performance-measurement.md` for benchmarking strategies
- See `runtime-performance.md` for code optimizations
- See `bundle-optimization.md` for bundle size improvements
