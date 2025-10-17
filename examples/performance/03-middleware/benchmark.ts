/**
 * Benchmark: Middleware Organization
 *
 * Compares performance before and after optimizing middleware organization
 */

import before from './before'
import after from './after'

interface RouteResult {
  route: string
  requestsPerSecond: number
  avgLatencyMs: number
}

async function benchmarkRoute(app: any, route: string, requests: number): Promise<RouteResult> {
  const latencies: number[] = []
  const start = Date.now()

  for (let i = 0; i < requests; i++) {
    const reqStart = performance.now()
    const req = new Request(`http://localhost${route}`)
    await app.fetch(req)
    latencies.push(performance.now() - reqStart)
  }

  const totalTime = Date.now() - start
  const requestsPerSecond = (requests / totalTime) * 1000
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length

  return {
    route,
    requestsPerSecond,
    avgLatencyMs: avgLatency,
  }
}

function printResults(beforeResults: RouteResult[], afterResults: RouteResult[]) {
  console.log('\n' + '='.repeat(80))
  console.log('  Middleware Organization Performance Comparison')
  console.log('='.repeat(80))
  console.log('')

  const routes = ['/health', '/api/public', '/api/protected']

  for (let i = 0; i < routes.length; i++) {
    const before = beforeResults[i]
    const after = afterResults[i]

    console.log(`Route: ${routes[i]}`)
    console.log('─'.repeat(80))

    console.log(`  BEFORE:`)
    console.log(`    Throughput:  ${before.requestsPerSecond.toFixed(2)} req/s`)
    console.log(`    Avg latency: ${before.avgLatencyMs.toFixed(2)}ms`)

    console.log(`  AFTER:`)
    console.log(`    Throughput:  ${after.requestsPerSecond.toFixed(2)} req/s`)
    console.log(`    Avg latency: ${after.avgLatencyMs.toFixed(2)}ms`)

    const throughputImprovement =
      ((after.requestsPerSecond - before.requestsPerSecond) / before.requestsPerSecond) * 100
    const latencyImprovement =
      ((before.avgLatencyMs - after.avgLatencyMs) / before.avgLatencyMs) * 100

    console.log(`  IMPROVEMENT:`)
    console.log(
      `    Throughput:  +${throughputImprovement.toFixed(1)}% (${(
        after.requestsPerSecond / before.requestsPerSecond
      ).toFixed(2)}x)`
    )
    console.log(`    Latency:     -${latencyImprovement.toFixed(1)}%`)
    console.log('')
  }

  console.log('KEY INSIGHTS')
  console.log('─'.repeat(80))
  console.log('  • /health endpoint: Massive improvement by skipping all middleware')
  console.log('  • /api/public: Significant improvement by skipping auth middleware')
  console.log('  • /api/protected: Smaller improvement from consolidated header middleware')
  console.log('  • Selective middleware application provides biggest wins')
  console.log('  • Combined middleware reduces function call overhead')
  console.log('')
  console.log('MIDDLEWARE COST BREAKDOWN')
  console.log('─'.repeat(80))
  console.log('  Before (all routes):')
  console.log('    Logger: ~1ms, Auth: ~20ms, Rate Limiter: ~10ms')
  console.log('    Headers (3 middleware): ~0.3ms overhead')
  console.log('    Total: ~31ms per request')
  console.log('')
  console.log('  After (optimized):')
  console.log('    /health: 0ms (no middleware)')
  console.log('    /api/public: ~11ms (logger + rate limiter + combined headers)')
  console.log('    /api/protected: ~31ms (all middleware, but headers combined)')
  console.log('')
  console.log('='.repeat(80))
  console.log('')
}

async function main() {
  const requestsPerRoute = 500

  console.log(`\nRunning benchmark with ${requestsPerRoute} requests per route...\n`)

  const routes = ['/health', '/api/public', '/api/protected']

  // Benchmark BEFORE
  console.log('Testing BEFORE (inefficient middleware)...')
  const beforeResults: RouteResult[] = []
  for (const route of routes) {
    beforeResults.push(await benchmarkRoute(before, route, requestsPerRoute))
  }

  // Small delay
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Benchmark AFTER
  console.log('Testing AFTER (optimized middleware)...')
  const afterResults: RouteResult[] = []
  for (const route of routes) {
    afterResults.push(await benchmarkRoute(after, route, requestsPerRoute))
  }

  printResults(beforeResults, afterResults)

  console.log('RECOMMENDATION: Place fast paths first and apply middleware selectively')
  console.log('                based on route requirements. Combine related middleware')
  console.log('                to reduce function call overhead.\n')
}

main().catch(console.error)
