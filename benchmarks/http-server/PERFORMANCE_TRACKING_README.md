# Historical Performance Tracking

Comprehensive tools for tracking, analyzing, and visualizing Hono's performance over time.

## Overview

The historical performance tracking system provides:
- **Persistent storage** of benchmark results in JSONL format
- **Trend analysis** with statistical summaries
- **Visual charts** (ASCII and HTML) for performance visualization
- **Git integration** to correlate performance with code changes
- **Flexible filtering** by branch, date range, and metrics

## Quick Start

### 1. Run Benchmarks and Track Results

```bash
cd benchmarks/http-server

# Run benchmark
bun run benchmark.ts --runs=3

# Save results to history
bun run track-performance.ts

# Optional: Add a tag for this measurement
bun run track-performance.ts --tag="before-optimization"
```

### 2. View Performance Trends

```bash
# Table view (default)
bun run analyze-performance.ts

# JSON output for programmatic analysis
bun run analyze-performance.ts --format=json

# CSV export for spreadsheets
bun run analyze-performance.ts --format=csv > performance.csv

# Filter by date
bun run analyze-performance.ts --since=7d    # Last 7 days
bun run analyze-performance.ts --since=30d   # Last 30 days
bun run analyze-performance.ts --since=2025-10-01  # Since specific date
```

### 3. Visualize Performance

```bash
# ASCII chart in terminal
bun run visualize-performance.ts

# Generate interactive HTML chart
bun run visualize-performance.ts --output=performance-chart.html

# Focus on specific metric
bun run visualize-performance.ts --metric=ping
```

## Tools

### `track-performance.ts` - Save Benchmark Results

Saves benchmark results to historical database with git metadata.

**Usage:**
```bash
bun run track-performance.ts [options]
```

**Options:**
- `--input=<file>` - Input JSON file (default: `benchmark-results.json`)
- `--db=<file>` - Database file (default: `.performance-history/history.jsonl`)
- `--branch=<name>` - Override branch name (default: auto-detect)
- `--commit=<sha>` - Override commit SHA (default: auto-detect)
- `--tag=<tag>` - Add a tag to this entry (e.g., "release-1.0", "pre-optimization")

**Example:**
```bash
# Basic tracking after benchmark
bun run benchmark.ts && bun run track-performance.ts

# Track with a meaningful tag
bun run track-performance.ts --tag="baseline-measurement"

# Track results from a specific file
bun run track-performance.ts --input=custom-results.json
```

### `analyze-performance.ts` - Analyze Performance Trends

Analyzes historical data to detect trends, patterns, and regressions.

**Usage:**
```bash
bun run analyze-performance.ts [options]
```

**Options:**
- `--db=<file>` - Database file (default: `.performance-history/history.jsonl`)
- `--branch=<name>` - Filter by branch (default: all branches)
- `--since=<date>` - Show data since date (ISO or relative: `7d`, `30d`, `2w`)
- `--limit=<number>` - Limit number of entries (default: 20)
- `--format=<type>` - Output format: `table`, `json`, `csv` (default: `table`)
- `--metric=<name>` - Focus metric: `overall`, `ping`, `query`, `body` (default: `overall`)

**Example:**
```bash
# View recent history
bun run analyze-performance.ts

# Last 7 days only
bun run analyze-performance.ts --since=7d

# Export as JSON for dashboards
bun run analyze-performance.ts --format=json > dashboard-data.json

# CSV for spreadsheet analysis
bun run analyze-performance.ts --format=csv > performance-history.csv

# Filter by branch
bun run analyze-performance.ts --branch=main --limit=50

# Focus on specific endpoint
bun run analyze-performance.ts --metric=ping
```

**Output Example:**
```
📊 Summary Statistics (overall)
──────────────────────────────────────────────────
  Total entries: 15
  Mean: 132450.50 req/s
  Median: 131000.00 req/s
  Min: 128000.00 req/s
  Max: 138500.00 req/s
  Trend: 📈 Improving

📋 Recent Performance History (overall)
───────────────────────────────────────────────────────────────
Date                Commit   Branch     Value       Change   Tag
───────────────────────────────────────────────────────────────
2025-10-17 10:30:00  a3f7e9c  main       138500.00    +5.2%  v1.5.0
2025-10-17 09:15:00  f2d4a1b  main       131500.00    +2.7%
2025-10-17 08:00:00  c9e1b8a  feature    128000.00    +0.5%
```

### `visualize-performance.ts` - Generate Charts

Creates visual representations of performance trends.

**Usage:**
```bash
bun run visualize-performance.ts [options]
```

**Options:**
- `--db=<file>` - Database file (default: `.performance-history/history.jsonl`)
- `--branch=<name>` - Filter by branch
- `--since=<date>` - Show data since date
- `--metric=<name>` - Metric to visualize: `overall`, `ping`, `query`, `body`
- `--output=<file>` - Generate HTML chart (if not specified, shows ASCII chart)
- `--height=<number>` - ASCII chart height in lines (default: 15)

**Example:**
```bash
# ASCII chart in terminal
bun run visualize-performance.ts

# Focus on specific metric
bun run visualize-performance.ts --metric=query

# Generate interactive HTML chart
bun run visualize-performance.ts --output=performance-chart.html
open performance-chart.html  # Open in browser

# Filtered HTML chart
bun run visualize-performance.ts --branch=main --since=30d --output=main-branch-trend.html
```

**ASCII Chart Example:**
```
📊 Performance Over Time (overall)
────────────────────────────────────────────────────────────────────────────────
     138500 req/s ┤                                             ●
                │                                         ●───●
                │                                     ●───╯
                │                                 ●───╯
                │                             ●───╯
                │                         ●───╯
                │                     ●───╯
                │                 ●───╯
                │             ●───╯
                │         ●───╯
                │     ●───╯
                │ ●───╯
     128000 req/s └──────────────────────────────────────────────────
                 ┬    ┬    ┬    ┬    ┬    ┬    ┬    ┬    ┬    ┬
                 10-01 10-03 10-05 10-07 10-09 10-11 10-13 10-15 10-17

   Latest: 138500.00 req/s
   Average: 132450.50 req/s
   Min: 128000.00 req/s
   Max: 138500.00 req/s
   Range: 10500.00 req/s (8.2%)
```

## Workflow Examples

### Daily Performance Monitoring

```bash
#!/bin/bash
# daily-performance-check.sh

cd benchmarks/http-server

# Run benchmark
bun run benchmark.ts --runs=3

# Track results
bun run track-performance.ts --tag="daily-$(date +%Y%m%d)"

# Check for significant changes
bun run analyze-performance.ts --since=7d
```

### Release Performance Validation

```bash
# Before release
bun run benchmark.ts --runs=5 --target=release-candidate
bun run track-performance.ts --tag="release-1.5.0-candidate"

# After release
bun run benchmark.ts --runs=5 --target=main
bun run track-performance.ts --tag="release-1.5.0-final"

# Generate release report
bun run analyze-performance.ts --since=30d --format=json > release-1.5.0-performance.json
bun run visualize-performance.ts --since=30d --output=release-1.5.0-chart.html
```

### Optimization Campaign Tracking

```bash
# Establish baseline
bun run benchmark.ts --runs=5
bun run track-performance.ts --tag="baseline-before-context-optimization"

# ... make optimizations ...

# Measure improvement
bun run benchmark.ts --runs=5
bun run track-performance.ts --tag="after-context-optimization"

# Visualize impact
bun run visualize-performance.ts --since=1d
bun run analyze-performance.ts --since=1d
```

### CI Integration

Add to your CI pipeline:

```yaml
# .github/workflows/performance-tracking.yml
name: Performance Tracking

on:
  push:
    branches: [main]

jobs:
  track:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - name: Run benchmark
        run: |
          cd benchmarks/http-server
          bun run benchmark.ts --runs=3

      - name: Track performance
        run: |
          cd benchmarks/http-server
          bun run track-performance.ts --tag="ci-${{ github.run_number }}"

      - name: Generate trend report
        run: |
          cd benchmarks/http-server
          bun run analyze-performance.ts --since=30d > performance-report.txt
          cat performance-report.txt

      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: performance-data
          path: benchmarks/http-server/.performance-history/
```

## Data Format

### Database Format (JSONL)

The history database uses JSONL (JSON Lines) format - one JSON object per line.

```json
{
  "timestamp": "2025-10-17T10:00:00.000Z",
  "git": {
    "branch": "main",
    "commit": "a3f7e9c",
    "commitFull": "a3f7e9c8d5f2e1b4c7a9d6e3f8b1c4a7d9e2f5b",
    "message": "feat: add historical performance tracking"
  },
  "config": {
    "baseline": "origin/main",
    "target": "current",
    "runs": 3,
    "duration": 10
  },
  "results": {
    "target": {
      "overall": 135000,
      "endpoints": {
        "ping": { "mean": 160000, "stdDev": 1850, "ci95": 1400 },
        "query": { "mean": 135000, "stdDev": 1650, "ci95": 1250 },
        "body": { "mean": 110000, "stdDev": 1350, "ci95": 1050 }
      }
    },
    "comparison": {
      "changes": {
        "overall": 8.0,
        "ping": 6.7,
        "query": 8.0,
        "body": 10.0
      }
    }
  },
  "tag": "after-optimization"
}
```

### Benefits of JSONL Format

- **Append-only**: New entries added without parsing entire file
- **Streaming-friendly**: Can process large files line-by-line
- **Human-readable**: Each line is valid JSON
- **Tool-compatible**: Works with standard JSON parsers and command-line tools

```bash
# Count total entries
wc -l .performance-history/history.jsonl

# View latest entry
tail -1 .performance-history/history.jsonl | jq .

# Extract specific fields with jq
cat .performance-history/history.jsonl | jq '.results.target.overall'

# Filter entries by branch
cat .performance-history/history.jsonl | jq 'select(.git.branch == "main")'
```

## Best Practices

### 1. Regular Tracking

Track performance regularly to build a robust baseline:
- **Daily** (automated): Catch gradual regressions
- **Per PR** (CI): Validate changes don't regress performance
- **Per release**: Document performance characteristics

### 2. Meaningful Tags

Use descriptive tags to mark important measurements:
- Release milestones: `release-1.5.0`
- Before/after optimizations: `before-context-opt`, `after-context-opt`
- Baseline measurements: `baseline-2025-10-17`
- Platform changes: `node-20-upgrade`

### 3. Branch Filtering

Track main branch separately from feature branches for cleaner trend analysis:

```bash
# Main branch trends (stable)
bun run analyze-performance.ts --branch=main --since=30d

# Feature branch comparison
bun run analyze-performance.ts --branch=feature/optimization --since=7d
```

### 4. Backup and Version Control

The `.performance-history/` directory is git-ignored by default (contains generated data).
To preserve historical data:

```bash
# Backup to external storage
tar -czf performance-history-backup-$(date +%Y%m%d).tar.gz \
  benchmarks/http-server/.performance-history/

# Or commit to a separate branch
git checkout --orphan performance-data
git add benchmarks/http-server/.performance-history/
git commit -m "Performance data snapshot $(date +%Y-%m-%d)"
git push origin performance-data
```

### 5. Dashboard Integration

Export data for external dashboards:

```bash
# Generate JSON for Grafana/custom dashboards
bun run analyze-performance.ts --format=json --since=90d > dashboard-data.json

# Generate CSV for Google Sheets/Excel
bun run analyze-performance.ts --format=csv --since=90d > performance.csv

# Generate HTML charts for documentation
bun run visualize-performance.ts --output=docs/performance-trends.html
```

## Troubleshooting

### "History database not found"

Run `track-performance.ts` first to create the database:

```bash
bun run benchmark.ts && bun run track-performance.ts
```

### "No data to visualize"

Ensure you have at least 2 entries in the database:

```bash
# Check entry count
wc -l benchmarks/http-server/.performance-history/history.jsonl

# Add more entries
bun run benchmark.ts && bun run track-performance.ts
```

### Git metadata issues

If running outside a git repository, manually specify commit/branch:

```bash
bun run track-performance.ts --branch=main --commit=abc123def
```

### High variance in trends

If you see unstable trends with high variance:
- Close unnecessary applications before benchmarking
- Use `--runs=5` for more stable measurements
- Check system load during benchmark execution
- Review recent code changes for non-deterministic behavior

## Advanced Usage

### Programmatic Analysis

```typescript
import { readFileSync } from 'fs'

// Load history
const lines = readFileSync('.performance-history/history.jsonl', 'utf-8')
  .trim()
  .split('\n')
const entries = lines.map((line) => JSON.parse(line))

// Calculate regression detection
const recentMean = entries.slice(0, 5).reduce((sum, e) => sum + e.results.target.overall, 0) / 5
const historicalMean = entries.slice(5).reduce((sum, e) => sum + e.results.target.overall, 0) / (entries.length - 5)
const regression = ((recentMean - historicalMean) / historicalMean) * 100

if (regression < -5) {
  console.error(`⚠️  Performance regression detected: ${regression.toFixed(2)}%`)
  process.exit(1)
}
```

### Custom Metrics

Track custom metrics by extending the tracking system:

```typescript
// Add custom field to benchmark-results.json
const customResults = {
  ...benchmarkResults,
  custom: {
    memoryUsage: process.memoryUsage().heapUsed,
    cpuProfile: profileData,
  }
}

// Track with custom data
writeFileSync('benchmark-results.json', JSON.stringify(customResults, null, 2))
```

## Related Documentation

- [Benchmark Infrastructure Guide](../../.github/copilot/instructions/benchmark-infrastructure.md)
- [Performance Measurement Guide](../../.github/copilot/instructions/performance-measurement.md)
- [Performance Status Report](../../.github/copilot/instructions/performance-status-report.md)

## Summary

The historical performance tracking system provides comprehensive tools for:
- ✅ **Persistent storage** of benchmark results
- ✅ **Trend analysis** with statistical insights
- ✅ **Visual charts** for performance visualization
- ✅ **Git integration** to correlate performance with code changes
- ✅ **Flexible filtering** and export options
- ✅ **CI/CD integration** for automated tracking

This enables data-driven performance engineering and helps detect regressions early.
