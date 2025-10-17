# Performance Profiling Guide for Hono

This guide explains how to profile Hono applications to identify performance bottlenecks and guide optimization efforts.

## Quick Start

### Profile HTTP Server
```bash
# Start profiling for 10 seconds
bun run tools/profile.ts benchmarks/http-server/server.ts

# View results in Chrome DevTools or Speedscope
```

### Profile with Custom Duration
```bash
# Profile for 30 seconds
bun run tools/profile.ts --duration=30 benchmarks/http-server/server.ts
```

### Compare Before/After
```bash
# Baseline (save profile)
git checkout main
bun run build
bun run tools/profile.ts benchmarks/http-server/server.ts
# Note the profile path: profiles/server-TIMESTAMP.cpuprofile

# Test optimization
git checkout your-branch
bun run build
bun run tools/profile.ts --compare=profiles/server-BASELINE.cpuprofile benchmarks/http-server/server.ts
```

## When to Profile

Profile when you need to:
1. **Identify hot paths** - Which functions consume the most CPU time
2. **Validate optimizations** - Confirm that changes improve performance
3. **Investigate regressions** - Find why performance degraded
4. **Understand execution flow** - See how code executes in practice

## Profiling Workflow

### 1. Establish Baseline

Before optimizing, profile the current implementation:

```bash
# Clean build
git checkout main
bun run build

# Profile and save baseline
bun run tools/profile.ts --duration=20 benchmarks/http-server/server.ts

# Note the profile path for comparison
# Example: profiles/server-2025-10-17T12-30-45.cpuprofile
```

**Important**: Use sufficient duration (10-30s) for statistical significance.

### 2. Analyze Hot Functions

The profiler automatically shows the top 20 functions by self time:

```
Hot Functions (Top 20 by self time):
────────────────────────────────────────────────────────────────────────────────
Function Name                                      Self Time      Percentage
────────────────────────────────────────────────────────────────────────────────
Context.json                                       145.23ms       12.3%
RegExpRouter.match                                 98.45ms        8.4%
compose                                            76.32ms        6.5%
Context.get                                        54.21ms        4.6%
...
```

**Focus on**:
- Functions with >5% self time
- Functions you control (not runtime internals)
- Surprisingly slow operations

### 3. Visualize with Flamegraph

For complex call stacks, use flamegraph visualization:

```bash
# Generate and open flamegraph
bun run tools/profile.ts --flamegraph benchmarks/http-server/server.ts
```

**Or** upload manually to https://speedscope.app

**Flamegraph reading**:
- **Width** = Total time spent (including children)
- **Color** = Different files/modules
- **Hover** = See function name and timing
- **Click** = Zoom into call stack

### 4. Make Targeted Changes

Based on profiling insights, optimize hot paths:

```typescript
// Example: If Context.json shows up as hot (12.3%)
// Before optimization:
json(data: any) {
  return new Response(JSON.stringify(data), {
    headers: { ...this.headers, 'Content-Type': 'application/json' }
  })
}

// After optimization: Use Response.json() fast path
json(data: any) {
  // Fast path: avoid header spread for simple case
  if (Object.keys(this.headers).length === 0) {
    return Response.json(data)  // Browser-native fast path
  }
  return new Response(JSON.stringify(data), {
    headers: { ...this.headers, 'Content-Type': 'application/json' }
  })
}
```

### 5. Validate with Comparison Profile

Re-profile with comparison to baseline:

```bash
# Your branch with optimization
git checkout perf/context-json-optimization
bun run build

# Compare with baseline
bun run tools/profile.ts \
  --compare=profiles/server-BASELINE.cpuprofile \
  benchmarks/http-server/server.ts
```

**Look for**:
- 🟢 Green markers = Improved (faster)
- 🔴 Red markers = Regressed (slower)
- Target: >10% improvement in hot functions

### 6. Verify with Benchmarks

Always validate with realistic benchmarks:

```bash
# Run HTTP benchmark
cd benchmarks/http-server
bun run benchmark.ts --runs=5

# Check for overall improvement, not just individual functions
```

## Profiling Different Scenarios

### HTTP Request Handling

**Target**: Router, middleware, context, response generation

```bash
# Profile HTTP server under load
bun run tools/profile.ts --duration=20 benchmarks/http-server/server.ts
```

**Hot functions to look for**:
- Router matching (`RegExpRouter.match`, `TrieRouter.search`)
- Middleware composition (`compose`, middleware functions)
- Context operations (`Context.json`, `Context.text`, `Context.get`)
- Response creation

### Router Performance

**Target**: Route matching algorithms

```bash
# Profile router benchmark
cd benchmarks/routers
bun run tools/profile.ts --duration=15 src/bench.mts
```

**Hot functions to look for**:
- `match()`, `add()`, `search()` methods
- RegExp compilation and matching
- Trie node traversal

### JSX Rendering

**Target**: JSX element creation and HTML generation

```bash
# Profile JSX benchmark
cd benchmarks/jsx
bun run tools/profile.ts --duration=15 your-jsx-benchmark.ts
```

**Hot functions to look for**:
- JSX element creation
- Props processing
- HTML string generation
- Attribute handling

### Build Performance

**Target**: TypeScript compilation, bundling

```bash
# Profile build process
time bun run build

# For detailed TS profiling
tsc --generateTrace trace-dir --noEmit
# Analyze with: https://ui.perfetto.dev
```

**Look for**:
- Slow type-checking files
- Complex type instantiations
- Module resolution overhead

## Runtime-Specific Profiling

### Bun (Default)

Bun provides V8-compatible CPU profiling:

```bash
# Standard profiling
bun run tools/profile.ts benchmarks/http-server/server.ts

# Or directly with bun
bun --cpuprofile=profile.cpuprofile your-script.ts
```

**Advantages**:
- Fast startup
- Good for quick iterations
- Matches production Bun deployments

### Node.js

Node.js profiling for multi-runtime validation:

```bash
# Profile with Node.js
bun run tools/profile.ts --runtime=node benchmarks/http-server/server.ts

# Or directly with node
node --cpu-prof your-script.js
```

**Advantages**:
- Matches production Node.js deployments
- Mature V8 profiler
- Chrome DevTools integration

### Deno

For Deno-specific profiling:

```bash
# Deno has built-in profiling
deno run --allow-all --v8-flags=--prof your-script.ts

# Process profile
deno run --allow-all --v8-flags=--prof-process isolate-*.log > profile.txt
```

## Viewing and Analyzing Profiles

### Chrome DevTools (Recommended)

1. Open Chrome: `chrome://inspect`
2. Click "Open dedicated DevTools for Node"
3. Go to "Performance" or "Profiler" tab
4. Click "Load" and select `.cpuprofile` file

**Features**:
- Call tree view (hierarchical time breakdown)
- Bottom-up view (aggregate time by function)
- Chart view (timeline of execution)
- Source code integration

### Speedscope (Visual Flamegraphs)

1. Visit: https://speedscope.app
2. Drag and drop `.cpuprofile` file
3. Explore interactive flamegraph

**Features**:
- Intuitive flamegraph visualization
- Time-ordered view (see execution sequence)
- Left-heavy view (sort by total time)
- Sandwich view (callers + callees)

### VS Code JavaScript Profiler

Install "JavaScript Profiler" extension:
1. Open `.cpuprofile` in VS Code
2. View flamegraph inline
3. Jump to source code

## Common Profiling Patterns

### Finding Memory Allocations

Profile and look for:
- `Object allocation` in flamegraph
- High time in constructor functions
- Frequent `new` keyword execution

```typescript
// Hot path with allocations:
function handler(c: Context) {
  const data = { message: 'hello' }  // Allocation
  const headers = { ...c.headers }   // Allocation
  return new Response(JSON.stringify(data), { headers })  // Multiple allocations
}

// Optimized (fewer allocations):
function handler(c: Context) {
  return Response.json({ message: 'hello' })  // Single native allocation
}
```

### Finding Inefficient Loops

Profile and look for:
- High self-time in loop bodies
- Repeated work in nested loops
- O(n²) patterns

```typescript
// Before: O(n²) pattern
for (const route of routes) {
  for (const middleware of middlewares) {
    if (matchesPattern(route, middleware)) { ... }
  }
}

// After: O(n) with preprocessing
const middlewareMap = buildMiddlewareMap(middlewares)
for (const route of routes) {
  const matched = middlewareMap.get(route.pattern)  // O(1) lookup
}
```

### Finding RegExp Overhead

Profile and look for:
- High time in `RegExp.test()` or `RegExp.exec()`
- RegExp compilation overhead

```typescript
// Before: Compile on every request
function match(path: string) {
  const pattern = new RegExp('/api/[^/]+')  // Compilation overhead
  return pattern.test(path)
}

// After: Compile once
const pattern = /\/api\/[^\/]+/  // Compiled at module load
function match(path: string) {
  return pattern.test(path)
}
```

## Profiling Best Practices

### 1. Profile Representative Workloads

Use realistic inputs and scenarios:
- Real route patterns
- Typical request payloads
- Expected middleware chains

### 2. Run Sufficient Duration

**Minimum**: 10 seconds for stable results
**Recommended**: 20-30 seconds for high confidence
**Maximum**: 60 seconds (diminishing returns)

### 3. Warm Up Before Profiling

Allow JIT compilation to stabilize:

```typescript
// Example benchmark with warmup
async function benchmark() {
  // Warmup: 1000 iterations
  for (let i = 0; i < 1000; i++) {
    await app.request('/test')
  }

  // Now start profiling
  console.log('Warmed up, starting profile...')
  // Profiling period here
}
```

### 4. Profile in Production Mode

Always profile with:
- `bun run build` (production build)
- No debugger attached
- Representative load

### 5. Isolate Variables

Change one thing at a time:
- Keep other code constant
- Same hardware and environment
- Minimize background processes

## Interpreting Profile Results

### Self Time vs Total Time

- **Self time**: Time spent in function itself (excluding children)
- **Total time**: Time spent in function + all children

**Optimize for self time >5%** - these are true bottlenecks.

### Call Tree Interpretation

```
Context.json (150ms total, 30ms self)
├─ JSON.stringify (80ms total, 80ms self) ← Optimize this
└─ Response constructor (40ms total, 40ms self) ← Or this
```

Focus on leaves with high self-time.

### Statistical Significance

Run multiple profiles and look for consistency:

```bash
# Run 3 profiles
for i in {1..3}; do
  bun run tools/profile.ts benchmarks/http-server/server.ts
done

# Compare hot functions across runs
# Consistent hot functions = real bottlenecks
# Inconsistent = measurement noise
```

## Troubleshooting

### Profile Shows No Data

**Cause**: Target script exits immediately
**Solution**: Ensure script runs for full duration

### Profile Shows Only Runtime Functions

**Cause**: Your code is not the bottleneck
**Solution**: Check if external dependencies dominate time

### Inconsistent Results

**Cause**: System noise, insufficient duration
**Solution**:
- Close other applications
- Increase profiling duration
- Run multiple times

### Cannot Open Profile File

**Cause**: Incompatible format or corrupted
**Solution**:
- Check file size (should be >1KB)
- Try different viewer (Chrome vs Speedscope)
- Re-run profiling

## Real-World Example

### Scenario: JSON Response Slow

**Step 1**: Profile baseline
```bash
bun run tools/profile.ts benchmarks/http-server/server.ts
```

**Result**:
```
Context.json: 145ms (12.3%)
- JSON.stringify: 60ms
- Header spreading: 85ms ← Bottleneck found
```

**Step 2**: Optimize header handling
```typescript
// Use fast path for common case
if (Object.keys(this.headers).length === 0) {
  return Response.json(data)
}
```

**Step 3**: Validate with comparison
```bash
bun run tools/profile.ts --compare=profiles/baseline.cpuprofile benchmarks/http-server/server.ts
```

**Result**:
```
Context.json: 85ms (7.2%) 🟢 -41% improvement
```

**Step 4**: Confirm with benchmark
```bash
cd benchmarks/http-server && bun run benchmark.ts --runs=5
# Result: +18.8% throughput improvement
```

## Next Steps

- **For specific optimizations**: See `runtime-performance.md`
- **For measurement strategies**: See `performance-measurement.md`
- **For benchmark infrastructure**: See `benchmark-infrastructure.md`
- **For build profiling**: See `build-performance.md`

## Tools Reference

### Profiling Tool
```bash
bun run tools/profile.ts [OPTIONS] <target>
```

### Options
- `--duration=N` - Profile duration in seconds (default: 10)
- `--runtime=bun|node` - Runtime to use (default: bun)
- `--output=DIR` - Output directory (default: ./profiles)
- `--flamegraph` - Generate flamegraph visualization
- `--compare=FILE` - Compare with baseline profile
- `--help` - Show help message

### Output Files
- `*.cpuprofile` - Chrome DevTools/Speedscope compatible profile
- `*.txt` - Text summary of hot functions
- Profiles saved to `./profiles/` directory with timestamps

### Viewing Options
1. **Chrome DevTools**: `chrome://inspect` > Profiler > Load
2. **Speedscope**: https://speedscope.app (drag & drop)
3. **VS Code**: JavaScript Profiler extension

## Performance Optimization Checklist

Using profiling results:

- [ ] Profile baseline (10-30s duration)
- [ ] Identify hot functions (>5% self time)
- [ ] Make targeted optimization
- [ ] Profile optimized version
- [ ] Compare profiles (look for 🟢 improvements)
- [ ] Validate with realistic benchmarks
- [ ] Ensure all tests pass
- [ ] Document trade-offs in PR

Remember: **Profile, optimize, validate** - always measure impact!
