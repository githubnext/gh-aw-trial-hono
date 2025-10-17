#!/usr/bin/env bun
/**
 * Analyze Performance Trends - Historical Performance Analysis
 *
 * Analyzes historical benchmark results to detect trends, regressions, and improvements.
 *
 * Usage:
 *   bun run benchmarks/performance-history/analyze-trends.ts [options]
 *
 * Options:
 *   --format=<format>     Output format: table (default), json, or markdown
 *   --last=<number>       Show only last N entries (default: 10)
 *   --branch=<name>       Filter by branch name
 *   --endpoint=<name>     Show specific endpoint (ping, query, body, or overall)
 *   --detect-regressions  Highlight performance regressions
 *   --threshold=<percent> Regression threshold percentage (default: -5)
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

interface HistoryEntry {
  timestamp: string
  git: {
    commitSha: string
    commitShaFull: string
    commitMessage: string
    branch: string
    prNumber?: number
  }
  config: {
    baseline: string
    target: string
    runs: number
    duration: number
    concurrency: number
  }
  results: {
    baseline: number
    target: number
    endpoints: {
      ping: number
      query: number
      body: number
    }
    stats: {
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
    significance: {
      ping: boolean
      query: boolean
      body: boolean
    }
  }
}

const main = () => {
  const SCRIPT_DIR = import.meta.dirname
  const HISTORY_FILE = join(SCRIPT_DIR, 'history.jsonl')

  // Parse command line arguments
  const format = process.argv.find((arg) => arg.startsWith('--format='))?.split('=')[1] || 'table'
  const last = parseInt(
    process.argv.find((arg) => arg.startsWith('--last='))?.split('=')[1] || '10'
  )
  const branchFilter = process.argv.find((arg) => arg.startsWith('--branch='))?.split('=')[1]
  const endpoint = process.argv.find((arg) => arg.startsWith('--endpoint='))?.split('=')[1]
  const detectRegressions = process.argv.includes('--detect-regressions')
  const threshold = parseFloat(
    process.argv.find((arg) => arg.startsWith('--threshold='))?.split('=')[1] || '-5'
  )

  // Check if history file exists
  if (!existsSync(HISTORY_FILE)) {
    console.error(`❌ No performance history found: ${HISTORY_FILE}`)
    console.error('Store benchmark results first:')
    console.error('  1. cd benchmarks/http-server')
    console.error('  2. bun run benchmark.ts')
    console.error('  3. cd ../performance-history')
    console.error('  4. bun run store-results.ts')
    process.exit(1)
  }

  // Load and parse JSONL history
  const content = readFileSync(HISTORY_FILE, 'utf-8')
  let entries: HistoryEntry[] = content
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))

  // Apply filters
  if (branchFilter) {
    entries = entries.filter((e) => e.git.branch === branchFilter)
  }

  // Take last N entries
  entries = entries.slice(-last)

  if (entries.length === 0) {
    console.error('❌ No entries match the specified filters')
    process.exit(1)
  }

  // Calculate trends
  const calculateTrend = (values: number[]) => {
    if (values.length < 2) return null
    const first = values[0]
    const last = values[values.length - 1]
    const change = ((last - first) / first) * 100
    return change
  }

  const overallValues = entries.map((e) => e.results.target)
  const pingValues = entries.map((e) => e.results.endpoints.ping)
  const queryValues = entries.map((e) => e.results.endpoints.query)
  const bodyValues = entries.map((e) => e.results.endpoints.body)

  const trends = {
    overall: calculateTrend(overallValues),
    ping: calculateTrend(pingValues),
    query: calculateTrend(queryValues),
    body: calculateTrend(bodyValues),
  }

  // Detect regressions
  const regressions: Array<{
    entry: HistoryEntry
    endpoint: string
    change: number
    significant: boolean
  }> = []

  if (detectRegressions) {
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]
      const curr = entries[i]

      const checkRegression = (
        endpoint: 'ping' | 'query' | 'body',
        prevValue: number,
        currValue: number,
        significant: boolean
      ) => {
        const change = ((currValue - prevValue) / prevValue) * 100
        if (change <= threshold) {
          regressions.push({
            entry: curr,
            endpoint,
            change,
            significant,
          })
        }
      }

      checkRegression(
        'ping',
        prev.results.endpoints.ping,
        curr.results.endpoints.ping,
        curr.comparison.significance?.ping || false
      )
      checkRegression(
        'query',
        prev.results.endpoints.query,
        curr.results.endpoints.query,
        curr.comparison.significance?.query || false
      )
      checkRegression(
        'body',
        prev.results.endpoints.body,
        curr.results.endpoints.body,
        curr.comparison.significance?.body || false
      )
    }
  }

  // Output based on format
  switch (format) {
    case 'json':
      console.log(
        JSON.stringify(
          {
            entries,
            trends,
            regressions,
            summary: {
              totalEntries: entries.length,
              dateRange: {
                from: entries[0].timestamp,
                to: entries[entries.length - 1].timestamp,
              },
              branches: [...new Set(entries.map((e) => e.git.branch))],
            },
          },
          null,
          2
        )
      )
      break

    case 'markdown':
      console.log('# Performance History')
      console.log('')
      console.log(
        `**Date Range:** ${new Date(entries[0].timestamp).toLocaleDateString()} - ${new Date(
          entries[entries.length - 1].timestamp
        ).toLocaleDateString()}`
      )
      console.log(`**Entries:** ${entries.length}`)
      console.log('')
      console.log('## Trends')
      console.log('')
      console.log('| Metric | Trend |')
      console.log('| ------ | ----- |')
      Object.entries(trends).forEach(([key, value]) => {
        if (value !== null) {
          const emoji = value > 0 ? '📈' : value < 0 ? '📉' : '➡️'
          const sign = value > 0 ? '+' : ''
          console.log(`| ${key} | ${emoji} ${sign}${value.toFixed(2)}% |`)
        }
      })
      console.log('')
      console.log('## Recent History')
      console.log('')
      console.log('| Date | Commit | Branch | Overall | Ping | Query | Body |')
      console.log('| ---- | ------ | ------ | ------- | ---- | ----- | ---- |')
      entries.forEach((e) => {
        const date = new Date(e.timestamp).toLocaleDateString()
        const overall = e.results.target.toFixed(0)
        const ping = e.results.endpoints.ping.toFixed(0)
        const query = e.results.endpoints.query.toFixed(0)
        const body = e.results.endpoints.body.toFixed(0)
        console.log(
          `| ${date} | \`${e.git.commitSha}\` | ${e.git.branch} | ${overall} | ${ping} | ${query} | ${body} |`
        )
      })

      if (regressions.length > 0) {
        console.log('')
        console.log('## ⚠️ Regressions Detected')
        console.log('')
        regressions.forEach((r) => {
          const sig = r.significant ? '(significant)' : '(not significant)'
          console.log(
            `- \`${r.entry.git.commitSha}\`: ${r.endpoint} ${r.change.toFixed(2)}% ${sig}`
          )
          console.log(`  ${r.entry.git.commitMessage}`)
        })
      }
      break

    case 'table':
    default:
      console.log('📊 Performance History Analysis')
      console.log('================================')
      console.log('')
      console.log(
        `Date Range: ${new Date(entries[0].timestamp).toLocaleDateString()} - ${new Date(
          entries[entries.length - 1].timestamp
        ).toLocaleDateString()}`
      )
      console.log(`Entries: ${entries.length}`)
      console.log(`Branches: ${[...new Set(entries.map((e) => e.git.branch))].join(', ')}`)
      console.log('')

      // Show trends
      console.log('Trends (first → last):')
      Object.entries(trends).forEach(([key, value]) => {
        if (value !== null) {
          const emoji = value > 0 ? '📈' : value < 0 ? '📉' : '➡️'
          const sign = value > 0 ? '+' : ''
          console.log(`  ${key.padEnd(10)}: ${emoji} ${sign}${value.toFixed(2)}%`)
        }
      })
      console.log('')

      // Show recent history table
      console.log('Recent History:')
      console.log('')
      const headers = ['Date', 'Commit', 'Branch', 'Overall', 'Ping', 'Query', 'Body', 'Message']
      const colWidths = [12, 9, 15, 12, 12, 12, 12, 40]

      const formatRow = (values: string[]) => values.map((v, i) => v.padEnd(colWidths[i])).join(' ')

      console.log(formatRow(headers))
      console.log(formatRow(headers.map((_, i) => '-'.repeat(colWidths[i]))))

      entries.forEach((e) => {
        const date = new Date(e.timestamp).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })
        const overall = e.results.target.toFixed(0)
        const ping = e.results.endpoints.ping.toFixed(0)
        const query = e.results.endpoints.query.toFixed(0)
        const body = e.results.endpoints.body.toFixed(0)
        const message = e.git.commitMessage.substring(0, 38)

        console.log(
          formatRow([date, e.git.commitSha, e.git.branch, overall, ping, query, body, message])
        )
      })
      console.log('')

      // Show regressions
      if (detectRegressions && regressions.length > 0) {
        console.log(`⚠️  ${regressions.length} Performance Regression(s) Detected:`)
        console.log('')
        regressions.forEach((r) => {
          const sig = r.significant ? '(significant)' : ''
          const icon = r.significant ? '🔴' : '⚠️'
          console.log(
            `${icon} ${r.entry.git.commitSha} - ${r.endpoint}: ${r.change.toFixed(2)}% ${sig}`
          )
          console.log(`   ${r.entry.git.commitMessage}`)
          console.log(`   ${r.entry.git.branch}`)
          console.log('')
        })
      } else if (detectRegressions) {
        console.log('✅ No significant regressions detected')
        console.log('')
      }

      // Statistical summary
      const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
      const stdDev = (arr: number[]) => {
        const mean = avg(arr)
        return Math.sqrt(
          arr.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / arr.length
        )
      }

      console.log('Statistical Summary:')
      console.log(
        `  Overall avg:  ${avg(overallValues).toFixed(2)} req/s (σ=${stdDev(overallValues).toFixed(
          2
        )})`
      )
      console.log(
        `  Ping avg:     ${avg(pingValues).toFixed(2)} req/s (σ=${stdDev(pingValues).toFixed(2)})`
      )
      console.log(
        `  Query avg:    ${avg(queryValues).toFixed(2)} req/s (σ=${stdDev(queryValues).toFixed(2)})`
      )
      console.log(
        `  Body avg:     ${avg(bodyValues).toFixed(2)} req/s (σ=${stdDev(bodyValues).toFixed(2)})`
      )
      break
  }
}

main()
