/**
 * Benchmark: Response Caching
 *
 * Compares performance before and after implementing response caching
 */

import before from './before'
import after, { clearCache } from './after'

interface BenchmarkResult {
  name: string
  requestsPerSecond: number
  avgLatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
}

async function benchmarkApp(app: any, name: string, requests: number): Promise<BenchmarkResult> {
  const latencies: number[] = []
  const start = Date.now()

  for (let i = 0; i < requests; i++) {
    const reqStart = performance.now()
    const req = new Request('http://localhost/api/data')
    await app.fetch(req)
    latencies.push(performance.now() - reqStart)
  }

  const totalTime = Date.now() - start
  const requestsPerSecond = (requests / totalTime) * 1000

  latencies.sort((a, b) => a - b)
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length
  const p95Latency = latencies[Math.floor(latencies.length * 0.95)]
  const p99Latency = latencies[Math.floor(latencies.length * 0.99)]

  return {
    name,
    requestsPerSecond,
    avgLatencyMs: avgLatency,
    p95LatencyMs: p95Latency,
    p99LatencyMs: p99Latency,
  }
}

function printResults(before: BenchmarkResult, after: BenchmarkResult) {
  console.log('\n' + '='.repeat(80))
  console.log('  Response Caching Performance Comparison')
  console.log('='.repeat(80))
  console.log('')

  console.log('BEFORE: No Caching')
  console.log('─'.repeat(80))
  console.log(`  Requests/sec: ${before.requestsPerSecond.toFixed(2)}`)
  console.log(`  Avg latency:  ${before.avgLatencyMs.toFixed(2)}ms`)
  console.log(`  P95 latency:  ${before.p95LatencyMs.toFixed(2)}ms`)
  console.log(`  P99 latency:  ${before.p99LatencyMs.toFixed(2)}ms`)
  console.log('')

  console.log('AFTER: In-Memory Caching (5s TTL)')
  console.log('─'.repeat(80))
  console.log(`  Requests/sec: ${after.requestsPerSecond.toFixed(2)}`)
  console.log(`  Avg latency:  ${after.avgLatencyMs.toFixed(2)}ms`)
  console.log(`  P95 latency:  ${after.p95LatencyMs.toFixed(2)}ms`)
  console.log(`  P99 latency:  ${after.p99LatencyMs.toFixed(2)}ms`)
  console.log('')

  console.log('IMPROVEMENT')
  console.log('─'.repeat(80))
  const throughputImprovement =
    ((after.requestsPerSecond - before.requestsPerSecond) / before.requestsPerSecond) * 100
  const latencyImprovement =
    ((before.avgLatencyMs - after.avgLatencyMs) / before.avgLatencyMs) * 100
  const p95Improvement = ((before.p95LatencyMs - after.p95LatencyMs) / before.p95LatencyMs) * 100

  console.log(
    `  Throughput:   +${throughputImprovement.toFixed(1)}% (${(
      after.requestsPerSecond / before.requestsPerSecond
    ).toFixed(1)}x faster)`
  )
  console.log(`  Avg latency:  -${latencyImprovement.toFixed(1)}%`)
  console.log(`  P95 latency:  -${p95Improvement.toFixed(1)}%`)
  console.log('')

  console.log('KEY INSIGHTS')
  console.log('─'.repeat(80))
  console.log(`  • First request: ~50ms (expensive operation)`)
  console.log(`  • Cached requests: ~${after.avgLatencyMs.toFixed(2)}ms (memory lookup)`)
  console.log(`  • Cache hit rate significantly impacts overall performance`)
  console.log(
    `  • ${(after.requestsPerSecond / before.requestsPerSecond).toFixed(
      0
    )}x improvement demonstrates power of caching`
  )
  console.log('')
  console.log('='.repeat(80))
  console.log('')
}

async function main() {
  const numRequests = 1000

  console.log(`\nRunning benchmark with ${numRequests} requests per scenario...\n`)

  // Benchmark BEFORE (no caching)
  console.log('Testing BEFORE (no caching)...')
  const beforeResult = await benchmarkApp(before, 'Before', numRequests)

  // Small delay between benchmarks
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Benchmark AFTER (with caching)
  // Note: First request will be slow (cache miss), rest will be fast (cache hits)
  console.log('Testing AFTER (with caching)...')
  clearCache() // Start with empty cache
  const afterResult = await benchmarkApp(after, 'After', numRequests)

  printResults(beforeResult, afterResult)

  console.log('NOTE: The "after" benchmark includes one cache miss (first request)')
  console.log('      and 999 cache hits, demonstrating realistic cache behavior.')
  console.log('      In production, cache hit rate depends on TTL and traffic patterns.\n')
}

main().catch(console.error)
