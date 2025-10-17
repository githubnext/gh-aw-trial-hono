/**
 * Performance Visualization Tool
 *
 * Generates ASCII charts and HTML visualizations from historical performance data.
 *
 * Usage:
 *   bun run visualize-performance.ts [options]
 *
 * Options:
 *   --db=<file>        Database file (default: .performance-history/history.jsonl)
 *   --branch=<name>    Filter by branch (default: all branches)
 *   --since=<date>     Show data since date (ISO format or relative like "7d", "30d")
 *   --metric=<name>    Metric to visualize: overall, ping, query, body (default: overall)
 *   --output=<file>    Output HTML file (if specified, generates HTML chart)
 *   --height=<number>  Chart height in lines (default: 15)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPT_DIR = import.meta.dirname
const DEFAULT_DB = join(SCRIPT_DIR, '.performance-history/history.jsonl')

// Parse command line arguments
const args = process.argv.slice(2)
const getArg = (name: string, defaultValue?: string) => {
  const arg = args.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.split('=')[1] : defaultValue
}

const dbFile = getArg('db', DEFAULT_DB)
const branchFilter = getArg('branch')
const sinceArg = getArg('since')
const metric = getArg('metric', 'overall') as 'overall' | 'ping' | 'query' | 'body'
const outputFile = getArg('output')
const chartHeight = parseInt(getArg('height', '15') || '15')

interface HistoryEntry {
  timestamp: string
  git: {
    branch: string
    commit: string
    message: string
  }
  results: {
    target: {
      overall: number
      endpoints: {
        ping: { mean: number }
        query: { mean: number }
        body: { mean: number }
      }
    }
  }
  tag?: string
}

const parseRelativeDate = (relative: string): Date | null => {
  const match = relative.match(/^(\d+)([dwhm])$/)
  if (!match) return null

  const value = parseInt(match[1])
  const unit = match[2]

  const now = new Date()
  switch (unit) {
    case 'd':
      return new Date(now.getTime() - value * 24 * 60 * 60 * 1000)
    case 'w':
      return new Date(now.getTime() - value * 7 * 24 * 60 * 60 * 1000)
    case 'h':
      return new Date(now.getTime() - value * 60 * 60 * 1000)
    case 'm':
      return new Date(now.getTime() - value * 30 * 24 * 60 * 60 * 1000)
    default:
      return null
  }
}

// Generate ASCII chart
const generateASCIIChart = (entries: HistoryEntry[]) => {
  if (entries.length === 0) {
    console.log('No data to visualize')
    return
  }

  const getValue = (entry: HistoryEntry): number => {
    if (metric === 'overall') return entry.results.target.overall
    return entry.results.target.endpoints[metric].mean
  }

  const values = entries.map(getValue)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min

  // Scale values to chart height
  const scale = (value: number) => {
    if (range === 0) return Math.floor(chartHeight / 2)
    return Math.floor(((value - min) / range) * (chartHeight - 1))
  }

  console.log(`📊 Performance Over Time (${metric})`)
  console.log('─'.repeat(80))
  console.log(`   ${max.toFixed(0).padStart(8)} req/s ┤`)

  // Draw chart from top to bottom
  for (let row = chartHeight - 1; row >= 0; row--) {
    let line = ''.padStart(16) + '│'
    for (let i = 0; i < entries.length; i++) {
      const scaledValue = scale(values[i])
      const prevScaledValue = i > 0 ? scale(values[i - 1]) : scaledValue
      if (scaledValue === row) {
        line += '●'
      } else if (i > 0 && scaledValue > row && prevScaledValue < row) {
        line += '╱'
      } else if (i > 0 && scaledValue < row && prevScaledValue > row) {
        line += '╲'
      } else if (i > 0 && scaledValue === prevScaledValue && scaledValue === row) {
        line += '─'
      } else {
        line += ' '
      }
    }
    console.log(line)
  }

  console.log(`   ${min.toFixed(0).padStart(8)} req/s └${'─'.repeat(entries.length)}`)
  console.log(''.padStart(17) + entries.map((_, i) => (i % 5 === 0 ? '┬' : ' ')).join(''))

  // X-axis labels (dates)
  const dateLabels = entries.map((e, i) => {
    if (i % 5 === 0 || i === entries.length - 1) {
      return new Date(e.timestamp).toISOString().substring(5, 10)
    }
    return ''
  })

  console.log(''.padStart(17) + dateLabels.map((d) => d.padEnd(1)).join(''))
  console.log('')

  // Legend
  console.log(`   Latest: ${values[values.length - 1].toFixed(2)} req/s`)
  console.log(`   Average: ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)} req/s`)
  console.log(`   Min: ${min.toFixed(2)} req/s`)
  console.log(`   Max: ${max.toFixed(2)} req/s`)
  console.log(`   Range: ${range.toFixed(2)} req/s (${((range / min) * 100).toFixed(1)}%)`)
}

// Generate HTML chart with Chart.js
const generateHTMLChart = (entries: HistoryEntry[], outputPath: string) => {
  const getValue = (entry: HistoryEntry): number => {
    if (metric === 'overall') return entry.results.target.overall
    return entry.results.target.endpoints[metric].mean
  }

  const labels = entries.map((e) => new Date(e.timestamp).toISOString().substring(0, 10))
  const values = entries.map(getValue)
  const commits = entries.map((e) => e.git.commit)
  const messages = entries.map((e) => e.git.message)

  const html = `<!DOCTYPE html>
<html>
<head>
    <title>Hono Performance History - ${metric}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js"></script>
    <style>
        body {
            font-family: system-ui, -apple-system, sans-serif;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-bottom: 10px;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        .stat-card {
            background: #f9f9f9;
            padding: 15px;
            border-radius: 4px;
            border-left: 4px solid #007bff;
        }
        .stat-label {
            font-size: 14px;
            color: #666;
            margin-bottom: 5px;
        }
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #333;
        }
        canvas {
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Hono Performance History</h1>
        <p>Metric: <strong>${metric}</strong> | Entries: ${entries.length} | Generated: ${new Date()
    .toISOString()
    .substring(0, 19)
    .replace('T', ' ')}</p>

        <div class="stats">
            <div class="stat-card">
                <div class="stat-label">Latest</div>
                <div class="stat-value">${values[values.length - 1].toFixed(
                  2
                )} <span style="font-size: 14px;">req/s</span></div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Average</div>
                <div class="stat-value">${(
                  values.reduce((a, b) => a + b, 0) / values.length
                ).toFixed(2)} <span style="font-size: 14px;">req/s</span></div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Min</div>
                <div class="stat-value">${Math.min(...values).toFixed(
                  2
                )} <span style="font-size: 14px;">req/s</span></div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Max</div>
                <div class="stat-value">${Math.max(...values).toFixed(
                  2
                )} <span style="font-size: 14px;">req/s</span></div>
            </div>
        </div>

        <canvas id="performanceChart"></canvas>
    </div>

    <script>
        const ctx = document.getElementById('performanceChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [{
                    label: 'Performance (req/s)',
                    data: ${JSON.stringify(values)},
                    borderColor: '#007bff',
                    backgroundColor: 'rgba(0, 123, 255, 0.1)',
                    borderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'Performance Trend Over Time',
                        font: { size: 16 }
                    },
                    tooltip: {
                        callbacks: {
                            title: (context) => {
                                const index = context[0].dataIndex;
                                return \`\${labels[index]} (commit \${${JSON.stringify(
                                  commits
                                )}[index]})\`;
                            },
                            label: (context) => {
                                const index = context.dataIndex;
                                return [
                                    \`Performance: \${context.parsed.y.toFixed(2)} req/s\`,
                                    \`Message: \${${JSON.stringify(messages)}[index]}\`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        title: {
                            display: true,
                            text: 'Requests per Second'
                        },
                        beginAtZero: false
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Date'
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>`

  writeFileSync(outputPath, html)
  console.log(`✅ HTML chart generated: ${outputPath}`)
  console.log(`   Open it in a browser to view the interactive chart`)
}

const main = () => {
  if (!existsSync(dbFile)) {
    console.error(`❌ History database not found: ${dbFile}`)
    console.error('   Run track-performance.ts first to create historical data')
    throw new Error('History database not found')
  }

  // Load entries
  const content = readFileSync(dbFile, 'utf-8')
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line.trim())

  if (lines.length === 0) {
    console.log('No historical data found yet.')
    return
  }

  let entries: HistoryEntry[] = lines.map((line) => JSON.parse(line))

  // Apply filters
  if (branchFilter) {
    entries = entries.filter((e) => e.git.branch === branchFilter)
  }

  if (sinceArg) {
    let sinceDate: Date
    const relativeDate = parseRelativeDate(sinceArg)
    if (relativeDate) {
      sinceDate = relativeDate
    } else {
      sinceDate = new Date(sinceArg)
      if (isNaN(sinceDate.getTime())) {
        console.error(`❌ Invalid date format: ${sinceArg}`)
        throw new Error('Invalid date format')
      }
    }
    entries = entries.filter((e) => new Date(e.timestamp) >= sinceDate)
  }

  // Sort by timestamp (oldest first for visualization)
  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  if (entries.length === 0) {
    console.log('No entries match the specified filters.')
    return
  }

  if (outputFile) {
    generateHTMLChart(entries, outputFile)
  } else {
    generateASCIIChart(entries)
  }
}

main()
