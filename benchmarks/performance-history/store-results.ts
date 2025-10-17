#!/usr/bin/env bun
/**
 * Store Benchmark Results - Historical Performance Tracking
 *
 * Stores HTTP benchmark results with metadata for historical trend analysis.
 *
 * Usage:
 *   bun run benchmarks/performance-history/store-results.ts [--results-file=path]
 *
 * Options:
 *   --results-file    Path to benchmark-results.json (default: ../http-server/benchmark-results.json)
 *   --commit-sha      Git commit SHA to associate (default: current HEAD)
 *   --commit-message  Git commit message (default: from git log)
 *   --branch          Git branch name (default: current branch)
 *   --pr-number       Pull request number (optional)
 *
 * Output:
 *   - Appends to benchmarks/performance-history/history.jsonl
 *   - JSONL format: one JSON object per line for efficient append and streaming
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const runCommand = async (command: string): Promise<string> => {
  const parts = command.split(' ')
  const proc = spawn(parts[0], parts.slice(1), { shell: true })

  let stdout = ''
  let stderr = ''

  proc.stdout?.on('data', (data) => {
    stdout += data.toString()
  })
  proc.stderr?.on('data', (data) => {
    stderr += data.toString()
  })

  const exitCode = await new Promise<number>((resolve) => {
    proc.on('close', resolve)
  })

  if (exitCode !== 0) {
    throw new Error(`Command failed: ${command}\n${stderr}`)
  }

  return stdout.trim()
}

const main = async () => {
  const SCRIPT_DIR = import.meta.dirname
  const HISTORY_DIR = SCRIPT_DIR
  const HISTORY_FILE = join(HISTORY_DIR, 'history.jsonl')

  // Ensure history directory exists
  if (!existsSync(HISTORY_DIR)) {
    mkdirSync(HISTORY_DIR, { recursive: true })
  }

  // Parse command line arguments
  const resultsFile =
    process.argv.find((arg) => arg.startsWith('--results-file='))?.split('=')[1] ||
    join(SCRIPT_DIR, '../http-server/benchmark-results.json')

  const commitSha =
    process.argv.find((arg) => arg.startsWith('--commit-sha='))?.split('=')[1] ||
    (await runCommand('git rev-parse HEAD'))

  const commitMessage =
    process.argv.find((arg) => arg.startsWith('--commit-message='))?.split('=')[1] ||
    (await runCommand('git log -1 --pretty=%B'))

  const branch =
    process.argv.find((arg) => arg.startsWith('--branch='))?.split('=')[1] ||
    (await runCommand('git branch --show-current'))

  const prNumber = process.argv.find((arg) => arg.startsWith('--pr-number='))?.split('=')[1]

  // Validate results file exists
  if (!existsSync(resultsFile)) {
    console.error(`❌ Results file not found: ${resultsFile}`)
    console.error('Run HTTP benchmark first: cd benchmarks/http-server && bun run benchmark.ts')
    process.exit(1)
  }

  // Load benchmark results
  const results = JSON.parse(readFileSync(resultsFile, 'utf-8'))

  // Create historical entry
  const entry = {
    timestamp: results.timestamp || new Date().toISOString(),
    git: {
      commitSha: commitSha.substring(0, 7),
      commitShaFull: commitSha,
      commitMessage: commitMessage.split('\n')[0], // First line only
      branch,
      ...(prNumber && { prNumber: parseInt(prNumber) }),
    },
    config: results.config,
    results: {
      baseline: results.results.baseline.overall,
      target: results.results.target.overall,
      endpoints: {
        ping: results.results.target.endpoints.ping.mean,
        query: results.results.target.endpoints.query.mean,
        body: results.results.target.endpoints.body.mean,
      },
      stats: {
        ping: results.results.target.endpoints.ping,
        query: results.results.target.endpoints.query,
        body: results.results.target.endpoints.body,
      },
    },
    comparison: results.results.comparison,
  }

  // Append to history file (JSONL format)
  const jsonLine = JSON.stringify(entry) + '\n'
  appendFileSync(HISTORY_FILE, jsonLine)

  console.log('✅ Performance results stored')
  console.log(`   Commit: ${entry.git.commitSha}`)
  console.log(`   Branch: ${entry.git.branch}`)
  console.log(`   Overall: ${entry.results.target.toFixed(2)} req/s`)
  console.log(`   File: ${HISTORY_FILE}`)
  console.log('')
  console.log('Run trend analysis: bun run benchmarks/performance-history/analyze-trends.ts')
}

main().catch((error) => {
  console.error('❌ Failed to store results:', error.message)
  process.exit(1)
})
