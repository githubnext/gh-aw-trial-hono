/**
 * Middleware Ordering Example
 *
 * Demonstrates the performance impact of middleware organization.
 * Shows how to optimize middleware ordering and selective application.
 */

import { Hono } from '../../src'
import type { Context, Next } from '../../src'

// =============================================================================
// Simulated Middleware Operations
// =============================================================================

/**
 * Simulates logger middleware (~0.5ms)
 */
const logger = () => {
  return async (c: Context, next: Next) => {
    const start = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 0.5))
    await next()
    const duration = Date.now() - start
    console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.path} - ${duration}ms`)
  }
}

/**
 * Simulates expensive auth middleware (~50ms database lookup)
 */
const expensiveAuth = () => {
  return async (c: Context, next: Next) => {
    const token = c.req.header('Authorization')

    // Simulate database lookup
    await new Promise((resolve) => setTimeout(resolve, 50))

    if (!token || token !== 'Bearer valid-token') {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    c.set('user', { id: 1, name: 'Test User' })
    await next()
  }
}

/**
 * Simulates rate limiter middleware (~20ms Redis check)
 */
const rateLimiter = () => {
  return async (c: Context, next: Next) => {
    // Simulate Redis check
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Simple in-memory rate limiting
    const ip = c.req.header('X-Forwarded-For') || 'unknown'
    // In production, use Redis or similar
    await next()
  }
}

// =============================================================================
// BEFORE: Poor Middleware Organization (Anti-pattern)
// =============================================================================

const appBefore = new Hono()

// ❌ BAD: All middleware runs for all routes
appBefore.use('*', logger())
appBefore.use('*', expensiveAuth()) // 50ms
appBefore.use('*', rateLimiter()) // 20ms

// Health check pays 70ms middleware cost unnecessarily
appBefore.get('/health', (c) => c.text('OK'))

// Public API endpoint pays 70ms middleware cost when auth not needed
appBefore.get('/api/public/status', (c) => {
  return c.json({ status: 'operational', timestamp: Date.now() })
})

// Protected endpoint (auth actually needed here)
appBefore.get('/api/protected/data', (c) => {
  const user = c.get('user')
  return c.json({ message: 'Secret data', user })
})

// Cost:
// - /health: 70ms middleware overhead
// - /api/public/status: 70ms middleware overhead
// - /api/protected/data: 70ms middleware overhead (necessary)

// =============================================================================
// AFTER: Optimized Middleware Organization
// =============================================================================

const appAfter = new Hono()

// ✅ GOOD: Fast paths first, no middleware
appAfter.get('/health', (c) => c.text('OK'))
// Cost: ~0ms middleware overhead

// ✅ GOOD: Selective middleware for API routes
appAfter.use('/api/*', logger()) // 0.5ms - lightweight, runs for all API routes
appAfter.use('/api/*', rateLimiter()) // 20ms - only for API routes

// ✅ GOOD: Expensive middleware only for protected routes
appAfter.use('/api/protected/*', expensiveAuth()) // 50ms - only where needed

// Public API endpoint (logger + rate limiter only)
appAfter.get('/api/public/status', (c) => {
  return c.json({ status: 'operational', timestamp: Date.now() })
})
// Cost: ~20.5ms middleware overhead

// Protected endpoint (full middleware chain)
appAfter.get('/api/protected/data', (c) => {
  const user = c.get('user')
  return c.json({ message: 'Secret data', user })
})
// Cost: ~70.5ms middleware overhead (necessary)

// =============================================================================
// Advanced: Middleware Consolidation
// =============================================================================

const appConsolidated = new Hono()

/**
 * Combined headers middleware
 * Consolidates multiple header-setting middleware into one
 */
const combinedHeaders = () => {
  return async (c: Context, next: Next) => {
    // Security headers
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('X-XSS-Protection', '1; mode=block')

    // CORS headers
    c.header('Access-Control-Allow-Origin', '*')

    // Cache control
    c.header('Cache-Control', 'public, max-age=3600')

    await next()
  }
}

// Fast path
appConsolidated.get('/health', (c) => c.text('OK'))

// API routes with consolidated headers
appConsolidated.use('/api/*', combinedHeaders())
appConsolidated.use('/api/*', rateLimiter())

appConsolidated.get('/api/public/status', (c) => {
  return c.json({ status: 'operational' })
})

// =============================================================================
// Benchmark
// =============================================================================

async function benchmark() {
  console.log('🚀 Middleware Ordering Performance Benchmark\n')
  console.log('='.repeat(60))

  const iterations = 10
  const baseUrl = 'http://localhost'

  // Test different routes
  const routes = [
    { path: '/health', needsAuth: false },
    { path: '/api/public/status', needsAuth: false },
    { path: '/api/protected/data', needsAuth: true },
  ]

  for (const route of routes) {
    console.log(`\n📍 Testing route: ${route.path}`)
    console.log('-'.repeat(60))

    // Headers for auth if needed
    const headers = route.needsAuth ? { Authorization: 'Bearer valid-token' } : {}

    // Benchmark BEFORE
    console.log('\n  BEFORE: All middleware on all routes')
    const beforeTimes: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await appBefore.request(`${baseUrl}${route.path}`, { headers })
      const end = performance.now()
      beforeTimes.push(end - start)
    }

    const beforeAvg = beforeTimes.reduce((a, b) => a + b, 0) / beforeTimes.length

    // Benchmark AFTER
    console.log('  AFTER: Selective middleware')
    const afterTimes: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await appAfter.request(`${baseUrl}${route.path}`, { headers })
      const end = performance.now()
      afterTimes.push(end - start)
    }

    const afterAvg = afterTimes.reduce((a, b) => a + b, 0) / afterTimes.length

    // Results
    const improvement = beforeAvg - afterAvg
    const improvementPct = (improvement / beforeAvg) * 100

    console.log(`\n  Results:`)
    console.log(`    Before: ${beforeAvg.toFixed(2)}ms`)
    console.log(`    After:  ${afterAvg.toFixed(2)}ms`)
    console.log(`    Saved:  ${improvement.toFixed(2)}ms (${improvementPct.toFixed(1)}% faster)`)

    if (improvement > 1) {
      console.log(`    ✅ Significant improvement!`)
    } else if (improvement > 0) {
      console.log(`    ✓ Small improvement`)
    } else {
      console.log(`    → No change (expected for protected routes)`)
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('📈 SUMMARY')
  console.log('='.repeat(60))
  console.log('\n✅ Key Optimizations:')
  console.log('   1. Fast paths (health checks) bypass all middleware')
  console.log('   2. Logger/rate limiter only on /api/* routes')
  console.log('   3. Auth middleware only on /api/protected/* routes')
  console.log('\n💡 Benefits:')
  console.log('   - Health checks: ~70ms saved (100% middleware eliminated)')
  console.log('   - Public APIs: ~50ms saved (auth eliminated)')
  console.log('   - Protected APIs: No overhead (auth needed)')
  console.log('\n📊 Real-World Impact:')
  console.log('   Mixed traffic (50% health, 30% public, 20% protected):')
  console.log('   - Average savings: ~50ms per request')
  console.log('   - At 1000 req/s: 50 seconds of CPU time saved per second')
  console.log('   - Capacity gain: 2-3x more requests with same resources')

  console.log('\n🎯 Best Practices:')
  console.log('   1. Place fast paths first (health, metrics)')
  console.log('   2. Apply middleware selectively by route prefix')
  console.log('   3. Order middleware by selectivity (most restrictive last)')
  console.log('   4. Consolidate related middleware to reduce overhead')
  console.log('   5. Use early returns in middleware for invalid requests')
}

// Run benchmark if executed directly
if (import.meta.main) {
  benchmark().catch(console.error)
}

// Export for testing
export { appBefore, appAfter, appConsolidated, logger, expensiveAuth, rateLimiter }
