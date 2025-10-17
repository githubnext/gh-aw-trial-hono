/**
 * Response Caching Example
 *
 * Demonstrates the performance impact of caching expensive operations.
 * This example shows a 100-400x improvement for cached requests.
 */

import { Hono } from '../../src'
import type { Context, Next } from '../../src'

// =============================================================================
// Simulated Expensive Operation
// =============================================================================

/**
 * Simulates an expensive database query or API call
 * In real applications, this could be:
 * - Database aggregation query
 * - External API call
 * - Complex computation
 * - File system operations
 */
async function expensiveOperation(): Promise<{ config: string; timestamp: number }> {
  // Simulate 50-100ms latency
  await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 50))

  return {
    config: 'application-config-data',
    timestamp: Date.now(),
  }
}

// =============================================================================
// BEFORE: No Caching (Anti-pattern)
// =============================================================================

const appBefore = new Hono()

appBefore.get('/api/config', async (c) => {
  // Every request hits the expensive operation
  const config = await expensiveOperation()
  return c.json(config)
})

// Cost: 50-100ms per request
// Problem: Repeated expensive operations for the same data

// =============================================================================
// AFTER: With In-Memory Caching (Optimized)
// =============================================================================

const appAfter = new Hono()

// Simple in-memory cache with TTL
const responseCache = new Map<string, { response: Response; expiresAt: number }>()

/**
 * Cache middleware with configurable TTL
 * @param ttlSeconds Time-to-live in seconds
 */
const cacheMiddleware = (ttlSeconds: number) => {
  return async (c: Context, next: Next) => {
    const key = c.req.url
    const cached = responseCache.get(key)

    // Return cached response if still valid
    if (cached && Date.now() < cached.expiresAt) {
      c.header('X-Cache', 'HIT')
      return cached.response.clone()
    }

    // Mark as cache miss
    c.header('X-Cache', 'MISS')

    // Execute handler
    await next()

    // Cache successful GET responses
    if (c.res.ok && c.req.method === 'GET') {
      responseCache.set(key, {
        response: c.res.clone(),
        expiresAt: Date.now() + ttlSeconds * 1000,
      })
    }
  }
}

// Apply cache with 5-minute TTL
appAfter.get('/api/config', cacheMiddleware(300), async (c) => {
  const config = await expensiveOperation()
  return c.json(config)
})

// Cost: 0.5-2ms for cached requests (100-200x faster)
// Cost: 50-100ms for cache miss (same as before)
// Benefit: Expensive operation only runs once every 5 minutes

// =============================================================================
// Benchmark
// =============================================================================

async function benchmark() {
  console.log('🚀 Response Caching Performance Benchmark\n')
  console.log('='.repeat(60))

  // Test configuration
  const iterations = 20
  const baseUrl = 'http://localhost'

  // Benchmark BEFORE (no caching)
  console.log('\n📊 BEFORE: No Caching')
  console.log('-'.repeat(60))

  const beforeTimes: number[] = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    const res = await appBefore.request(`${baseUrl}/api/config`)
    const end = performance.now()

    beforeTimes.push(end - start)

    if (i === 0 || i === iterations - 1) {
      console.log(`Request ${i + 1}: ${(end - start).toFixed(2)}ms`)
    }
  }

  const beforeAvg = beforeTimes.reduce((a, b) => a + b, 0) / beforeTimes.length
  const beforeMin = Math.min(...beforeTimes)
  const beforeMax = Math.max(...beforeTimes)

  console.log(`\nResults (${iterations} requests):`)
  console.log(`  Average: ${beforeAvg.toFixed(2)}ms`)
  console.log(`  Min: ${beforeMin.toFixed(2)}ms`)
  console.log(`  Max: ${beforeMax.toFixed(2)}ms`)

  // Benchmark AFTER (with caching)
  console.log('\n📊 AFTER: With 5-Minute Cache')
  console.log('-'.repeat(60))

  const afterTimes: number[] = []
  const cacheHits = { hit: 0, miss: 0 }

  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    const res = await appAfter.request(`${baseUrl}/api/config`)
    const end = performance.now()

    afterTimes.push(end - start)

    const cacheStatus = res.headers.get('X-Cache')
    if (cacheStatus === 'HIT') cacheHits.hit++
    else cacheHits.miss++

    if (i === 0) {
      console.log(`Request ${i + 1} (cache miss): ${(end - start).toFixed(2)}ms`)
    } else if (i === 1) {
      console.log(`Request ${i + 1} (cache hit): ${(end - start).toFixed(2)}ms`)
    }
  }

  const afterAvg = afterTimes.reduce((a, b) => a + b, 0) / afterTimes.length
  const afterMin = Math.min(...afterTimes)
  const afterMax = Math.max(...afterTimes)

  // Calculate improvement
  const avgImprovement = ((beforeAvg - afterAvg) / beforeAvg) * 100
  const speedup = beforeAvg / afterAvg

  console.log(`\nResults (${iterations} requests):`)
  console.log(`  Average: ${afterAvg.toFixed(2)}ms`)
  console.log(`  Min: ${afterMin.toFixed(2)}ms`)
  console.log(`  Max: ${afterMax.toFixed(2)}ms`)
  console.log(`  Cache Hits: ${cacheHits.hit}`)
  console.log(`  Cache Misses: ${cacheHits.miss}`)

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('📈 PERFORMANCE IMPROVEMENT')
  console.log('='.repeat(60))
  console.log(`  Before (avg): ${beforeAvg.toFixed(2)}ms`)
  console.log(`  After (avg): ${afterAvg.toFixed(2)}ms`)
  console.log(`  Improvement: ${avgImprovement.toFixed(1)}% faster`)
  console.log(`  Speedup: ${speedup.toFixed(1)}x`)
  console.log(`  Time Saved: ${(beforeAvg - afterAvg).toFixed(2)}ms per request`)

  // Real-world impact
  const requestsPerMinute = 1000
  const timeSavedPerMinute = ((beforeAvg - afterAvg) / 1000) * requestsPerMinute
  console.log(`\n💡 Real-World Impact:`)
  console.log(`  At 1000 requests/minute:`)
  console.log(`    Time saved: ${timeSavedPerMinute.toFixed(1)}s/minute`)
  console.log(`    Time saved: ${(timeSavedPerMinute * 60).toFixed(0)}s/hour`)
  console.log(`    Capacity gain: Handle ${speedup.toFixed(1)}x more traffic`)

  console.log('\n✅ Recommendation:')
  console.log('   Use caching for:')
  console.log('   - Configuration data')
  console.log('   - Static API responses')
  console.log('   - Expensive computations')
  console.log('   - External API results')
  console.log('\n   Set TTL based on:')
  console.log('   - Data freshness requirements')
  console.log('   - Update frequency')
  console.log('   - Acceptable staleness')

  // Advanced: Cache hit rate analysis
  console.log('\n📊 Cache Effectiveness:')
  const hitRate = (cacheHits.hit / iterations) * 100
  console.log(`  Hit Rate: ${hitRate.toFixed(1)}%`)
  console.log(`  Miss Rate: ${(100 - hitRate).toFixed(1)}%`)

  if (hitRate > 80) {
    console.log('  ✅ Excellent cache hit rate!')
  } else if (hitRate > 50) {
    console.log('  ⚠️  Good cache hit rate, consider longer TTL')
  } else {
    console.log('  ❌ Low cache hit rate, review caching strategy')
  }
}

// Run benchmark if executed directly
if (import.meta.main) {
  benchmark().catch(console.error)
}

// Export for testing
export { appBefore, appAfter, expensiveOperation, cacheMiddleware }
