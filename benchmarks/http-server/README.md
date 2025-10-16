# Hono HTTP Benchmark

HTTP performance benchmarking tool that compares baseline vs target versions with statistical analysis.

## Features

- **Multiple Runs**: Default 3 runs for reliable measurements
- **Statistical Analysis**: Standard deviation and 95% confidence intervals
- **Significance Testing**: Automatically detects statistically significant changes
- **JSON Export**: Structured data for programmatic analysis and trend tracking
- **Flexible Configuration**: Customize baseline, target, runs, and duration

## Usage

### Quick Start

```bash
cd benchmarks/http-server
bun run benchmark.ts
```

This compares `origin/main` (baseline) vs your current code (target) with 3 runs per endpoint.

### Options

```bash
bun run benchmark.ts [options]

Options:
  --baseline=<ref>    Git reference for baseline (default: origin/main)
  --target=<ref>      Git reference for target (default: current)
  --runs=<number>     Number of benchmark runs (default: 3)
  --duration=<number> Duration of each test in seconds (default: 10)
  --skip-tests        Skip endpoint validation tests
```

### Examples

**Compare two branches:**
```bash
bun run benchmark.ts --baseline=main --target=feature-branch
```

**Quick test with single run:**
```bash
bun run benchmark.ts --runs=1 --duration=5
```

**High-confidence measurement:**
```bash
bun run benchmark.ts --runs=5 --duration=15
```

## Output

### Console
- Formatted table with confidence intervals
- Statistical significance indicators (*)
- Measurement reliability notes

### Files
- `benchmark-results.md` - Human-readable markdown table
- `benchmark-results.json` - Structured data with full statistics

### Understanding Results

**Confidence Intervals (±):**
- Shows measurement uncertainty
- Smaller = more reliable
- Example: `125,432.50 ± 1,234.56` means true value likely between 124,198 and 126,667

**Significance Indicator (*):**
- `*` = statistically significant difference (p < 0.05)
- No `*` = difference may be measurement noise
- Helps distinguish real improvements from variance

**Example Output:**
```
| Framework | Runtime | Average | Ping | Query | Body |
| --- | --- | --- | --- | --- | --- |
| hono (origin/main) | bun | 125,432.50 | 150,234.20 ± 2,345.67 | 125,678.90 ± 1,890.45 | 100,384.40 ± 1,567.23 |
| hono (current) | bun | 131,789.30 | 158,923.40 ± 2,123.89 | 130,456.70 ± 1,678.34 | 105,987.80 ± 1,456.78 |
| Change | | +5.07% | +5.78% * | +3.80% * | +5.58% * |
```

In this example, all endpoint improvements are statistically significant (marked with *).

## Prerequisites

- Bun v1.0+
- bombardier (`brew install bombardier` on macOS)

## Methodology

1. **Multiple Runs**: Each endpoint tested multiple times (default 3)
2. **Warm-up**: First request per run warms up the server
3. **Load Testing**: bombardier with 500 concurrent connections
4. **Statistical Analysis**:
   - Mean (average) across all runs
   - Standard deviation (spread of results)
   - 95% confidence interval (measurement reliability)
   - Significance testing (non-overlapping CIs)

## Performance Engineering Tips

- **Single run** (`--runs=1`): Quick iteration, higher variance
- **3 runs** (default): Good balance of speed and reliability
- **5+ runs**: High confidence, slower execution
- Look for `*` indicators to identify real performance changes
- Small confidence intervals (<2% of mean) indicate stable results
- Large confidence intervals suggest measurement noise or system variability
