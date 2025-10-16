#!/usr/bin/env bun
/**
 * Memory Profiling Benchmark for Hono
 *
 * Analyzes heap allocation patterns and memory efficiency across different
 * request handling scenarios to identify optimization opportunities.
 *
 * Usage:
 *   bun run memory-profile.ts [--iterations=N]
 *
 * Requirements:
 *   - Run with `bun --expose-gc` to enable forced garbage collection
 *
 * Output:
 *   - Console: Formatted table with allocation metrics
 *   - memory-profile-results.json: Structured data for analysis
 */

import { Hono } from '../../src/hono'
import { writeFile } from 'fs/promises'

interface MemorySnapshot {
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
  rss?: number
}

interface ProfileResult {
  name: string
  iterations: number
  requestsPerIteration: number
  totalRequests: number
  durationMs: number
  throughput: number
  heapGrowthBytes: number
  perRequestBytes: number
  heapBefore: MemorySnapshot
  heapAfter: MemorySnapshot
}

function captureMemory(): MemorySnapshot {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const mem = process.memoryUsage()
    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers || 0,
      rss: mem.rss,
    }
  }
  // Fallback for environments without process.memoryUsage
  return {
    heapUsed: 0,
    heapTotal: 0,
    external: 0,
    arrayBuffers: 0,
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

async function forceGC(): Promise<void> {
  if (global.gc) {
    global.gc()
    // Allow GC to complete
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function profileScenario(
  name: string,
  setup: () => Hono,
  requests: string[],
  iterations: number
): Promise<ProfileResult> {
  // Force GC and stabilize before measurement
  await forceGC()

  const before = captureMemory()
  const app = setup()

  const totalRequests = iterations * requests.length
  const start = performance.now()

  for (let i = 0; i < iterations; i++) {
    for (const url of requests) {
      await app.request(url)
    }
  }

  const end = performance.now()
  const after = captureMemory()

  const durationMs = end - start
  const heapGrowth = after.heapUsed - before.heapUsed
  const perRequest = heapGrowth / totalRequests
  const throughput = totalRequests / (durationMs / 1000)

  return {
    name,
    iterations,
    requestsPerIteration: requests.length,
    totalRequests,
    durationMs,
    throughput,
    heapGrowthBytes: heapGrowth,
    perRequestBytes: perRequest,
    heapBefore: before,
    heapAfter: after,
  }
}

async function main() {
  console.log('🔬 Hono Memory Profiling Benchmark')
  console.log('=' + '='.repeat(70))
  console.log('')

  // Parse CLI arguments
  const args = process.argv.slice(2)
  const iterationsArg = args.find((arg) => arg.startsWith('--iterations='))
  const iterations = iterationsArg ? parseInt(iterationsArg.split('=')[1], 10) : 10000

  if (!global.gc) {
    console.log('⚠️  Warning: GC not exposed. Run with `bun --expose-gc` for accurate results.')
    console.log('')
  }

  console.log(`Configuration: ${iterations.toLocaleString()} iterations per scenario`)
  console.log('')

  const results: ProfileResult[] = []

  // Scenario 1: Simple text response
  console.log('Running: Simple text response...')
  results.push(
    await profileScenario(
      'Simple text response',
      () => {
        const app = new Hono()
        app.get('/text', (c) => c.text('Hello, World!'))
        return app
      },
      ['/text'],
      iterations
    )
  )

  // Scenario 2: JSON response
  console.log('Running: JSON response...')
  results.push(
    await profileScenario(
      'JSON response',
      () => {
        const app = new Hono()
        app.get('/json', (c) => c.json({ message: 'Hello', status: 'ok', timestamp: Date.now() }))
        return app
      },
      ['/json'],
      iterations
    )
  )

  // Scenario 3: Middleware chain
  console.log('Running: Middleware chain (3 middleware)...')
  results.push(
    await profileScenario(
      'Middleware chain (3 middleware)',
      () => {
        const app = new Hono()
        app.use('*', async (c, next) => await next())
        app.use('*', async (c, next) => await next())
        app.use('*', async (c, next) => await next())
        app.get('/middleware', (c) => c.text('ok'))
        return app
      },
      ['/middleware'],
      iterations
    )
  )

  // Scenario 4: Context variables
  console.log('Running: Context variables...')
  results.push(
    await profileScenario(
      'Context variables',
      () => {
        const app = new Hono<{ Variables: { user: string; id: number } }>()
        app.use('*', async (c, next) => {
          c.set('user', 'testuser')
          c.set('id', 12345)
          await next()
        })
        app.get('/vars', (c) => {
          const user = c.get('user')
          const id = c.get('id')
          return c.json({ user, id })
        })
        return app
      },
      ['/vars'],
      iterations
    )
  )

  // Scenario 5: Route parameters
  console.log('Running: Route parameters...')
  results.push(
    await profileScenario(
      'Route parameters',
      () => {
        const app = new Hono()
        app.get('/users/:id/posts/:postId', (c) => {
          const id = c.req.param('id')
          const postId = c.req.param('postId')
          return c.json({ userId: id, postId })
        })
        return app
      },
      ['/users/123/posts/456'],
      iterations
    )
  )

  // Scenario 6: Query parameters
  console.log('Running: Query parameters...')
  results.push(
    await profileScenario(
      'Query parameters',
      () => {
        const app = new Hono()
        app.get('/search', (c) => {
          const query = c.req.query('q')
          const page = c.req.query('page')
          return c.json({ query, page })
        })
        return app
      },
      ['/search?q=test&page=1'],
      iterations
    )
  )

  // Scenario 7: Mixed workload
  console.log('Running: Mixed workload...')
  results.push(
    await profileScenario(
      'Mixed workload',
      () => {
        const app = new Hono()
        app.use('*', async (c, next) => await next())
        app.get('/api/health', (c) => c.text('ok'))
        app.get('/api/data', (c) => c.json({ data: [1, 2, 3, 4, 5] }))
        app.get('/api/users/:id', (c) => c.json({ id: c.req.param('id'), name: 'User' }))
        return app
      },
      ['/api/health', '/api/data', '/api/users/123'],
      iterations
    )
  )

  console.log('')
  console.log('=' + '='.repeat(70))
  console.log('📊 Results')
  console.log('=' + '='.repeat(70))
  console.log('')

  // Print results table
  console.log(
    '| Scenario                      | Throughput    | Heap/Request | Total Heap Growth |'
  )
  console.log(
    '|-------------------------------|---------------|--------------|-------------------|'
  )

  for (const result of results) {
    const name = result.name.padEnd(29)
    const throughput = `${Math.round(result.throughput).toLocaleString()} req/s`.padEnd(13)
    const perRequest = formatBytes(result.perRequestBytes).padEnd(12)
    const totalGrowth = formatBytes(result.heapGrowthBytes).padEnd(17)
    console.log(`| ${name} | ${throughput} | ${perRequest} | ${totalGrowth} |`)
  }

  console.log('')
  console.log('💡 Insights:')
  console.log('')

  // Find most and least efficient scenarios
  const sortedByAllocation = [...results].sort((a, b) => a.perRequestBytes - b.perRequestBytes)
  const mostEfficient = sortedByAllocation[0]
  const leastEfficient = sortedByAllocation[sortedByAllocation.length - 1]

  console.log(
    `  ✅ Most efficient: ${mostEfficient.name} (${formatBytes(
      mostEfficient.perRequestBytes
    )}/request)`
  )
  console.log(
    `  ⚠️  Least efficient: ${leastEfficient.name} (${formatBytes(
      leastEfficient.perRequestBytes
    )}/request)`
  )

  // Calculate average
  const avgAllocation = results.reduce((sum, r) => sum + r.perRequestBytes, 0) / results.length
  console.log(`  📊 Average allocation: ${formatBytes(avgAllocation)}/request`)

  // Identify scenarios with high allocation
  const highAllocationThreshold = avgAllocation * 1.5
  const highAllocationScenarios = results.filter((r) => r.perRequestBytes > highAllocationThreshold)

  if (highAllocationScenarios.length > 0) {
    console.log('')
    console.log('  🎯 Potential optimization targets (>50% above average):')
    for (const scenario of highAllocationScenarios) {
      const percentAbove = ((scenario.perRequestBytes - avgAllocation) / avgAllocation) * 100
      console.log(
        `     - ${scenario.name}: ${formatBytes(
          scenario.perRequestBytes
        )}/request (+${percentAbove.toFixed(1)}%)`
      )
    }
  }

  console.log('')
  console.log('=' + '='.repeat(70))
  console.log('✅ Memory profiling complete')
  console.log('')

  // Export results to JSON
  const jsonOutput = {
    timestamp: new Date().toISOString(),
    runtime: 'bun',
    runtimeVersion: Bun.version,
    configuration: {
      iterations,
      gcExposed: !!global.gc,
    },
    results: results.map((r) => ({
      ...r,
      heapBefore: undefined, // Reduce JSON size
      heapAfter: undefined,
    })),
    summary: {
      mostEfficient: mostEfficient.name,
      leastEfficient: leastEfficient.name,
      averageAllocationBytes: avgAllocation,
    },
  }

  await writeFile('memory-profile-results.json', JSON.stringify(jsonOutput, null, 2))

  console.log('📄 Results exported to: memory-profile-results.json')
  console.log('')
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
