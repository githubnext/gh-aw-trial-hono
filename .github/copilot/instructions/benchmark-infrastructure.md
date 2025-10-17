# Benchmark Infrastructure Guide for Hono

This guide explains how to use and improve Hono's performance benchmarking infrastructure for rapid, reliable performance engineering.

## Overview

Hono has comprehensive benchmarking infrastructure across multiple dimensions:
- **HTTP benchmarks** (`benchmarks/http-server/`) - Request throughput and latency
- **Router benchmarks** (`benchmarks/routers/`) - Routing algorithm performance
- **JSX benchmarks** (`benchmarks/jsx/`) - Server-side rendering speed
- **Type-check benchmarks** (`perf-measures/type-check/`) - Compilation performance
- **Bundle size tracking** (`perf-measures/bundle-check/`) - Code size monitoring

## HTTP Benchmarks (Primary Tool)

### Quick Start

```bash
cd benchmarks/http-server
bun run benchmark.ts
```

This runs a comparison between `origin/main` (baseline) and your current code (target) with:
- **3 runs** per endpoint for statistical reliability
- **95% confidence intervals** to quantify measurement uncertainty
- **Significance testing** to identify real performance changes
- **JSON export** for programmatic analysis

### Statistical Analysis Features

**Confidence Intervals:**
- Shows measurement uncertainty: `125,432.50 ± 1,234.56`
- Smaller intervals = more reliable measurements
- Helps distinguish signal from noise

**Significance Testing:**
- `*` indicates statistically significant difference (p < 0.05)
- Based on non-overlapping confidence intervals
- Prevents false positives from measurement variance

**Example Output:**
```
| Framework | Runtime | Average | Ping | Query | Body |
| --- | --- | --- | --- | --- | --- |
| hono (origin/main) | bun | 125,432.50 | 150,234.20 ± 2,345.67 | 125,678.90 ± 1,890.45 | 100,384.40 ± 1,567.23 |
| hono (current) | bun | 131,789.30 | 158,923.40 ± 2,123.89 | 130,456.70 ± 1,678.34 | 105,987.80 ± 1,456.78 |
| Change | | +5.07% | +5.78% * | +3.80% * | +5.58% * |
```

All improvements marked with `*` are statistically significant.

### Configuration Options

**Runs (--runs):**
- `--runs=1`: Quick iteration, higher variance (~30s total)
- `--runs=3`: **Default** - Good balance (~90s total)
- `--runs=5`: High confidence, slower (~150s total)

**Duration (--duration):**
- `--duration=3`: Quick test, less accurate
- `--duration=10`: **Default** - Good accuracy
- `--duration=15`: Maximum accuracy

**Comparison:**
```bash
# Compare specific branches
bun run benchmark.ts --baseline=main --target=feature-branch

# Quick iteration during development
bun run benchmark.ts --runs=1 --duration=5

# High-confidence validation before PR
bun run benchmark.ts --runs=5 --duration=15
```

### Output Files

**benchmark-results.md:**
- Human-readable markdown table
- Includes statistical notes
- Ready for PR comments

**benchmark-results.json:**
- Structured data with full statistics
- Enables programmatic analysis
- Supports trend tracking and historical comparison
- Schema:
  ```json
  {
    "config": { "baseline", "target", "runs", "duration", "concurrency" },
    "results": {
      "baseline": {
        "endpoints": { "ping", "query", "body" },
        "stats": { "mean", "stdDev", "ci95" }
      },
      "target": { ... },
      "comparison": { "changes", "significance" }
    }
  }
  ```

## Interpreting Results

### Confidence Intervals

**Tight intervals (< 2% of mean):**
- Example: `125,000 ± 1,000` (0.8%)
- Indicates stable, reliable measurement
- High confidence in reported values

**Wide intervals (> 5% of mean):**
- Example: `125,000 ± 8,000` (6.4%)
- Indicates measurement noise or system variability
- Consider increasing `--runs` or investigating system load

### Statistical Significance

**With * (significant):**
- Change exceeds combined confidence intervals
- Real performance difference detected
- Safe to claim improvement/regression

**Without * (not significant):**
- Change may be measurement noise
- Difference is within margin of error
- Need more runs or larger real change

**Interpreting percent changes:**
- `+10% *` → Clear, significant improvement
- `+10%` → Possible improvement, verify with more runs
- `+2%` → Likely noise unless highly significant
- `+0.5%` → Almost certainly measurement variance

### Variance Analysis

**Low variance (good):**
- Tight confidence intervals
- Consistent run-to-run results
- High measurement reliability
- Example: 3 runs with results: 125k, 126k, 125.5k req/s

**High variance (problematic):**
- Wide confidence intervals
- Inconsistent run-to-run results
- Measurement unreliability
- Example: 3 runs with results: 125k, 140k, 110k req/s

**Causes of high variance:**
- Background system load (close other applications)
- Thermal throttling (let system cool between runs)
- Network issues (use localhost only)
- JIT warmup differences (increase --duration)
- Non-deterministic code paths

## Rapid Performance Iteration Workflow

### Development Cycle

1. **Baseline measurement** (once):
   ```bash
   cd benchmarks/http-server
   bun run benchmark.ts --runs=3
   # Note results for comparison
   ```

2. **Quick iteration** (repeat):
   ```bash
   # Make code change
   nano src/context.ts

   # Fast test with single run
   cd benchmarks/http-server
   bun run benchmark.ts --runs=1 --duration=5 --target=current

   # If improvement detected, validate with 3 runs
   bun run benchmark.ts --runs=3 --target=current
   ```

3. **Final validation** (before PR):
   ```bash
   # High-confidence measurement
   bun run benchmark.ts --runs=5 --duration=10
   ```

### Performance Debugging

**Step 1: Establish baseline variance**
```bash
# Run benchmark twice against same code
bun run benchmark.ts --baseline=main --target=main --runs=3
```
This shows your system's noise floor.

**Step 2: Quick performance check**
```bash
# Single run for fast feedback
bun run benchmark.ts --runs=1 --target=current
```

**Step 3: Confirm real improvement**
```bash
# Multiple runs with statistics
bun run benchmark.ts --runs=5 --target=current
```
Look for `*` indicators on changes.

## Benchmark Reliability Best Practices

### 1. System Preparation
- Close unnecessary applications
- Disable background updates
- Let system stabilize after boot
- Consistent CPU frequency (disable power saving)

### 2. Measurement Configuration
- **Local development**: `--runs=1` for speed
- **Validation**: `--runs=3` for reliability
- **PR/CI**: `--runs=3-5` for confidence
- **Performance tracking**: `--runs=5` for precision

### 3. Interpreting Noise
- Variance < 2%: Excellent, trust results
- Variance 2-5%: Good, significant changes detectable
- Variance 5-10%: Fair, only large changes reliable
- Variance > 10%: Poor, investigate system issues

### 4. Claiming Performance Improvements
```markdown
✅ GOOD: "+15.3% throughput improvement (statistically significant, p<0.05)"
✅ GOOD: "+8.2% ± 1.5% improvement across 5 runs"
❌ BAD: "+2.3% faster" (without statistical validation)
❌ BAD: Single run result as definitive
```

## Advanced Usage

### Comparing Multiple Branches
```bash
# Compare feature branch against main
bun run benchmark.ts --baseline=main --target=feature/optimization

# Compare two feature branches
bun run benchmark.ts --baseline=feature/v1 --target=feature/v2
```

### Historical Trend Analysis
```bash
# Export results with timestamp
bun run benchmark.ts --runs=5 > results-$(date +%Y%m%d).log

# Store JSON for programmatic analysis
cp benchmarks/http-server/benchmark-results.json \
   results/benchmark-$(git rev-parse --short HEAD).json
```

### Programmatic Analysis
```javascript
// Load benchmark results
const results = JSON.parse(fs.readFileSync('benchmark-results.json'))

// Extract key metrics
const pingImprovement = results.results.comparison.changes.ping
const isSignificant = results.results.comparison.significance.ping

if (isSignificant && pingImprovement > 5) {
  console.log('🎉 Significant performance improvement detected!')
}
```

## Other Benchmark Tools

### Router Benchmarks
```bash
cd benchmarks/routers
# Uses mitata for micro-benchmarking
bun run src/bench.mts
```

**Use for:**
- Router algorithm changes
- Route matching performance
- Comparing router implementations

### JSX Benchmarks
```bash
cd benchmarks/jsx
# Uses benchmark.js with statistical analysis
bun run src/benchmark.ts
```

**Use for:**
- JSX rendering optimizations
- Component performance
- HTML generation speed

### Type-Check Performance
```bash
cd perf-measures/type-check
# Measures TypeScript compilation time
```

**Use for:**
- Type definition optimizations
- Compilation speed improvements
- Incremental build validation

## Common Pitfalls

### 1. Single-Run Bias
❌ **Problem**: Running benchmark once and claiming improvement
✅ **Solution**: Always use `--runs=3` minimum for validation

### 2. Ignoring Variance
❌ **Problem**: Reporting "5% faster" when confidence interval is ±10%
✅ **Solution**: Check significance indicators, report uncertainty

### 3. Cherry-Picking Results
❌ **Problem**: Re-running until you get favorable results
✅ **Solution**: Report all runs, including variance

### 4. Measurement During System Load
❌ **Problem**: Running benchmarks while compiling/downloading
✅ **Solution**: Ensure clean system, check variance as diagnostic

### 5. Optimizing for Benchmarks Only
❌ **Problem**: Changes that improve synthetic benchmarks but not real usage
✅ **Solution**: Test with realistic workloads, multiple scenarios

## Performance Budget Tracking

### Target Metrics (HTTP Benchmark)

| Endpoint | Baseline Target | Regression Threshold |
|----------|----------------|---------------------|
| Ping | >150k req/s | -5% (alert at 142.5k) |
| Query | >125k req/s | -5% (alert at 118.75k) |
| Body | >100k req/s | -5% (alert at 95k) |

### Detecting Regressions

```bash
# Run benchmark with strict checking
bun run benchmark.ts --runs=5

# Check for significant regressions (marked with *)
# If any endpoint shows -5% * or worse, investigate
```

## Historical Performance Tracking

**NEW**: Hono now includes comprehensive tools for tracking performance over time.

### Overview

The historical tracking system provides:
- **Persistent storage** of benchmark results in JSONL format
- **Trend analysis** with statistical summaries
- **Visual charts** (ASCII and HTML) for performance visualization
- **Git integration** to correlate performance with code changes
- **Flexible filtering** by branch, date range, and metrics

### Quick Start

```bash
cd benchmarks/http-server

# Run benchmark and track results
bun run benchmark.ts --runs=3
bun run track-performance.ts

# View performance trends
bun run analyze-performance.ts

# Generate visualizations
bun run visualize-performance.ts
bun run visualize-performance.ts --output=chart.html  # HTML chart
```

### Available Tools

1. **`track-performance.ts`** - Save benchmark results to historical database
   ```bash
   # Basic tracking
   bun run track-performance.ts

   # With meaningful tag
   bun run track-performance.ts --tag="release-1.5.0"
   ```

2. **`analyze-performance.ts`** - Analyze trends and detect regressions
   ```bash
   # Table view (default)
   bun run analyze-performance.ts

   # Last 7 days
   bun run analyze-performance.ts --since=7d

   # Export as JSON/CSV
   bun run analyze-performance.ts --format=json > data.json
   ```

3. **`visualize-performance.ts`** - Generate performance charts
   ```bash
   # ASCII chart in terminal
   bun run visualize-performance.ts

   # Interactive HTML chart
   bun run visualize-performance.ts --output=trends.html
   ```

### Workflow Integration

**Daily monitoring:**
```bash
# Automated daily check
bun run benchmark.ts --runs=3
bun run track-performance.ts --tag="daily-$(date +%Y%m%d)"
bun run analyze-performance.ts --since=7d
```

**Release validation:**
```bash
# Before release
bun run benchmark.ts --runs=5 --target=release-candidate
bun run track-performance.ts --tag="v1.5.0-rc"

# Generate release report
bun run visualize-performance.ts --since=30d --output=release-report.html
```

**CI integration:**
Add to CI pipeline to automatically track performance on every commit to main branch.

### Documentation

For complete documentation, see [PERFORMANCE_TRACKING_README.md](../../benchmarks/http-server/PERFORMANCE_TRACKING_README.md)

## Future Enhancements

Remaining potential improvements:

1. **Automated regression detection in CI** ✅ (tools available, needs CI workflow)
   - Fail PR if performance drops > 5% with significance
   - Post performance reports automatically

2. **Historical trend tracking** ✅ **COMPLETED**
   - Database of past results ✅
   - Visualization of performance over time ✅
   - Detect gradual degradation ✅

3. **Multi-platform benchmarking**
   - Test across different runtimes (Node, Bun, Deno)
   - Cross-platform performance validation

4. **Memory profiling integration**
   - Track allocations alongside throughput
   - GC pause time analysis

5. **Percentile analysis**
   - P50, P95, P99 latency reporting
   - Tail latency optimization

## Quick Reference

```bash
# Standard development workflow
bun run benchmark.ts --runs=1 --duration=5  # Quick iteration
bun run benchmark.ts                         # Validation (3 runs)
bun run benchmark.ts --runs=5               # Pre-PR confidence check

# Comparing branches
bun run benchmark.ts --baseline=main --target=feature

# Understanding output
# ± shows confidence interval (measurement uncertainty)
# * indicates statistically significant difference
# No * means change may be noise

# When to trust results
# - Tight CIs (< 2% of mean) → High confidence
# - Wide CIs (> 5% of mean) → Run more iterations
# - * on changes → Real performance difference
# - No * on changes → Likely measurement variance
```

## Summary

Hono's benchmark infrastructure provides:
- ✅ Statistical rigor (confidence intervals, significance testing)
- ✅ Multiple runs for reliability (default 3)
- ✅ Structured output (JSON + Markdown)
- ✅ Clear result interpretation (significance indicators)
- ✅ Flexible configuration (runs, duration, comparison targets)

This enables **fast, confident performance engineering** - you can quickly iterate on optimizations while reliably detecting real improvements and avoiding false positives from measurement noise.
