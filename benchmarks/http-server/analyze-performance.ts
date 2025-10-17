/**
 * Performance Trend Analysis Tool
 *
 * Analyzes historical performance data to detect trends, regressions, and improvements.
 *
 * Usage:
 *   bun run analyze-performance.ts [options]
 *
 * Options:
 *   --db=<file>        Database file (default: .performance-history/history.jsonl)
 *   --branch=<name>    Filter by branch (default: all branches)
 *   --since=<date>     Show data since date (ISO format or relative like "7d", "30d")
 *   --limit=<number>   Limit number of entries (default: 20)
 *   --format=<type>    Output format: table, json, csv (default: table)
 *   --metric=<name>    Focus on specific metric: overall, ping, query, body (default: overall)
 */

import { existsSync, readFileSync } from 'node:fs'
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
const limitArg = parseInt(getArg('limit', '20') || '20')
const format = getArg('format', 'table') as 'table' | 'json' | 'csv'
const metric = getArg('metric', 'overall') as 'overall' | 'ping' | 'query' | 'body'

interface HistoryEntry {
  timestamp: string
  git: {
    branch: string
    commit: string
    commitFull: string
    message: string
  }
  config: {
    baseline: string
    target: string
    runs: number
    duration: number
  }
  results: {
    target: {
      overall: number
      endpoints: {
        ping: { mean: number; stdDev: number; ci95: number }
        query: { mean: number; stdDev: number; ci95: number }
        body: { mean: number; stdDev: number; ci95: number }
      }
    }
    comparison: {
      changes: {
        overall: number
        ping: number
        query: number
        body: number
      }
    }
  }
  tag?: string
}

// Parse relative date strings like "7d", "30d"
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

const main = () => {
  console.log('📈 Performance Trend Analysis')
  console.log('==============================\n')

  // Check if database exists
  if (!existsSync(dbFile)) {
    console.error(`❌ History database not found: ${dbFile}`)
    console.error('   Run track-performance.ts first to create historical data')
    throw new Error('History database not found')
  }

  // Load all entries
  const content = readFileSync(dbFile, 'utf-8')
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line.trim())

  if (lines.length === 0) {
    console.log('No historical data found yet.')
    console.log('Run benchmark.ts and track-performance.ts to collect data.')
    return
  }

  let entries: HistoryEntry[] = lines.map((line) => JSON.parse(line))

  // Apply filters
  if (branchFilter) {
    entries = entries.filter((e) => e.git.branch === branchFilter)
    if (entries.length === 0) {
      console.log(`No entries found for branch: ${branchFilter}`)
      return
    }
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
        console.error('   Use ISO format (2025-10-01) or relative (7d, 30d, 2w)')
        throw new Error('Invalid date format')
      }
    }
    entries = entries.filter((e) => new Date(e.timestamp) >= sinceDate)
  }

  // Sort by timestamp (newest first)
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  // Apply limit
  entries = entries.slice(0, limitArg)

  if (entries.length === 0) {
    console.log('No entries match the specified filters.')
    return
  }

  // Calculate statistics
  const calculateStats = () => {
    const getValue = (entry: HistoryEntry): number => {
      if (metric === 'overall') return entry.results.target.overall
      return entry.results.target.endpoints[metric].mean
    }

    const values = entries.map(getValue)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const sorted = [...values].sort((a, b) => a - b)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    const median = sorted[Math.floor(sorted.length / 2)]

    // Calculate trend (simple linear regression)
    const n = entries.length
    const xMean = (n - 1) / 2
    const xySum = values.reduce((sum, y, i) => sum + i * y, 0)
    const xxSum = values.reduce((sum, _, i) => sum + i * i, 0)
    const slope = (xySum - n * xMean * mean) / (xxSum - n * xMean * xMean)
    const trend = slope > 0.1 ? '📈 Improving' : slope < -0.1 ? '📉 Declining' : '➡️  Stable'

    return { mean, min, max, median, trend, count: n }
  }

  const stats = calculateStats()

  // Output based on format
  if (format === 'json') {
    console.log(
      JSON.stringify(
        {
          summary: stats,
          entries: entries.map((e) => ({
            timestamp: e.timestamp,
            commit: e.git.commit,
            branch: e.git.branch,
            message: e.git.message,
            value:
              metric === 'overall'
                ? e.results.target.overall
                : e.results.target.endpoints[metric].mean,
            change: e.results.comparison.changes[metric],
            tag: e.tag,
          })),
        },
        null,
        2
      )
    )
  } else if (format === 'csv') {
    console.log('timestamp,commit,branch,value,change,tag')
    entries.forEach((e) => {
      const value =
        metric === 'overall' ? e.results.target.overall : e.results.target.endpoints[metric].mean
      const change = e.results.comparison.changes[metric]
      console.log(
        `${e.timestamp},${e.git.commit},${e.git.branch},${value.toFixed(2)},${change.toFixed(2)},${
          e.tag || ''
        }`
      )
    })
  } else {
    // Table format (default)
    console.log(`📊 Summary Statistics (${metric})`)
    console.log('─'.repeat(50))
    console.log(`  Total entries: ${stats.count}`)
    console.log(`  Mean: ${stats.mean.toFixed(2)} req/s`)
    console.log(`  Median: ${stats.median.toFixed(2)} req/s`)
    console.log(`  Min: ${stats.min.toFixed(2)} req/s`)
    console.log(`  Max: ${stats.max.toFixed(2)} req/s`)
    console.log(`  Trend: ${stats.trend}`)
    console.log('')

    console.log(`📋 Recent Performance History (${metric})`)
    console.log('─'.repeat(110))
    console.log(
      'Date                Commit   Branch           Value       Change   Tag                Message'
    )
    console.log('─'.repeat(110))

    entries.forEach((entry) => {
      const date = new Date(entry.timestamp).toISOString().substring(0, 19).replace('T', ' ')
      const value =
        metric === 'overall'
          ? entry.results.target.overall
          : entry.results.target.endpoints[metric].mean
      const change = entry.results.comparison.changes[metric]
      const changeStr = (change >= 0 ? '+' : '') + change.toFixed(1) + '%'
      const tag = entry.tag ? entry.tag.substring(0, 18).padEnd(18) : ''.padEnd(18)
      const message = entry.git.message.substring(0, 35)

      console.log(
        `${date}  ${entry.git.commit}  ${entry.git.branch.substring(0, 14).padEnd(14)}  ${value
          .toFixed(2)
          .padStart(10)}  ${changeStr.padStart(8)}  ${tag}  ${message}`
      )
    })
    console.log('─'.repeat(110))
  }
}

main()
