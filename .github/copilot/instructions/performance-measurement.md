# Performance Measurement Guide for Hono

This guide explains how to measure performance efficiently in the Hono codebase to enable rapid iteration and validation of optimizations.

## Performance Measurement Philosophy

1. **Measure First**: Always establish a baseline before optimization
2. **Use Appropriate Tools**: Match measurement strategy to the performance target
3. **Iterate Quickly**: Use focused, fast measurements for rapid feedback
4. **Validate with Realistic Tests**: Confirm improvements with representative workloads
5. **Statistical Significance**: Run multiple iterations, account for variance

## Available Performance Testing Infrastructure

### 1. HTTP Benchmarking (`benchmarks/http-server/`)

**Purpose**: Measure request/response performance across HTTP endpoints

**Quick measurement**:
```bash
cd benchmarks/http-server
bun run benchmark.ts
```

**What it measures**:
- Requests per second (req/s)
- Latency distribution (P50, P95, P99)
- Baseline vs target comparison

**Use for**:
- Router performance changes
- Middleware optimizations
- Context object modifications
- Overall request handling improvements

**Tips**:
- Uses bombardier for load testing
- Tests multiple endpoints (ping, query params, JSON body)
- Run locally for quick iteration, CI for validation

### 2. Router Benchmarks (`benchmarks/routers/`)

**Purpose**: Compare router implementation performance

**Quick measurement**:
```bash
cd benchmarks/routers
# Check README for specific benchmark commands
```

**What it measures**:
- Router lookup speed across different implementations
- Performance with various route patterns

**Use for**:
- Router algorithm optimizations
- Trie/RegExp/Smart router comparisons
- Route matching performance

### 3. JSX Benchmarks (`benchmarks/jsx/`)

**Purpose**: Measure JSX rendering performance

**Quick measurement**:
```bash
cd benchmarks/jsx
# Check README for benchmark commands
```

**Use for**:
- JSX element creation optimizations
- Server-side rendering improvements
- Streaming performance

### 4. Type-Check Performance (`perf-measures/type-check/`)

**Purpose**: Measure TypeScript compilation speed

**Quick measurement**:
```bash
cd perf-measures/type-check
# Run type-check measurement script
```

**What it measures**:
- tsc compilation time
- typescript-go (tsgo) compilation time

**Use for**:
- Type definition optimizations
- Complex type simplification
- Incremental build improvements

### 5. Bundle Size Tracking (`perf-measures/bundle-check/`)

**Purpose**: Monitor minified bundle size

**Quick measurement**:
```bash
cd perf-measures/bundle-check
# Run bundle size check
```

**What it measures**:
- Minified bundle size using esbuild
- Per-export bundle sizes

**Use for**:
- Tree-shaking validation
- Code size optimizations
- Export structure improvements

## Fast Iteration Workflow

### For Runtime Performance (Router, Middleware, Context)

1. **Initial baseline**: Run HTTP benchmark once
   ```bash
   cd benchmarks/http-server && bun run benchmark.ts
   ```

2. **Make targeted change**: Edit specific file (e.g., `src/router/reg-exp-router/router.ts`)

3. **Quick rebuild**: Use watch mode for instant rebuilds
   ```bash
   bun run watch
   ```

4. **Quick validation**: Re-run HTTP benchmark
   ```bash
   cd benchmarks/http-server && bun run benchmark.ts
   ```

5. **Iterate**: Repeat steps 2-4 until satisfied

6. **Validate**: Run full test suite
   ```bash
   bun run test
   ```

### For Build Performance

1. **Baseline measurement**:
   ```bash
   time bun run build
   ```

2. **Make build system change**: Edit `build/build.ts` or configs

3. **Quick test**: Clean and rebuild
   ```bash
   bun run remove-dist && time bun run build
   ```

4. **Validate**: Test incremental builds
   ```bash
   touch src/hono.ts && time bun run build
   ```

### For Type-Check Performance

1. **Baseline**: Measure current type-check time
   ```bash
   time tsc --noEmit
   ```

2. **Optimize types**: Simplify complex type definitions

3. **Quick validation**: Re-run type-check
   ```bash
   time tsc --noEmit
   ```

4. **Validate**: Ensure types still work correctly
   ```bash
   bun run test
   ```

## Micro-Benchmarking for Focused Iteration

For algorithm-level optimizations, create focused micro-benchmarks:

```typescript
// Example: Benchmark a specific function
const iterations = 1_000_000;
const start = performance.now();

for (let i = 0; i < iterations; i++) {
  // Your function call here
  myOptimizedFunction(testInput);
}

const end = performance.now();
console.log(`Time: ${end - start}ms`);
console.log(`Per iteration: ${(end - start) / iterations}ms`);
```

**Tips**:
- Run in Bun for fast execution: `bun run micro-bench.ts`
- Test with realistic inputs
- Run multiple times, take median
- Compare baseline vs optimized side-by-side

## Avoiding Common Measurement Pitfalls

1. **Cold starts**: Discard first few iterations (JIT warmup)
2. **System noise**: Close other applications, run multiple times
3. **Unrealistic inputs**: Use production-like data patterns
4. **Optimization artifacts**: Ensure compiler doesn't eliminate code
5. **Measurement overhead**: Keep timing code minimal

## Performance Budgets

### Target Metrics

**HTTP Performance** (benchmarks/http-server):
- Maintain >100k req/s on ping endpoint
- P95 latency <5ms for simple routes

**Build Performance**:
- Full build: <10 seconds
- Incremental rebuild: <2 seconds
- Watch mode latency: <1 second

**Bundle Size**:
- `hono/tiny`: <12kB minified
- Core bundle: Track and prevent regressions

**Type-Check**:
- Full type-check: <30 seconds
- Incremental: <5 seconds

## Reporting Performance Results

When creating a performance PR, include:

1. **Measurement methodology**: How you tested
2. **Before/after data**: Concrete numbers
3. **Statistical confidence**: Multiple runs, variance
4. **Reproduction steps**: Exact commands used
5. **Environment details**: OS, runtime versions
6. **Trade-offs**: What changed (code complexity, memory, etc.)

Example format:
```markdown
## Performance Impact

### Measurement
- Benchmark: HTTP server (benchmarks/http-server)
- Runs: 5 iterations, median reported
- Environment: Ubuntu 24.04, Bun 1.2.19

### Results
Endpoint: /ping
- Before: 125,432 req/s
- After:  138,967 req/s
- Improvement: +10.8%

### Reproduction
1. Checkout this branch
2. `bun install && bun run build`
3. `cd benchmarks/http-server && bun run benchmark.ts`
```

## Next Steps

- For runtime optimizations, see `runtime-performance.md`
- For build improvements, see `build-performance.md`
- For bundle size, see `bundle-optimization.md`
- For JSX rendering, see `jsx-performance.md`
