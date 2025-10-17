# Performance Profiling Tools

This directory contains tooling for CPU profiling and performance analysis of Hono applications.

## Quick Start

```bash
# Profile a benchmark target for 10 seconds
bun run tools/profile.ts benchmarks/profile-target.mjs

# Profile with custom duration (30 seconds)
bun run tools/profile.ts --duration=30 benchmarks/profile-target.mjs

# Compare with a baseline profile
bun run tools/profile.ts --compare=profiles/baseline.cpuprofile benchmarks/profile-target.mjs
```

## Tools

### profile.ts

CPU profiling tool that generates Chrome DevTools-compatible profiles.

**Features:**
- **Multiple runtimes**: Node.js (default, recommended) and Bun (experimental)
- **Automatic analysis**: Shows top 20 hot functions by self time
- **Profile comparison**: Compare before/after optimizations
- **Flamegraph support**: Optional visualization with speedscope
- **Text summaries**: Save analysis as .txt files

**Usage:**
```bash
bun run tools/profile.ts [OPTIONS] <target>
```

**Options:**
- `--duration=N` - Profile duration in seconds (default: 10)
- `--runtime=node|bun` - Runtime to use (default: node)
- `--output=DIR` - Output directory (default: ./profiles)
- `--compare=FILE` - Compare with baseline profile
- `--flamegraph` - Open in speedscope (requires speedscope CLI)
- `--help` - Show help message

**Examples:**

```bash
# Basic profiling (10 seconds)
bun run tools/profile.ts benchmarks/profile-target.mjs

# Extended profiling (30 seconds for statistical confidence)
bun run tools/profile.ts --duration=30 benchmarks/profile-target.mjs

# Experimental Bun runtime profiling
bun run tools/profile.ts --runtime=bun benchmarks/profile-target.mjs

# Compare optimization vs baseline
git checkout main && bun run build
bun run tools/profile.ts benchmarks/profile-target.mjs
# Save the profile path (e.g., profiles/baseline.cpuprofile)

git checkout my-optimization && bun run build
bun run tools/profile.ts --compare=profiles/baseline.cpuprofile benchmarks/profile-target.mjs
```

## Profile Output

Profiles are saved to `./profiles/` directory with timestamps:

- `*.cpuprofile` - Chrome DevTools / Speedscope compatible CPU profile
- `*.txt` - Text summary of hot functions

## Viewing Profiles

### Chrome DevTools (Recommended)

1. Open Chrome: `chrome://inspect`
2. Click "Open dedicated DevTools for Node"
3. Go to "Profiler" or "Performance" tab
4. Click "Load" and select `.cpuprofile` file

**Features:**
- Call tree view (hierarchical breakdown)
- Bottom-up view (aggregate by function)
- Chart view (execution timeline)
- Source code integration

### Speedscope (Interactive Flamegraphs)

1. Visit: https://speedscope.app
2. Drag and drop `.cpuprofile` file

**Or** install speedscope CLI:
```bash
npm install -g speedscope
bun run tools/profile.ts --flamegraph benchmarks/profile-target.mjs
```

**Features:**
- Interactive flamegraph visualization
- Time-ordered view
- Left-heavy view (sorted by total time)
- Sandwich view (callers + callees)

### VS Code

Install "JavaScript Profiler" extension and open `.cpuprofile` files directly.

## Interpreting Profile Results

### Hot Functions Analysis

The tool automatically prints the top 20 functions by self time:

```
📈 Hot Functions (Top 20 by self time):
────────────────────────────────────────────────────────────────────────────────
Function Name                                     Self Time      Percentage
────────────────────────────────────────────────────────────────────────────────
Context.json                                      145.23ms       12.3%
RegExpRouter.match                                98.45ms        8.4%
compose                                           76.32ms        6.5%
```

**Focus on functions with >5% self time** - these are the true bottlenecks.

### Self Time vs Total Time

- **Self time**: Time spent in the function itself (excluding children)
- **Total time**: Time in function + all children

Optimize functions with high self time for maximum impact.

### Profile Comparison

When using `--compare`, the tool shows:

```
📊 Function Time Changes:
────────────────────────────────────────────────────────────────────────────────
Function Name                                      Baseline       Current        Change
────────────────────────────────────────────────────────────────────────────────
Context.json                                       145.23ms       85.12ms        -41.4% 🟢
RegExpRouter.match                                 98.45ms        102.34ms       +3.9% 🔴
```

- 🟢 Green = Improved (faster)
- 🔴 Red = Regressed (slower)
- ⚪ White = Small change (<10%)

## Profiling Targets

### benchmarks/profile-target.mjs

Simple HTTP workload for testing profiling tools:
- Multiple routes (ping, JSON API, query params, Fibonacci)
- Middleware chains
- Continuous request generation

**Usage:**
```bash
bun run tools/profile.ts benchmarks/profile-target.mjs
```

**Note**: Use `.mjs` version for Node.js compatibility (uses built dist).

### Custom Targets

Profile any script that runs continuously:

```javascript
// my-benchmark.mjs
import { Hono } from 'hono'

const app = new Hono()
// ... add routes ...

// Generate load for profiling
while (true) {
  await app.request('/endpoint')
}
```

Then profile:
```bash
bun run tools/profile.ts my-benchmark.mjs
```

## Performance Optimization Workflow

1. **Establish Baseline**
   ```bash
   git checkout main
   bun run build
   bun run tools/profile.ts --duration=20 benchmarks/profile-target.mjs
   # Save profile path as baseline
   ```

2. **Identify Hot Functions**
   - Review hot functions output (>5% self time)
   - Open profile in Chrome DevTools for detailed analysis
   - Use flamegraph to visualize call stacks

3. **Make Targeted Optimization**
   - Focus on functions you control (not runtime internals)
   - Reduce allocations, optimize algorithms, cache results

4. **Validate with Comparison**
   ```bash
   git checkout my-optimization
   bun run build
   bun run tools/profile.ts --compare=profiles/baseline.cpuprofile benchmarks/profile-target.mjs
   ```

5. **Confirm with Benchmarks**
   ```bash
   cd benchmarks/http-server
   bun run benchmark.ts --runs=5
   ```

Always validate profiling results with realistic benchmarks!

## Tips & Best Practices

### Profiling Duration

- **Minimum**: 10 seconds for stable results
- **Recommended**: 20-30 seconds for high confidence
- **Maximum**: 60 seconds (diminishing returns)

### Warm-Up Period

Modern JavaScript engines use JIT compilation. For accurate profiling:

```javascript
// Warm up (allow JIT to optimize)
for (let i = 0; i < 1000; i++) {
  await app.request('/test')
}

// Now start profiling
console.log('Warmed up, profiling...')
// Continue generating load
```

### Profile in Production Mode

Always profile with:
- Production build (`bun run build`)
- No debugger attached
- Minimal background processes

### Multiple Runs

For statistical confidence, run multiple profiles:

```bash
for i in {1..3}; do
  bun run tools/profile.ts benchmarks/profile-target.mjs
done
```

Compare hot functions across runs - consistent results = real bottlenecks.

### Node.js vs Bun

**Node.js (default):**
- ✅ Mature V8 profiler
- ✅ Excellent Chrome DevTools integration
- ✅ Production-representative for Node.js deployments
- ✅ Recommended for most use cases

**Bun (experimental):**
- ⚠️ Uses inspector API (less mature)
- ⚠️ May have profiling overhead
- ✅ Fast for quick iterations
- ⚠️ Use for Bun-specific profiling only

## Troubleshooting

### Profile Shows Mostly Idle Time

**Cause**: Target script not generating enough load
**Solution**: Increase request rate or use more intensive endpoints

### Profile File Not Created

**Cause**: Target script exits immediately or crashes
**Solution**: Ensure target runs for full duration, check for errors

### Inconsistent Results

**Cause**: System noise, insufficient duration, cold starts
**Solution**:
- Close other applications
- Increase profiling duration (--duration=30)
- Run multiple times and compare

### Cannot Open Profile in Chrome DevTools

**Cause**: Corrupted or incompatible profile format
**Solution**:
- Check file size (should be >1KB)
- Try Speedscope instead
- Re-run profiling

## Further Reading

See [`.github/copilot/instructions/profiling-guide.md`](../.github/copilot/instructions/profiling-guide.md) for:
- Detailed profiling workflows
- Runtime-specific considerations
- Common profiling patterns
- Real-world optimization examples
- Performance analysis strategies

## Integration with Existing Tooling

This profiling tool complements Hono's existing performance infrastructure:

- **HTTP benchmarks** (`benchmarks/http-server/`) - Measure overall throughput
- **Router benchmarks** (`benchmarks/routers/`) - Compare router implementations
- **JSX benchmarks** (`benchmarks/jsx/`) - Test rendering performance
- **Memory profiling** (`benchmarks/memory/`) - Analyze allocations
- **Bundle size** (`perf-measures/bundle-check/`) - Track code size

Use profiling to identify bottlenecks, then validate fixes with benchmarks!
