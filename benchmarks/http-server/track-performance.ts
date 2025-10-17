/**
 * Historical Performance Tracking Tool
 *
 * Saves benchmark results to a historical database for trend analysis and regression detection.
 *
 * Usage:
 *   bun run track-performance.ts [options]
 *
 * Options:
 *   --input=<file>     Input JSON file (default: benchmark-results.json)
 *   --db=<file>        Database file (default: .performance-history/history.jsonl)
 *   --branch=<name>    Branch name (default: auto-detect from git)
 *   --commit=<sha>     Commit SHA (default: auto-detect from git)
 *   --tag=<tag>        Optional tag for this entry (e.g., "release-1.0", "pre-optimization")
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPT_DIR = import.meta.dirname
const DEFAULT_INPUT = join(SCRIPT_DIR, 'benchmark-results.json')
const DEFAULT_DB_DIR = join(SCRIPT_DIR, '.performance-history')
const DEFAULT_DB = join(DEFAULT_DB_DIR, 'history.jsonl')

// Parse command line arguments
const args = process.argv.slice(2)
const getArg = (name: string, defaultValue?: string) => {
  const arg = args.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.split('=')[1] : defaultValue
}

const inputFile = getArg('input', DEFAULT_INPUT)
const dbFile = getArg('db', DEFAULT_DB)
const branchOverride = getArg('branch')
const commitOverride = getArg('commit')
const tag = getArg('tag')

// Git helper functions
const runGitCommand = (command: string): string => {
  const parts = command.split(' ')

  const exitCode = require('child_process').spawnSync(parts[0], parts.slice(1), {
    cwd: join(SCRIPT_DIR, '../..'),
    encoding: 'utf-8',
  })

  if (exitCode.status !== 0) {
    throw new Error(`Git command failed: ${command}`)
  }

  return exitCode.stdout.trim()
}

const getCurrentBranch = (): string => {
  try {
    return runGitCommand('git branch --show-current')
  } catch {
    return 'unknown'
  }
}

const getCurrentCommit = (): string => {
  try {
    return runGitCommand('git rev-parse HEAD')
  } catch {
    return 'unknown'
  }
}

const getCommitMessage = (): string => {
  try {
    return runGitCommand('git log -1 --pretty=%B')
  } catch {
    return ''
  }
}

const main = () => {
  console.log('📊 Historical Performance Tracking')
  console.log('==================================')

  // Ensure database directory exists
  if (!existsSync(DEFAULT_DB_DIR)) {
    mkdirSync(DEFAULT_DB_DIR, { recursive: true })
    console.log(`✅ Created history directory: ${DEFAULT_DB_DIR}`)
  }

  // Ensure .gitignore exists for history directory
  const gitignorePath = join(DEFAULT_DB_DIR, '.gitignore')
  if (!existsSync(gitignorePath)) {
    appendFileSync(gitignorePath, '# Ignore all performance history data\n*\n!.gitignore\n')
    console.log(`✅ Created .gitignore for history directory`)
  }

  // Read benchmark results
  if (!existsSync(inputFile)) {
    console.error(`❌ Input file not found: ${inputFile}`)
    console.error('   Run benchmark.ts first to generate results')
    throw new Error('Input file not found')
  }

  const benchmarkData = JSON.parse(readFileSync(inputFile, 'utf-8'))

  // Get git metadata
  const branch = branchOverride || getCurrentBranch()
  const commit = commitOverride || getCurrentCommit()
  const commitMessage = getCommitMessage()

  // Create historical entry
  const entry = {
    timestamp: benchmarkData.timestamp || new Date().toISOString(),
    git: {
      branch,
      commit: commit.substring(0, 7), // Short SHA
      commitFull: commit,
      message: commitMessage.split('\n')[0], // First line only
    },
    config: benchmarkData.config,
    results: {
      baseline: {
        overall: benchmarkData.results.baseline.overall,
        endpoints: benchmarkData.results.baseline.endpoints,
      },
      target: {
        overall: benchmarkData.results.target.overall,
        endpoints: benchmarkData.results.target.endpoints,
      },
      comparison: benchmarkData.results.comparison,
    },
    tag: tag || undefined,
  }

  // Append to database (JSONL format - one JSON object per line)
  appendFileSync(dbFile, JSON.stringify(entry) + '\n')

  console.log(`\n✅ Performance data saved to history`)
  console.log(`   Database: ${dbFile}`)
  console.log(`   Branch: ${branch}`)
  console.log(`   Commit: ${commit.substring(0, 7)}`)
  if (tag) {
    console.log(`   Tag: ${tag}`)
  }
  console.log(`   Overall performance: ${entry.results.target.overall.toFixed(2)} req/s`)
  console.log(`\n💡 Use 'bun run analyze-performance.ts' to view trends`)
}

main()
