# Hono Memory Profiling Benchmark

Memory profiling tool for analyzing heap allocation patterns and identifying memory efficiency opportunities in Hono applications.

## Features

- **Per-request allocation tracking** - Measures heap growth per request
- **Multiple scenarios** - Tests common request handling patterns
- **GC-aware measurement** - Forces garbage collection for accurate results
- **JSON export** - Structured data for programmatic analysis
- **Optimization targets** - Automatically identifies high-allocation scenarios

## Quick Start

```bash
cd benchmarks/memory
bun --expose-gc memory-profile.ts
```

**Important:** Always run with `--expose-gc` flag to enable forced garbage collection for accurate measurements.

## Usage

### Basic Usage

```bash
# Default: 10,000 iterations per scenario
bun --expose-gc memory-profile.ts

# Custom iterations
bun --expose-gc memory-profile.ts --iterations=50000
```

### Output

**Console:**
- Formatted table with allocation metrics
- Throughput measurements
- Optimization targets (scenarios >50% above average)

**File: memory-profile-results.json:**
- Structured data with full statistics
- Runtime and configuration details
- Summary with most/least efficient scenarios

## Scenarios Tested

1. **Simple text response** - `c.text('Hello, World!')`
2. **JSON response** - `c.json({ message: 'Hello', ... })`
3. **Middleware chain** - 3 middleware + handler
4. **Context variables** - `c.set()` / `c.get()` operations
5. **Route parameters** - `/users/:id/posts/:postId`
6. **Query parameters** - `/search?q=test&page=1`
7. **Mixed workload** - Combination of above patterns

## Understanding Results

### Per-Request Allocation

```
| Scenario              | Heap/Request |
|-----------------------|--------------|
| Mixed workload        | 3.72 B       | ✅ Excellent
| JSON response         | 5.17 B       | ✅ Good
| Query parameters      | 5.54 B       | ✅ Good
| Simple text response  | 27.76 B      | ⚠️  High
```

**What it means:**
- **< 10 B/request** - Excellent memory efficiency
- **10-20 B/request** - Good efficiency
- **> 20 B/request** - Potential optimization target

**Important:** These are relative measurements. Absolute values depend on:
- Runtime (Bun, Node.js, Deno)
- GC behavior and timing
- JIT warmup state
- System memory pressure

### Heap Growth

Total heap growth across all iterations. Lower is better, but this is less reliable than per-request metrics due to GC timing variations.

### Throughput

Requests per second. Higher throughput often correlates with lower allocation (less GC pressure).

## Interpreting Results

### Good Patterns

✅ **Efficient scenarios typically show:**
- Low per-request allocation (< 10 B)
- High throughput (> 150k req/s)
- Consistent results across runs

### Optimization Targets

⚠️  **High allocation scenarios may indicate:**
- Unnecessary object creation
- String concatenation in hot paths
- Inefficient data structure usage
- Missing fast paths for common cases

### Example Analysis

```
Most efficient: Mixed workload (3.72 B/request)
Least efficient: Simple text response (27.76 B/request)

Potential optimization targets (>50% above average):
  - Simple text response: 27.76 B/request (+150.9%)
  - Middleware chain: 23.37 B/request (+111.2%)
```

**Actions:**
1. Investigate why simple text responses allocate more than JSON
2. Profile middleware chain to identify allocation hotspots
3. Compare implementation against efficient scenarios
4. Validate optimizations with before/after measurements

## Best Practices

### 1. Warm Up JIT First

The benchmark runs thousands of iterations to ensure JIT compilation is complete before measurement. For custom scenarios, ensure adequate warmup.

### 2. Force GC Between Scenarios

```typescript
if (global.gc) {
  global.gc()
  await new Promise((resolve) => setTimeout(resolve, 100))
}
```

This ensures clean baseline for each scenario.

### 3. Run Multiple Times

Memory profiling can be noisy. Run 3-5 times and look for consistent patterns rather than absolute values.

### 4. Compare Relative, Not Absolute

Focus on:
- Relative differences between scenarios
- Before/after comparisons for optimizations
- Trends over time

Avoid:
- Comparing absolute values across different machines
- Treating single-digit byte differences as significant
- Optimizing without profiling to find actual hotspots

## Common Pitfalls

### ❌ GC Timing Variability

**Problem:** GC may run during some scenarios but not others, skewing results.

**Solution:** Always use `--expose-gc` and force GC between scenarios.

### ❌ Cold Start Effects

**Problem:** First scenario shows higher allocation due to JIT warmup.

**Solution:** Run enough iterations (10k+) to amortize startup costs.

### ❌ Optimizing Prematurely

**Problem:** Focusing on small differences without profiling real bottlenecks.

**Solution:** Use results to guide investigation, not as definitive proof. Profile actual application code.

## Advanced Usage

### Custom Scenarios

Add your own scenarios to the benchmark:

```typescript
results.push(
  await profileScenario(
    'My custom scenario',
    () => {
      const app = new Hono()
      app.get('/test', (c) => {
        // Your code here
        return c.json({ result: 'test' })
      })
      return app
    },
    ['/test'],
    iterations
  )
)
```

### Historical Tracking

```bash
# Export results with timestamp
bun --expose-gc memory-profile.ts
mv memory-profile-results.json results/memory-$(git rev-parse --short HEAD).json

# Compare across commits
jq '.results[] | {name, perRequestBytes}' results/memory-*.json
```

### CI Integration

```yaml
- name: Memory profiling
  run: |
    cd benchmarks/memory
    bun --expose-gc memory-profile.ts --iterations=20000
    # Check for regressions
    node check-memory-budget.js
```

## Methodology

### Measurement Process

1. **Force GC** - Ensure clean heap state
2. **Capture baseline** - Record heap usage before test
3. **Execute iterations** - Run scenario N times
4. **Capture final** - Record heap usage after test
5. **Calculate metrics** - Compute per-request allocation

### Why This Works

- **High iteration counts** (10k+) amortize JIT and startup costs
- **Forced GC** provides consistent baseline
- **Per-request calculation** normalizes across scenarios
- **Multiple scenarios** enable comparative analysis

### Limitations

- **GC timing** - Results can vary ±20% between runs
- **Runtime differences** - Bun vs Node.js show different patterns
- **Synthetic workload** - Real applications may differ
- **No peak memory** - Only tracks heap growth, not peak usage

## Performance Budget

Suggested allocation budgets for different request types:

| Request Type      | Target (B/request) |
|-------------------|--------------------|
| Static responses  | < 5                |
| Simple JSON API   | < 10               |
| With middleware   | < 15               |
| Complex routing   | < 20               |

Exceeding these budgets doesn't mean slow code, but may indicate optimization opportunities.

## Related Tools

- **`benchmarks/http-server/`** - HTTP throughput benchmarking
- **`benchmarks/routers/`** - Router performance testing
- **`perf-measures/bundle-check/`** - Bundle size tracking

## Troubleshooting

### High Variability

**Symptoms:** Results vary >50% between runs

**Solutions:**
- Close background applications
- Increase iterations (`--iterations=50000`)
- Run on system with stable load
- Check if GC is exposed (`bun --expose-gc`)

### Unexpected Allocations

**Symptoms:** Scenario shows high allocation but shouldn't

**Debug steps:**
1. Run scenario in isolation
2. Add explicit GC calls and logging
3. Use runtime profiler (e.g., Bun.inspect)
4. Check for object pooling opportunities

### Zero Heap Growth

**Symptoms:** All scenarios show 0 B/request

**Cause:** GC not exposed or running mid-measurement

**Solution:** Always use `bun --expose-gc` flag

## References

- **Performance plan:** See repository discussion for overall performance roadmap
- **Memory optimization guide:** `.github/copilot/instructions/memory-performance.md`
- **Runtime performance:** `.github/copilot/instructions/runtime-performance.md`

## Summary

The memory profiling benchmark enables:
- ✅ Quantitative analysis of allocation patterns
- ✅ Identification of memory efficiency opportunities
- ✅ Before/after validation of optimizations
- ✅ Regression detection for memory usage
- ✅ Comparative analysis across scenarios

Use this tool to guide optimization efforts and validate that changes improve memory efficiency without sacrificing performance.
