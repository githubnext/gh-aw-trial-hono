#!/usr/bin/env bun
/**
 * Generate Performance Chart - ASCII Chart Visualization
 *
 * Creates ASCII chart visualization of performance trends over time.
 *
 * Usage:
 *   bun run benchmarks/performance-history/generate-chart.ts [options]
 *
 * Options:
 *   --endpoint=<name>   Endpoint to chart (ping, query, body, overall) default: overall
 *   --last=<number>     Number of entries to chart (default: 20)
 *   --height=<number>   Chart height in lines (default: 15)
 *   --branch=<name>     Filter by branch name
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

interface HistoryEntry {
  timestamp: string
  git: {
    commitSha: string
    commitMessage: string
    branch: string
  }
  results: {
    target: number
    endpoints: {
      ping: number
      query: number
      body: number
    }
  }
}

const generateASCIIChart = (
  data: Array<{ label: string; value: number }>,
  height: number,
  title: string
) => {
  if (data.length === 0) return

  const values = data.map((d) => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  const padding = range * 0.1 // 10% padding

  // Normalize values to chart height
  const normalize = (val: number) => {
    if (range === 0) return height / 2
    return Math.round(((val - min + padding) / (range + 2 * padding)) * (height - 1))
  }

  // Create chart grid
  const grid: string[][] = Array(height)
    .fill(null)
    .map(() => Array(data.length * 2).fill(' '))

  // Plot data points
  data.forEach((point, i) => {
    const x = i * 2
    const y = height - 1 - normalize(point.value)
    grid[y][x] = '●'

    // Draw line to next point
    if (i < data.length - 1) {
      const nextY = height - 1 - normalize(data[i + 1].value)
      const startY = Math.min(y, nextY)
      const endY = Math.max(y, nextY)

      for (let lineY = startY; lineY <= endY; lineY++) {
        if (lineY !== y && lineY !== nextY) {
          grid[lineY][x + 1] = '│'
        } else {
          grid[lineY][x + 1] = lineY === y ? '─' : '│'
        }
      }
    }
  })

  // Print chart with Y-axis labels
  console.log(`\n${title}`)
  console.log('='.repeat(title.length))
  console.log('')

  const yLabels = [max.toFixed(0), ((max + min) / 2).toFixed(0), min.toFixed(0)]

  grid.forEach((row, i) => {
    let yLabel = ' '.repeat(8)
    if (i === 0) yLabel = yLabels[0].padStart(8)
    else if (i === Math.floor(height / 2)) yLabel = yLabels[1].padStart(8)
    else if (i === height - 1) yLabel = yLabels[2].padStart(8)

    console.log(`${yLabel} ┤ ${row.join('')}`)
  })

  // X-axis
  const xAxis = ' '.repeat(10) + '└' + '─'.repeat(data.length * 2)
  console.log(xAxis)

  // X-axis labels (show first, middle, last)
  const xLabels = [
    data[0].label,
    data[Math.floor(data.length / 2)].label,
    data[data.length - 1].label,
  ]

  const labelWidth = Math.floor((data.length * 2) / 3)
  console.log(
    ' '.repeat(11) + xLabels[0].padEnd(labelWidth) + xLabels[1].padEnd(labelWidth) + xLabels[2]
  )
  console.log('')

  // Stats
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  const trend = ((values[values.length - 1] - values[0]) / values[0]) * 100
  const trendEmoji = trend > 0 ? '📈' : trend < 0 ? '📉' : '➡️'
  const trendSign = trend > 0 ? '+' : ''

  console.log(`Average: ${avg.toFixed(2)} req/s`)
  console.log(`Trend: ${trendEmoji} ${trendSign}${trend.toFixed(2)}%`)
  console.log(`Range: ${min.toFixed(0)} - ${max.toFixed(0)} req/s`)
  console.log('')
}

const main = () => {
  const SCRIPT_DIR = import.meta.dirname
  const HISTORY_FILE = join(SCRIPT_DIR, 'history.jsonl')

  // Parse arguments
  const endpoint =
    process.argv.find((arg) => arg.startsWith('--endpoint='))?.split('=')[1] || 'overall'
  const last = parseInt(
    process.argv.find((arg) => arg.startsWith('--last='))?.split('=')[1] || '20'
  )
  const height = parseInt(
    process.argv.find((arg) => arg.startsWith('--height='))?.split('=')[1] || '15'
  )
  const branchFilter = process.argv.find((arg) => arg.startsWith('--branch='))?.split('=')[1]

  // Check if history exists
  if (!existsSync(HISTORY_FILE)) {
    console.error(`❌ No performance history found: ${HISTORY_FILE}`)
    console.error('Store benchmark results first')
    process.exit(1)
  }

  // Load history
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
    console.error('❌ No entries found')
    process.exit(1)
  }

  // Prepare data
  const getValue = (e: HistoryEntry) => {
    switch (endpoint) {
      case 'ping':
        return e.results.endpoints.ping
      case 'query':
        return e.results.endpoints.query
      case 'body':
        return e.results.endpoints.body
      default:
        return e.results.target
    }
  }

  const data = entries.map((e) => ({
    label: e.git.commitSha,
    value: getValue(e),
  }))

  // Generate chart
  const title = `${endpoint.charAt(0).toUpperCase() + endpoint.slice(1)} Performance Trend (req/s)`
  generateASCIIChart(data, height, title)

  // Show recent commits
  console.log('Recent Commits:')
  entries.slice(-5).forEach((e) => {
    const value = getValue(e).toFixed(0)
    console.log(`  ${e.git.commitSha} - ${value} req/s - ${e.git.commitMessage.substring(0, 50)}`)
  })
  console.log('')
}

main()
