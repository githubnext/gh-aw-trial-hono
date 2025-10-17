# Historical Performance Tracking

Track Hono's HTTP performance over time to detect trends, regressions, and improvements across commits and releases.

## Quick Start

### 1. Store Benchmark Results

After running HTTP benchmarks, store the results in the historical database:

```bash
# Run benchmarks first
cd benchmarks/http-server
bun run benchmark.ts --runs=5

# Store results
cd ../performance-history
bun run store-results.ts
```

### 2. View Trends

Analyze performance trends over time:

```bash
# Table view (default)
bun run analyze-trends.ts

# Show last 20 entries
bun run analyze-trends.ts --last=20

# Filter by branch
bun run analyze-trends.ts --branch=main

# Detect regressions
bun run analyze-trends.ts --detect-regressions --threshold=-5
```

### 3. Visualize Performance

Generate ASCII charts:

```bash
# Overall performance chart
bun run generate-chart.ts

# Specific endpoint
bun run generate-chart.ts --endpoint=ping

# Custom height and last N entries
bun run generate-chart.ts --height=20 --last=30
```

## Tools

### store-results.ts

Stores HTTP benchmark results with git metadata for historical tracking.

**Usage:**
```bash
bun run store-results.ts [options]
```

**Options:**
- `--results-file=<path>` - Path to benchmark-results.json (default: ../http-server/benchmark-results.json)
- `--commit-sha=<sha>` - Git commit SHA (default: current HEAD)
- `--commit-message=<msg>` - Commit message (default: from git log)
- `--branch=<name>` - Branch name (default: current branch)
- `--pr-number=<num>` - Pull request number (optional)

**Output:**
- Appends entry to `history.jsonl` (JSON Lines format)
- One JSON object per line for efficient append and streaming
- Each entry includes benchmark results + git metadata

**Example:**
```bash
# Store results with PR number
bun run store-results.ts --pr-number=42
```

### analyze-trends.ts

Analyzes historical performance data to identify trends and regressions.

**Usage:**
```bash
bun run analyze-trends.ts [options]
```

**Options:**
- `--format=<fmt>` - Output format: table (default), json, or markdown
- `--last=<N>` - Show only last N entries (default: 10)
- `--branch=<name>` - Filter by branch name
- `--endpoint=<name>` - Filter by endpoint (ping, query, body, overall)
- `--detect-regressions` - Highlight performance regressions
- `--threshold=<pct>` - Regression threshold percentage (default: -5)

**Example Output (table format):**
```
📊 Performance History Analysis
================================

Date Range: Jan 15 - Jan 17
Entries: 10
Branches: main, perf/optimization

Trends (first → last):
  overall   : 📈 +12.34%
  ping      : 📈 +15.20%
  query     : 📈 +10.50%
  body      : 📈 +11.30%

Recent History:

Date         Commit    Branch          Overall      Ping         Query        Body         Message
------------ --------- --------------- ------------ ------------ ------------ ------------ ----------------------------------------
Jan 15       a1b2c3d   main            125000       150000       125000       100000       Initial performance baseline
Jan 16       d4e5f6g   perf/opt        130000       160000       130000       105000       Optimize context creation
Jan 17       g7h8i9j   perf/opt        140000       173000       138000       111000       Add fast path for JSON responses
```

**Example Output (markdown format):**
```bash
bun run analyze-trends.ts --format=markdown --last=20 > performance-report.md
```

**Example Output (JSON format):**
```bash
bun run analyze-trends.ts --format=json > trends.json
```

**Regression Detection:**
```bash
# Detect any regressions > 5%
bun run analyze-trends.ts --detect-regressions

# Stricter threshold (2%)
bun run analyze-trends.ts --detect-regressions --threshold=-2
```

### generate-chart.ts

Generates ASCII charts visualizing performance trends.

**Usage:**
```bash
bun run generate-chart.ts [options]
```

**Options:**
- `--endpoint=<name>` - Endpoint to chart (ping, query, body, overall) default: overall
- `--last=<N>` - Number of entries to chart (default: 20)
- `--height=<lines>` - Chart height in lines (default: 15)
- `--branch=<name>` - Filter by branch name

**Example Output:**
```
Overall Performance Trend (req/s)
==================================

  150000 ┤         ●─●─●
         ┤       ●─┘
         ┤     ●─┘
  137500 ┤   ●─┘
         ┤ ●─┘
         ┤●┘
  125000 ┤
         └────────────────────────────────────────
           a1b2c3d      d4e5f6g      g7h8i9j

Average: 137500 req/s
Trend: 📈 +20.00%
Range: 125000 - 150000 req/s
```

## Data Format

### history.jsonl

Historical data stored in JSON Lines format (one JSON object per line):

```jsonl
{"timestamp":"2025-01-15T10:00:00Z","git":{"commitSha":"a1b2c3d","branch":"main"},"results":{...}}
{"timestamp":"2025-01-16T10:00:00Z","git":{"commitSha":"d4e5f6g","branch":"main"},"results":{...}}
```

**Advantages of JSONL:**
- Efficient append-only operations
- Easy streaming and processing line-by-line
- No need to parse entire file for appending
- Simple to filter, grep, and process with standard tools

**Schema:**
```typescript
{
  timestamp: string              // ISO 8601 timestamp
  git: {
    commitSha: string            // Short SHA (7 chars)
    commitShaFull: string        // Full SHA
    commitMessage: string        // First line of commit message
    branch: string               // Branch name
    prNumber?: number            // PR number (optional)
  }
  config: {
    baseline: string             // Baseline git ref
    target: string               // Target git ref
    runs: number                 // Number of benchmark runs
    duration: number             // Duration per test (seconds)
    concurrency: number          // Concurrent connections
  }
  results: {
    baseline: number             // Baseline overall req/s
    target: number               // Target overall req/s
    endpoints: {
      ping: number               // Ping endpoint req/s
      query: number              // Query endpoint req/s
      body: number               // Body endpoint req/s
    }
    stats: {
      ping: { mean, stdDev, ci95 }
      query: { mean, stdDev, ci95 }
      body: { mean, stdDev, ci95 }
    }
  }
  comparison: {
    changes: {
      overall: number            // % change
      ping: number
      query: number
      body: number
    }
    significance: {
      ping: boolean              // Statistical significance
      query: boolean
      body: boolean
    }
  }
}
```

## Workflows

### Daily/Weekly Performance Tracking

Track performance on main branch over time:

```bash
#!/bin/bash
# track-performance.sh

cd benchmarks/http-server

# Run benchmarks
bun run benchmark.ts --runs=5 --baseline=origin/main --target=current

# Store results
cd ../performance-history
bun run store-results.ts

# Generate report
bun run analyze-trends.ts --last=7 --format=markdown > weekly-report.md

# Check for regressions
bun run analyze-trends.ts --detect-regressions --threshold=-3
```

### PR Performance Validation

Validate performance before merging:

```bash
#!/bin/bash
# pr-perf-check.sh
PR_NUMBER=$1
BRANCH=$(git branch --show-current)

cd benchmarks/http-server

# Run comprehensive benchmark
bun run benchmark.ts --runs=5 --baseline=origin/main --target=current

# Store with PR number
cd ../performance-history
bun run store-results.ts --pr-number=$PR_NUMBER --branch=$BRANCH

# Detect regressions
bun run analyze-trends.ts --detect-regressions --threshold=-5

if [ $? -ne 0 ]; then
  echo "❌ Performance regression detected!"
  exit 1
fi
```

### Release Performance Report

Generate comprehensive performance report for releases:

```bash
#!/bin/bash
# release-report.sh
VERSION=$1

cd benchmarks/performance-history

# Generate multiple views
echo "# Performance Report - $VERSION" > report.md
echo "" >> report.md

# Trends since last release
bun run analyze-trends.ts --format=markdown --last=50 >> report.md

# Charts for each endpoint
echo "## Overall Performance" >> report.md
bun run generate-chart.ts --endpoint=overall --last=50 >> report.md

echo "## Ping Endpoint" >> report.md
bun run generate-chart.ts --endpoint=ping --last=50 >> report.md

echo "## Query Endpoint" >> report.md
bun run generate-chart.ts --endpoint=query --last=50 >> report.md

echo "## Body Endpoint" >> report.md
bun run generate-chart.ts --endpoint=body --last=50 >> report.md
```

## Integration with CI

### GitHub Actions Example

```yaml
name: Performance Tracking

on:
  push:
    branches: [main]
  pull_request:

jobs:
  performance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Need history for baseline comparison

      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Install bombardier
        run: |
          wget https://github.com/codesenberg/bombardier/releases/download/v1.2.6/bombardier-linux-amd64
          chmod +x bombardier-linux-amd64
          sudo mv bombardier-linux-amd64 /usr/local/bin/bombardier

      - name: Run HTTP benchmarks
        run: |
          cd benchmarks/http-server
          bun run benchmark.ts --runs=3

      - name: Store results (main branch only)
        if: github.ref == 'refs/heads/main'
        run: |
          cd benchmarks/performance-history
          bun run store-results.ts --pr-number=${{ github.event.pull_request.number }}

      - name: Check for regressions
        run: |
          cd benchmarks/performance-history
          bun run analyze-trends.ts --detect-regressions --threshold=-5

      - name: Generate report
        if: always()
        run: |
          cd benchmarks/performance-history
          bun run analyze-trends.ts --format=markdown --last=10 > $GITHUB_STEP_SUMMARY
```

## Best Practices

### When to Store Results

✅ **DO store:**
- After merging to main branch
- For release tags
- Weekly/daily automated tracking
- When validating major optimizations

❌ **DON'T store:**
- Every development commit
- Failed benchmarks
- Benchmarks with high variance (rerun instead)
- Non-representative environments (underpowered CI)

### Interpreting Trends

**Positive Trends (📈):**
- Improvements in req/s over time
- Successful optimization work
- Performance enhancements

**Negative Trends (📉):**
- Performance regressions
- May indicate added features impacting performance
- Investigate commits in the range

**Stable Trends (➡️):**
- Consistent performance
- Framework stability
- Good for baseline expectations

### Regression Investigation

When a regression is detected:

1. **Identify the commit:**
   ```bash
   bun run analyze-trends.ts --detect-regressions
   # Note the commit SHA
   ```

2. **Review the changes:**
   ```bash
   git show <commit-sha>
   ```

3. **Run targeted benchmarks:**
   ```bash
   cd benchmarks/http-server
   bun run benchmark.ts --baseline=<commit-sha>~1 --target=<commit-sha> --runs=5
   ```

4. **Profile if needed:**
   ```bash
   cd ../../tools
   bun run profile.ts ../benchmarks/profile-target.mjs
   ```

## Limitations

- **Local only:** History stored locally in git repository
- **Manual execution:** Not automated by default (can integrate with CI)
- **Single runtime:** Tracks Bun only (can extend for Node.js, Deno)
- **No web UI:** Terminal/markdown output only (can generate HTML reports)

## Future Enhancements

Potential improvements:

1. **Multi-runtime tracking:** Support Node.js, Deno, Cloudflare Workers
2. **Web dashboard:** HTML visualization with interactive charts
3. **Database backend:** PostgreSQL/SQLite for advanced queries
4. **Automated tracking:** CI integration for automatic storage
5. **Comparison views:** Compare branches, releases, runtime versions
6. **Alerting:** Email/Slack notifications for regressions
7. **Export formats:** CSV, Excel for further analysis

## Troubleshooting

### No history.jsonl file

```bash
# Run benchmark first
cd benchmarks/http-server
bun run benchmark.ts

# Then store results
cd ../performance-history
bun run store-results.ts
```

### High variance in results

```bash
# Run more iterations
cd benchmarks/http-server
bun run benchmark.ts --runs=5 --duration=15

# Check system load
top
# Close unnecessary applications

# Verify results are consistent before storing
```

### Git metadata errors

```bash
# Ensure you're in a git repository
git status

# Fetch latest changes
git fetch origin

# Verify commit exists
git log --oneline -10
```

## Summary

Historical performance tracking provides:

- ✅ **Trend analysis:** Identify long-term performance changes
- ✅ **Regression detection:** Catch performance degradation early
- ✅ **Release validation:** Ensure releases maintain/improve performance
- ✅ **Data-driven decisions:** Make optimization decisions based on trends
- ✅ **Documentation:** Historical record of performance work

Start tracking today to build a comprehensive performance baseline for Hono!
