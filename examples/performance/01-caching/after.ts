/**
 * AFTER: In-memory caching with TTL
 *
 * Performance characteristics:
 * - First request performs expensive computation
 * - Subsequent requests served from cache (< 1ms)
 * - 100-400x improvement for cached requests
 * - Automatic cache expiration
 */

import { Hono } from '../../../src'
import type { Context, Next } from '../../../src'

const app = new Hono()

// Simple response cache with TTL
interface CacheEntry {
  response: Response
  expiresAt: number
}

const responseCache = new Map<string, CacheEntry>()

// Cache middleware
function cacheMiddleware(ttlSeconds: number) {
  return async (c: Context, next: Next) => {
    // Only cache GET requests
    if (c.req.method !== 'GET') {
      return next()
    }

    const key = c.req.url
    const cached = responseCache.get(key)

    // Return cached response if still valid
    if (cached && Date.now() < cached.expiresAt) {
      return cached.response.clone()
    }

    // Execute handler
    await next()

    // Cache successful responses
    if (c.res.ok) {
      responseCache.set(key, {
        response: c.res.clone(),
        expiresAt: Date.now() + ttlSeconds * 1000,
      })
    }
  }
}

// Simulate expensive operation
function expensiveOperation() {
  const start = Date.now()
  // Simulate 50ms of work
  while (Date.now() - start < 50) {
    Math.random()
  }
  return {
    timestamp: new Date().toISOString(),
    data: {
      items: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        value: Math.random() * 1000,
      })),
    },
  }
}

// Apply cache middleware with 5-second TTL
app.get('/api/data', cacheMiddleware(5), (c) => {
  const result = expensiveOperation()
  return c.json(result)
})

app.get('/api/health', (c) => c.text('OK'))

// Utility to clear cache (for testing)
export function clearCache() {
  responseCache.clear()
}

export default app
