/**
 * Optimized Hono API Example
 *
 * This example demonstrates practical application-level performance optimizations:
 * 1. Response caching with TTL
 * 2. Middleware consolidation and ordering
 * 3. Streaming for large responses
 * 4. Performance monitoring
 * 5. Early returns for fast paths
 *
 * Run with: bun run examples/performance-optimizations/optimized-api-example.ts
 */

import { Hono, type Context, type Next } from '../../src'
import { stream } from '../../src/helper/streaming'

const app = new Hono()

// =======================
// 1. CACHING INFRASTRUCTURE
// =======================

interface CacheEntry {
  response: Response
  expiresAt: number
}

class ResponseCache {
  private cache = new Map<string, CacheEntry>()
  private hits = 0
  private misses = 0

  get(key: string): Response | null {
    const entry = this.cache.get(key)

    if (!entry) {
      this.misses++
      return null
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.misses++
      return null
    }

    this.hits++
    return entry.response.clone()
  }

  set(key: string, response: Response, ttlSeconds: number): void {
    // Limit cache size to prevent memory issues
    if (this.cache.size > 1000) {
      // Simple eviction: delete oldest entry
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    this.cache.set(key, {
      response: response.clone(),
      expiresAt: Date.now() + ttlSeconds * 1000,
    })
  }

  getStats() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits / (this.hits + this.misses),
    }
  }
}

const cache = new ResponseCache()

//=======================
// 2. PERFORMANCE MONITORING
// =======================

const metrics = {
  requestCount: 0,
  errorCount: 0,
  totalDuration: 0,
  slowRequests: 0, // Requests > 1000ms
}

const monitoringMiddleware = async (c: Context, next: Next) => {
  metrics.requestCount++
  const start = performance.now()

  try {
    await next()

    if (!c.res.ok) {
      metrics.errorCount++
    }
  } catch (error) {
    metrics.errorCount++
    throw error
  } finally {
    const duration = performance.now() - start
    metrics.totalDuration += duration

    if (duration > 1000) {
      metrics.slowRequests++
      console.warn(`⚠️ Slow request: ${c.req.method} ${c.req.path} took ${duration.toFixed(2)}ms`)
    }

    // Add Server-Timing header for browser/tool visibility
    c.header('Server-Timing', `total;dur=${duration.toFixed(2)}`)
  }
}

// =======================
// 3. CACHING MIDDLEWARE
// =======================

const cacheMiddleware = (ttlSeconds: number) => {
  return async (c: Context, next: Next) => {
    // Only cache GET requests
    if (c.req.method !== 'GET') {
      return next()
    }

    const cacheKey = c.req.url

    // Check cache
    const cached = cache.get(cacheKey)
    if (cached) {
      c.header('X-Cache', 'HIT')
      return cached
    }

    // Execute handler
    await next()

    // Cache successful responses
    if (c.res.ok) {
      cache.set(cacheKey, c.res, ttlSeconds)
      c.header('X-Cache', 'MISS')
    }
  }
}

// =======================
// 4. CONSOLIDATED HEADERS MIDDLEWARE
// =======================

const headersMiddleware = async (c: Context, next: Next) => {
  // Security headers
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('X-XSS-Protection', '1; mode=block')

  // CORS (adjust for your needs)
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE')

  await next()
}

// =======================
// 5. MIDDLEWARE APPLICATION (OPTIMIZED ORDERING)
// =======================

// Fast paths first (no middleware)
app.get('/health', (c) => c.text('OK'))
app.get('/ping', (c) => c.text('pong'))

// Apply middleware selectively
app.use('/api/*', monitoringMiddleware)
app.use('/api/*', headersMiddleware)

// =======================
// 6. API ENDPOINTS
// =======================

// Cached endpoint - simulates expensive computation
app.get('/api/config', cacheMiddleware(60), async (c) => {
  // Simulate expensive operation (database query, external API call, etc.)
  await new Promise((resolve) => setTimeout(resolve, 100))

  return c.json({
    version: '1.0.0',
    features: ['caching', 'streaming', 'monitoring'],
    timestamp: new Date().toISOString(),
  })
})

// Streaming endpoint - handles large datasets efficiently
app.get('/api/users/export', async (c) => {
  // Simulate large dataset
  const TOTAL_USERS = 10000

  return stream(c, async (stream) => {
    // Set appropriate headers
    c.header('Content-Type', 'application/json')
    c.header('Content-Disposition', 'attachment; filename="users.json"')

    await stream.write('[')

    for (let i = 0; i < TOTAL_USERS; i++) {
      if (i > 0) await stream.write(',')

      const user = {
        id: i + 1,
        name: `User ${i + 1}`,
        email: `user${i + 1}@example.com`,
      }

      await stream.write(JSON.stringify(user))

      // Yield control periodically to prevent blocking
      if (i % 100 === 0) {
        await stream.sleep(0)
      }
    }

    await stream.write(']')
  })
})

// Non-cached dynamic endpoint
app.get('/api/time', async (c) => {
  return c.json({
    timestamp: new Date().toISOString(),
    unix: Date.now(),
  })
})

// Endpoint with early return (auth check)
app.get('/api/protected/data', async (c) => {
  const apiKey = c.req.header('X-API-Key')

  // Early return for missing auth
  if (!apiKey) {
    return c.json({ error: 'API key required' }, 401)
  }

  // Early return for invalid auth
  if (apiKey !== 'demo-key-12345') {
    return c.json({ error: 'Invalid API key' }, 401)
  }

  // Expensive operation only runs for valid requests
  await new Promise((resolve) => setTimeout(resolve, 50))

  return c.json({
    data: 'This is protected data',
    user: 'authenticated-user',
  })
})

// =======================
// 7. METRICS ENDPOINT
// =======================

app.get('/metrics', (c) => {
  const avgDuration = metrics.requestCount > 0 ? metrics.totalDuration / metrics.requestCount : 0

  return c.json({
    requests: {
      total: metrics.requestCount,
      errors: metrics.errorCount,
      errorRate: metrics.requestCount > 0 ? metrics.errorCount / metrics.requestCount : 0,
    },
    performance: {
      avgDuration: avgDuration.toFixed(2) + 'ms',
      slowRequests: metrics.slowRequests,
      slowRequestRate: metrics.requestCount > 0 ? metrics.slowRequests / metrics.requestCount : 0,
    },
    cache: cache.getStats(),
  })
})

// =======================
// 8. EXAMPLE USAGE
// =======================

console.log(`
🚀 Optimized Hono API Example
============================

Try these endpoints to see optimizations in action:

1. Caching:
   curl http://localhost:3000/api/config
   # First request: ~100ms (cache MISS)
   # Subsequent requests: ~0.5ms (cache HIT)
   # Check X-Cache header in response

2. Streaming:
   curl http://localhost:3000/api/users/export > users.json
   # Streams 10,000 users with constant memory (~1-2MB)
   # Compare to buffering: would use ~10-20MB

3. Monitoring:
   curl http://localhost:3000/metrics
   # View performance stats, cache hit rate, slow requests

4. Early Returns:
   # Fast failure path (no auth)
   curl http://localhost:3000/api/protected/data
   # Returns immediately (~0.5ms)

   # With valid auth (expensive path)
   curl -H "X-API-Key: demo-key-12345" http://localhost:3000/api/protected/data
   # Takes ~50ms for processing

5. Server-Timing:
   curl -v http://localhost:3000/api/config
   # Check Server-Timing header for request duration

Performance Tips Demonstrated:
✅ Response caching (100-400x improvement)
✅ Middleware consolidation (reduces overhead)
✅ Streaming for large data (10x memory efficiency)
✅ Performance monitoring (visibility into bottlenecks)
✅ Early returns (fast failure paths)
✅ Selective middleware (only where needed)

Server starting on port 3000...
`)

export default app

// Start server if run directly
if (import.meta.main) {
  Bun.serve({
    port: 3000,
    fetch: app.fetch,
  })
}
