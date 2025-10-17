#!/usr/bin/env bun
/**
 * Middleware Memory Allocation Analysis
 *
 * Deep-dive investigation into middleware chain memory allocation patterns
 * to identify the root cause of elevated per-request allocations.
 *
 * Usage:
 *   bun --expose-gc middleware-memory-analysis.ts
 */

import { Hono } from '../../src/hono'

interface MemorySnapshot {
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
}

interface ProfileResult {
  name: string
  iterations: number
  heapGrowthBytes: number
  perRequestBytes: number
  throughput: number
  durationMs: number
}

function captureMemory(): MemorySnapshot {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const mem = process.memoryUsage()
    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers || 0,
    }
  }
  return { heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (Math.abs(bytes) < 1) return `${bytes.toFixed(4)} B`
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

async function forceGC(): Promise<void> {
  if (global.gc) {
    global.gc()
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function profileScenario(
  name: string,
  setup: () => Hono,
  url: string,
  iterations: number
): Promise<ProfileResult> {
  await forceGC()

  const before = captureMemory()
  const app = setup()

  const start = performance.now()

  for (let i = 0; i < iterations; i++) {
    await app.request(url)
  }

  const end = performance.now()
  const after = captureMemory()

  const durationMs = end - start
  const heapGrowth = after.heapUsed - before.heapUsed
  const perRequest = heapGrowth / iterations
  const throughput = iterations / (durationMs / 1000)

  return {
    name,
    iterations,
    heapGrowthBytes: heapGrowth,
    perRequestBytes: perRequest,
    throughput,
    durationMs,
  }
}

async function main() {
  console.log('🔬 Middleware Memory Allocation - Deep Analysis')
  console.log('=' + '='.repeat(79))
  console.log('')

  if (!global.gc) {
    console.log('⚠️  Warning: GC not exposed. Run with `bun --expose-gc` for accurate results.')
    console.log('')
  }

  const iterations = 10000
  console.log(`Configuration: ${iterations.toLocaleString()} iterations per scenario`)
  console.log('')

  const results: ProfileResult[] = []

  // Baseline: No middleware
  console.log('1/15: No middleware (baseline)...')
  results.push(
    await profileScenario(
      'No middleware (baseline)',
      () => {
        const app = new Hono()
        app.get('/test', (c) => c.text('ok'))
        return app
      },
      '/test',
      iterations
    )
  )

  // Single middleware variations
  console.log('2/15: 1 passthrough middleware...')
  results.push(
    await profileScenario(
      '1 passthrough middleware',
      () => {
        const app = new Hono()
        app.use('*', async (c, next) => await next())
        app.get('/test', (c) => c.text('ok'))
        return app
      },
      '/test',
      iterations
    )
  )

  console.log('3/15: 1 middleware with variable read...')
  results.push(
    await profileScenario(
      '1 middleware with var read',
      () => {
        const app = new Hono()
        app.use('*', async (c, next) => {
          c.get('nonexistent') // Access variable
          await next()
        })
        app.get('/test', (c) => c.text('ok'))
        return app
      },
      '/test',
      iterations
    )
  )

  console.log('4/15: 1 middleware with variable set...')
  results.push(
    await profileScenario(
      '1 middleware with var set',
      () => {
        const app = new Hono<{ Variables: { key: string } }>()
        app.use('*', async (c, next) => {
          c.set('key', 'value')
          await next()
        })
        app.get('/test', (c) => c.text('ok'))
        return app
      },
      '/test',
      iterations
    )
  )

  console.log('5/15: 1 middleware with header access...')
  results.push(
    await profileScenario(
      '1 middleware with header access',
      () => {
        const app = new Hono()
        app.use('*', async (c, next) => {
          c.req.header('user-agent')
          await next()
        })
        app.get('/test', (c) => c.text('ok'))
        return app
      },
      '/test',
      iterations
    )
  )

  // Multiple middleware chains
  console.log('6/15: 2 passthrough middleware...')
  results.push(
    await profileScenario(
      '2 passthrough middleware',
      () => {
        const app = new Hono()
        app.use('*', async (c, next) => await next())
        app.use('*', async (c, next) => await next())
        app.get('/test', (c) => c.text('ok'))
        return app
      },
      '/test',
      iterations
    )
  )

  console.log('7/15: 3 passthrough middleware...')
  results.push(
    await profileScenario(
      '3 passthrough middleware',
      () => {
        const app = new Hono()
        app.use('*', async (c, next) => await next())
        app.use('*', async (c, next) => await next())
        app.use('*', async (c, next) => await next())
        app.get('/test', (c) => c.text('ok'))
        return app
      },
      '/test',
      iterations
    )
  )

  console.log('8/15: 5 passthrough middleware...')
  results.push(
    await profileScenario(
      '5 passthrough middleware',
      () => {
        const app = new Hono()
        app.use('*', async (c, next) => await next())
        app.use('*', async (c, next) => await next())
        app.use('*', async (c, next) => await next())
        app.use('*', async (c, next) => await next())
        app.use('*', async (c, next) => await next())
        app.get('/test', (c) => c.text('ok'))
        return app
      },
      '/test',
      iterations
    )
  )

  // Middleware with different operations
  console.log('9/15: 3 middleware with var operations...')
  results.push(
    await profileScenario(
      '3 middleware with var ops',
      () => {
        const app = new Hono<{ Variables: { a: string; b: string; c: string } }>()
        app.use('*', async (c, next) => {
          c.set('a', 'value-a')
          await next()
        })
        app.use('*', async (c, next) => {
          c.set('b', 'value-b')
          await next()
        })
        app.use('*', async (c, next) => {
          c.set('c', 'value-c')
          await next()
        })
        app.get('/test', (c) => c.text('ok'))
        return app
      },
      '/test',
      iterations
    )
  )

  console.log('10/15: 3 middleware with header checks...')
  results.push(
    await profileScenario(
      '3 middleware with header checks',
      () => {
        const app = new Hono()
        app.use('*', async (c, next) => {
          c.req.header('authorization')
          await next()
        })
        app.use('*', async (c, next) => {
          c.req.header('content-type')
          await next()
        })
        app.use('*', async (c, next) => {
          c.req.header('user-agent')
          await next()
        })
        app.get('/test', (c) => c.text('ok'))
        return app
      },
      '/test',
      iterations
    )
  )

  // Response variations
  console.log('11/15: 3 middleware + JSON response...')
  results.push(
    await profileScenario(
      '3 middleware + JSON response',
      () => {
        const app = new Hono()
        app.use('*', async (c, next) => await next())
        app.use('*', async (c, next) => await next())
        app.use('*', async (c, next) => await next())
        app.get('/test', (c) => c.json({ message: 'ok' }))
        return app
      },
      '/test',
      iterations
    )
  )

  console.log('12/15: No middleware + JSON response...')
  results.push(
    await profileScenario(
      'No middleware + JSON response',
      () => {
        const app = new Hono()
        app.get('/test', (c) => c.json({ message: 'ok' }))
        return app
      },
      '/test',
      iterations
    )
  )

  // Middleware with early returns
  console.log('13/15: 1 middleware with early return...')
  results.push(
    await profileScenario(
      '1 middleware with early return',
      () => {
        const app = new Hono()
        app.use('*', async (c) => {
          return c.text('intercepted')
        })
        app.get('/test', (c) => c.text('ok'))
        return app
      },
      '/test',
      iterations
    )
  )

  console.log('14/15: 3 middleware, 1st early return...')
  results.push(
    await profileScenario(
      '3 middleware, 1st early return',
      () => {
        const app = new Hono()
        app.use('*', async (c) => {
          return c.text('intercepted')
        })
        app.use('*', async (c, next) => await next())
        app.use('*', async (c, next) => await next())
        app.get('/test', (c) => c.text('ok'))
        return app
      },
      '/test',
      iterations
    )
  )

  // Complex scenario
  console.log('15/15: Complex: 3 middleware + vars + headers...')
  results.push(
    await profileScenario(
      'Complex: 3 mw + vars + headers',
      () => {
        const app = new Hono<{ Variables: { user: string; id: number } }>()
        app.use('*', async (c, next) => {
          c.req.header('authorization')
          c.set('user', 'testuser')
          await next()
        })
        app.use('*', async (c, next) => {
          c.get('user')
          c.set('id', 12345)
          await next()
        })
        app.use('*', async (c, next) => {
          c.req.header('user-agent')
          await next()
        })
        app.get('/test', (c) => c.json({ user: c.get('user'), id: c.get('id') }))
        return app
      },
      '/test',
      iterations
    )
  )

  console.log('')
  console.log('=' + '='.repeat(79))
  console.log('📊 Results')
  console.log('=' + '='.repeat(79))
  console.log('')

  // Print results table
  console.log('| Scenario                        | Throughput    | Heap/Req    | vs Baseline |')
  console.log('|---------------------------------|---------------|-------------|-------------|')

  const baseline = results[0].perRequestBytes

  for (const result of results) {
    const name = result.name.padEnd(31)
    const throughput = `${Math.round(result.throughput).toLocaleString()} req/s`.padEnd(13)
    const perRequest = formatBytes(result.perRequestBytes).padEnd(11)
    const delta = result.perRequestBytes - baseline
    const deltaStr = delta >= 0 ? `+${formatBytes(delta)}` : formatBytes(delta)
    console.log(`| ${name} | ${throughput} | ${perRequest} | ${deltaStr.padEnd(11)} |`)
  }

  console.log('')
  console.log('=' + '='.repeat(79))
  console.log('🔍 Analysis')
  console.log('=' + '='.repeat(79))
  console.log('')

  // Calculate middleware overhead
  const noMiddleware = results.find((r) => r.name === 'No middleware (baseline)')!
  const oneMiddleware = results.find((r) => r.name === '1 passthrough middleware')!
  const twoMiddleware = results.find((r) => r.name === '2 passthrough middleware')!
  const threeMiddleware = results.find((r) => r.name === '3 passthrough middleware')!
  const fiveMiddleware = results.find((r) => r.name === '5 passthrough middleware')!

  console.log('📈 Middleware Scaling Analysis:')
  console.log('')
  console.log(`  0 middleware: ${formatBytes(noMiddleware.perRequestBytes)}`)
  console.log(
    `  1 middleware: ${formatBytes(oneMiddleware.perRequestBytes)} (+${formatBytes(
      oneMiddleware.perRequestBytes - noMiddleware.perRequestBytes
    )})`
  )
  console.log(
    `  2 middleware: ${formatBytes(twoMiddleware.perRequestBytes)} (+${formatBytes(
      twoMiddleware.perRequestBytes - noMiddleware.perRequestBytes
    )})`
  )
  console.log(
    `  3 middleware: ${formatBytes(threeMiddleware.perRequestBytes)} (+${formatBytes(
      threeMiddleware.perRequestBytes - noMiddleware.perRequestBytes
    )})`
  )
  console.log(
    `  5 middleware: ${formatBytes(fiveMiddleware.perRequestBytes)} (+${formatBytes(
      fiveMiddleware.perRequestBytes - noMiddleware.perRequestBytes
    )})`
  )
  console.log('')

  const perMiddlewareOverhead = (threeMiddleware.perRequestBytes - noMiddleware.perRequestBytes) / 3
  console.log(`  📊 Average overhead per middleware: ${formatBytes(perMiddlewareOverhead)}`)
  console.log('')

  // Middleware operation costs
  const oneVar = results.find((r) => r.name === '1 middleware with var set')!
  const oneHeader = results.find((r) => r.name === '1 middleware with header access')!

  console.log('💡 Operation Costs (single middleware):')
  console.log('')
  console.log(
    `  Passthrough (no ops):    ${formatBytes(
      oneMiddleware.perRequestBytes - noMiddleware.perRequestBytes
    )}`
  )
  console.log(
    `  With var set:            ${formatBytes(
      oneVar.perRequestBytes - noMiddleware.perRequestBytes
    )}`
  )
  console.log(
    `  With header access:      ${formatBytes(
      oneHeader.perRequestBytes - noMiddleware.perRequestBytes
    )}`
  )
  console.log('')

  // Response type comparison
  const threeTextMw = results.find((r) => r.name === '3 passthrough middleware')!
  const threeJsonMw = results.find((r) => r.name === '3 middleware + JSON response')!
  const noMwJson = results.find((r) => r.name === 'No middleware + JSON response')!

  console.log('📝 Response Type Analysis:')
  console.log('')
  console.log(`  Text response (no middleware):   ${formatBytes(noMiddleware.perRequestBytes)}`)
  console.log(`  Text response (3 middleware):    ${formatBytes(threeTextMw.perRequestBytes)}`)
  console.log(`  JSON response (no middleware):   ${formatBytes(noMwJson.perRequestBytes)}`)
  console.log(`  JSON response (3 middleware):    ${formatBytes(threeJsonMw.perRequestBytes)}`)
  console.log('')

  // Identify high-allocation patterns
  console.log('🎯 Key Findings:')
  console.log('')

  const sortedByAllocation = [...results].sort((a, b) => b.perRequestBytes - a.perRequestBytes)

  console.log('  Top 3 highest allocation scenarios:')
  for (let i = 0; i < 3; i++) {
    const r = sortedByAllocation[i]
    console.log(`    ${i + 1}. ${r.name}: ${formatBytes(r.perRequestBytes)}`)
  }
  console.log('')

  console.log('  Top 3 lowest allocation scenarios:')
  const bottomThree = sortedByAllocation.slice(-3).reverse()
  for (let i = 0; i < 3; i++) {
    const r = bottomThree[i]
    console.log(`    ${i + 1}. ${r.name}: ${formatBytes(r.perRequestBytes)}`)
  }
  console.log('')

  // Middleware vs response allocation
  const textResponseOverhead = noMiddleware.perRequestBytes
  const middlewareOverhead = threeMiddleware.perRequestBytes - noMiddleware.perRequestBytes

  console.log('⚖️  Allocation Breakdown (3 middleware + text response):')
  console.log('')
  console.log(
    `  Text response:       ${formatBytes(textResponseOverhead)} (${(
      (textResponseOverhead / threeMiddleware.perRequestBytes) *
      100
    ).toFixed(1)}%)`
  )
  console.log(
    `  Middleware chain:    ${formatBytes(middlewareOverhead)} (${(
      (middlewareOverhead / threeMiddleware.perRequestBytes) *
      100
    ).toFixed(1)}%)`
  )
  console.log(`  Total:               ${formatBytes(threeMiddleware.perRequestBytes)}`)
  console.log('')

  console.log('=' + '='.repeat(79))
  console.log('✅ Analysis complete')
  console.log('')
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
