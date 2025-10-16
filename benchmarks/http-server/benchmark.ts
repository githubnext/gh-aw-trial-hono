/**
 * Hono HTTP Performance Benchmark
 *
 * Inspired by https://github.com/SaltyAom/bun-http-framework-benchmark
 *
 * Usage:
 *   bun run benchmark.ts [options]
 *
 * Options:
 *   --baseline=<ref>    Git reference for baseline (default: main)
 *   --target=<ref>      Git reference for target (default: current)
 *   --runs=<number>     Number of benchmark runs (default: 1)
 *   --duration=<number> Duration of each test in seconds (default: 10)
 *   --skip-tests        Skip endpoint validation tests
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// Configuration from command line arguments
const baseline =
  process.argv.find((arg) => arg.startsWith('--baseline='))?.split('=')[1] || 'origin/main'
const target = process.argv.find((arg) => arg.startsWith('--target='))?.split('=')[1] || 'current'
const runs = parseInt(process.argv.find((arg) => arg.startsWith('--runs='))?.split('=')[1] || '3')
const duration = parseInt(
  process.argv.find((arg) => arg.startsWith('--duration='))?.split('=')[1] || '10'
)
const concurrency = 500
const skipTests = process.argv.includes('--skip-tests')

const SCRIPT_DIR = import.meta.dirname
const TEMP_DIR = join(SCRIPT_DIR, '.benchmark-temp')
const HONO_ROOT = join(SCRIPT_DIR, '../..')

// Test app template (embedded to avoid file dependency issues)
const getAppTemplate = () => `import { Hono } from './src/index.ts'
import { RegExpRouter } from './src/router/reg-exp-router/index.ts'

const app = new Hono({ router: new RegExpRouter() })

app
  .get('/', (c) => c.text('Hi'))
  .post('/json', (c) => c.req.json().then(c.json))
  .get('/id/:id', (c) => {
    const id = c.req.param('id')
    const name = c.req.query('name')
    c.header('x-powered-by', 'benchmark')
    return c.text(\`\${id} \${name}\`)
  })

export default app`

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const runCommand = async (command: string, cwd: string) => {
  const parts = command.split(' ')
  const proc = spawn(parts[0], parts.slice(1), { cwd })

  let stdout = ''
  let stderr = ''

  proc.stdout.on('data', (data) => {
    stdout += data
  })
  proc.stderr.on('data', (data) => {
    stderr += data
  })

  const exitCode = await new Promise<number>((resolve) => {
    proc.on('close', resolve)
  })

  if (exitCode !== 0) {
    console.error(`Command failed: ${command}`)
    console.error(`Exit code: ${exitCode}`)
    console.error(`Stdout: ${stdout}`)
    console.error(`Stderr: ${stderr}`)
    throw new Error(`Command failed: ${command}`)
  }

  return { stdout, stderr }
}

const setupTemp = () => {
  if (existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true })
  }
  mkdirSync(TEMP_DIR, { recursive: true })
  writeFileSync(join(TEMP_DIR, 'body.json'), '{"hello":"world"}')
}

const buildVersion = async (version: string, name: string) => {
  console.log(`📦 Preparing ${name} (${version})...`)

  let needsRestore = false
  let stashRef = ''

  if (version === 'current') {
    // No build needed - use src directly
  } else {
    // Ensure we have the latest remote refs
    await runCommand('git fetch origin', HONO_ROOT)

    try {
      const stashResult = await runCommand('git stash push -m "benchmark-temp"', HONO_ROOT)
      needsRestore = stashResult.stdout.includes('Saved working directory')
      if (needsRestore) {
        stashRef = 'stash@{0}'
      }
    } catch {
      // No changes to stash
    }

    await runCommand(`git checkout ${version}`, HONO_ROOT)
    await runCommand('bun install --frozen-lockfile', HONO_ROOT)
    // No build needed - use src directly
  }

  const versionDir = join(TEMP_DIR, name)
  mkdirSync(versionDir, { recursive: true })
  await runCommand(`cp -r ${HONO_ROOT}/src ${versionDir}/src`, process.cwd())

  const appPath = join(versionDir, 'app.ts')
  writeFileSync(appPath, getAppTemplate())

  // Test endpoints (optional)
  if (!skipTests) {
    console.log(`🧪 Testing endpoints for ${name}...`)
    const server = spawn('bun', [appPath], {
      cwd: TEMP_DIR,
      env: { ...process.env, NODE_ENV: 'production' },
    })
    await sleep(2000)

    try {
      const res1 = await fetch('http://127.0.0.1:3000/')
      if ((await res1.text()) !== 'Hi') {
        throw new Error('[GET /] test failed')
      }

      const res2 = await fetch('http://127.0.0.1:3000/id/1?name=bun')
      if (res2.headers.get('x-powered-by') !== 'benchmark' || (await res2.text()) !== '1 bun') {
        throw new Error('[GET /id/:id] test failed')
      }

      const body = JSON.stringify({ hello: 'world' })
      const res3 = await fetch('http://127.0.0.1:3000/json', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'content-length': body.length.toString() },
      })
      if (
        !res3.headers.get('content-type')?.includes('application/json') ||
        (await res3.text()) !== body
      ) {
        throw new Error('[POST /json] test failed')
      }

      console.log(`  ✅ Tests passed for ${name}`)
    } finally {
      server.kill()
      await sleep(1000)
    }
  } else {
    console.log(`  ⏭️ Skipping endpoint tests for ${name}`)
  }

  // Restore git state
  if (version !== 'current' && needsRestore) {
    await runCommand('git checkout -', HONO_ROOT)
    await runCommand(`git stash pop ${stashRef}`, HONO_ROOT)
  } else if (version !== 'current') {
    await runCommand('git checkout -', HONO_ROOT)
  }

  return appPath
}

const runBenchmark = async (appPath: string, name: string) => {
  console.log(`⚡ Running HTTP benchmark for ${name}...`)

  const bodyFile = join(TEMP_DIR, 'body.json')
  const commands = [
    `bombardier --fasthttp -c ${concurrency} -d ${duration}s http://127.0.0.1:3000/`,
    `bombardier --fasthttp -c ${concurrency} -d ${duration}s http://127.0.0.1:3000/id/1?name=bun`,
    `bombardier --fasthttp -c ${concurrency} -d ${duration}s -m POST -H Content-Type:application/json -f ${bodyFile} http://127.0.0.1:3000/json`,
  ]

  const allRuns: number[][] = []

  for (let run = 0; run < runs; run++) {
    console.log(`  Run ${run + 1}/${runs}`)

    const server = spawn('bun', [appPath], {
      cwd: TEMP_DIR,
      env: { ...process.env, NODE_ENV: 'production' },
    })
    await sleep(1000)

    const runResults: number[] = []

    try {
      for (const command of commands) {
        const result = await runCommand(command, process.cwd())
        console.log(result.stdout)

        const match = result.stdout.match(/Reqs\/sec\s+(\d+[.|,]\d+)/)
        if (match) {
          runResults.push(parseFloat(match[1].replace(',', '')))
        } else {
          console.log('❌ Failed to parse result')
          runResults.push(0)
        }
      }
    } finally {
      server.kill()
      await sleep(500)
    }

    allRuns.push(runResults)
  }

  const average = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length

  const stdDev = (arr: number[]) => {
    const mean = average(arr)
    const squareDiffs = arr.map((value) => Math.pow(value - mean, 2))
    return Math.sqrt(average(squareDiffs))
  }

  const confidenceInterval = (arr: number[], confidence = 0.95) => {
    if (arr.length < 2) return 0
    const mean = average(arr)
    const sd = stdDev(arr)
    // Using t-distribution approximation (z-score for 95% CI ≈ 1.96)
    const zScore = confidence === 0.95 ? 1.96 : 2.576 // 95% or 99%
    return zScore * (sd / Math.sqrt(arr.length))
  }

  const pingValues = allRuns.map((run) => run[0])
  const queryValues = allRuns.map((run) => run[1])
  const bodyValues = allRuns.map((run) => run[2])

  const ping = average(pingValues)
  const query = average(queryValues)
  const body = average(bodyValues)
  const overall = (ping + query + body) / 3

  return {
    name,
    average: overall,
    ping,
    query,
    body,
    runs: allRuns.map((run) => average(run)),
    stats: {
      ping: { mean: ping, stdDev: stdDev(pingValues), ci95: confidenceInterval(pingValues) },
      query: { mean: query, stdDev: stdDev(queryValues), ci95: confidenceInterval(queryValues) },
      body: { mean: body, stdDev: stdDev(bodyValues), ci95: confidenceInterval(bodyValues) },
    },
  }
}

const main = async () => {
  console.log('🏁 Hono HTTP Benchmark')
  console.log('======================')
  console.log(`Baseline: ${baseline}`)
  console.log(`Target: ${target}`)
  console.log(`Runs: ${runs}`)
  console.log(`Duration: ${duration}s`)
  console.log(`Concurrency: ${concurrency}`)
  console.log(`Skip Tests: ${skipTests}`)
  console.log('')

  setupTemp()

  try {
    // Compare baseline vs target
    const baselinePath = await buildVersion(baseline, 'baseline')
    const targetPath = await buildVersion(target, 'target')

    const baselineResult = await runBenchmark(baselinePath, 'baseline')
    const targetResult = await runBenchmark(targetPath, 'target')

    // Calculate changes
    const calculateChange = (target: number, baseline: number) =>
      (((target - baseline) / baseline) * 100).toFixed(2)

    // Determine statistical significance
    const isSignificant = (
      targetValue: number,
      baselineValue: number,
      targetCI: number,
      baselineCI: number
    ) => {
      const diff = Math.abs(targetValue - baselineValue)
      const combinedCI = targetCI + baselineCI
      return diff > combinedCI
    }

    const changes = {
      average: calculateChange(targetResult.average, baselineResult.average),
      ping: calculateChange(targetResult.ping, baselineResult.ping),
      query: calculateChange(targetResult.query, baselineResult.query),
      body: calculateChange(targetResult.body, baselineResult.body),
    }

    const significance = {
      ping: isSignificant(
        targetResult.ping,
        baselineResult.ping,
        targetResult.stats.ping.ci95,
        baselineResult.stats.ping.ci95
      ),
      query: isSignificant(
        targetResult.query,
        baselineResult.query,
        targetResult.stats.query.ci95,
        baselineResult.stats.query.ci95
      ),
      body: isSignificant(
        targetResult.body,
        baselineResult.body,
        targetResult.stats.body.ci95,
        baselineResult.stats.body.ci95
      ),
    }

    // Format numbers
    const format = (num: number) => num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    const formatWithCI = (num: number, ci: number) => {
      const formatted = format(num)
      const ciFormatted = ci > 0 ? ` ± ${format(ci)}` : ''
      return `${formatted}${ciFormatted}`
    }
    const formatChange = (change: string, significant: boolean) => {
      const prefix = Number(change) >= 0 ? '+' : ''
      const suffix = significant ? '% *' : '%'
      return prefix + change + suffix
    }

    // Generate table data
    const rows = [
      {
        framework: `hono (${baseline})`,
        runtime: 'bun',
        average: format(baselineResult.average),
        ping: formatWithCI(baselineResult.ping, baselineResult.stats.ping.ci95),
        query: formatWithCI(baselineResult.query, baselineResult.stats.query.ci95),
        body: formatWithCI(baselineResult.body, baselineResult.stats.body.ci95),
      },
      {
        framework: `hono (${target})`,
        runtime: 'bun',
        average: format(targetResult.average),
        ping: formatWithCI(targetResult.ping, targetResult.stats.ping.ci95),
        query: formatWithCI(targetResult.query, targetResult.stats.query.ci95),
        body: formatWithCI(targetResult.body, targetResult.stats.body.ci95),
      },
      {
        framework: 'Change',
        runtime: '',
        average: formatChange(changes.average, false),
        ping: formatChange(changes.ping, significance.ping),
        query: formatChange(changes.query, significance.query),
        body: formatChange(changes.body, significance.body),
      },
    ]

    const table = [
      '| Framework | Runtime | Average | Ping | Query | Body |',
      '| --- | --- | --- | --- | --- | --- |',
      ...rows.map(
        (row) =>
          `| ${row.framework} | ${row.runtime} | ${row.average} | ${row.ping} | ${row.query} | ${row.body} |`
      ),
    ]

    // Console output
    console.log('')
    table.forEach((line) => console.log(line))
    console.log('')

    if (runs > 1) {
      console.log('Note: Values shown as mean ± 95% confidence interval')
      console.log('      * indicates statistically significant difference (p < 0.05)')
      console.log('')
    }

    // Markdown output with statistical notes
    const statisticalNotes =
      runs > 1
        ? [
            '',
            '**Statistical Analysis:**',
            `- Values shown as mean ± 95% confidence interval (${runs} runs)`,
            '- \\* indicates statistically significant difference (non-overlapping confidence intervals)',
            '- Confidence intervals help distinguish real performance changes from measurement noise',
            '',
          ]
        : ['']

    const markdownOutput = [
      '## HTTP Performance Benchmark',
      '',
      ...table,
      ...statisticalNotes,
    ].join('\n')

    // JSON output for programmatic analysis
    const jsonOutput = {
      config: {
        baseline,
        target,
        runs,
        duration,
        concurrency,
      },
      results: {
        baseline: {
          overall: baselineResult.average,
          endpoints: {
            ping: {
              mean: baselineResult.ping,
              stdDev: baselineResult.stats.ping.stdDev,
              ci95: baselineResult.stats.ping.ci95,
            },
            query: {
              mean: baselineResult.query,
              stdDev: baselineResult.stats.query.stdDev,
              ci95: baselineResult.stats.query.ci95,
            },
            body: {
              mean: baselineResult.body,
              stdDev: baselineResult.stats.body.stdDev,
              ci95: baselineResult.stats.body.ci95,
            },
          },
          rawRuns: baselineResult.runs,
        },
        target: {
          overall: targetResult.average,
          endpoints: {
            ping: {
              mean: targetResult.ping,
              stdDev: targetResult.stats.ping.stdDev,
              ci95: targetResult.stats.ping.ci95,
            },
            query: {
              mean: targetResult.query,
              stdDev: targetResult.stats.query.stdDev,
              ci95: targetResult.stats.query.ci95,
            },
            body: {
              mean: targetResult.body,
              stdDev: targetResult.stats.body.stdDev,
              ci95: targetResult.stats.body.ci95,
            },
          },
          rawRuns: targetResult.runs,
        },
        comparison: {
          changes: {
            overall: parseFloat(changes.average),
            ping: parseFloat(changes.ping),
            query: parseFloat(changes.query),
            body: parseFloat(changes.body),
          },
          significance,
        },
      },
      timestamp: new Date().toISOString(),
    }

    writeFileSync(join(SCRIPT_DIR, 'benchmark-results.md'), markdownOutput)
    writeFileSync(join(SCRIPT_DIR, 'benchmark-results.json'), JSON.stringify(jsonOutput, null, 2))
  } catch (error) {
    console.error('❌ Benchmark failed:', error)
    throw error
  } finally {
    if (existsSync(TEMP_DIR)) {
      rmSync(TEMP_DIR, { recursive: true })
    }
  }
}

main()
