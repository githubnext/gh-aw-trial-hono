/**
 * BEFORE: Inefficient middleware organization
 *
 * Problems:
 * - Expensive middleware runs on ALL routes (including health check)
 * - Multiple separate middleware increase function call overhead
 * - No route-specific middleware optimization
 */

import { Hono } from '../../../src'
import type { Context, Next } from '../../../src'

const app = new Hono()

// Simulate expensive auth middleware (e.g., database lookup)
const expensiveAuthMiddleware = async (c: Context, next: Next) => {
  const start = Date.now()
  while (Date.now() - start < 20) {
    // Simulate 20ms auth check
    Math.random()
  }
  c.set('user', { id: 1, name: 'Test User' })
  await next()
}

// Simulate rate limiter (e.g., Redis check)
const rateLimiterMiddleware = async (c: Context, next: Next) => {
  const start = Date.now()
  while (Date.now() - start < 10) {
    // Simulate 10ms rate limit check
    Math.random()
  }
  await next()
}

// Logger middleware
const loggerMiddleware = async (c: Context, next: Next) => {
  const start = Date.now()
  while (Date.now() - start < 1) {
    // Simulate 1ms logging
    Math.random()
  }
  await next()
}

// Multiple separate header middleware
const securityHeadersMiddleware = async (c: Context, next: Next) => {
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  await next()
}

const corsHeadersMiddleware = async (c: Context, next: Next) => {
  c.header('Access-Control-Allow-Origin', '*')
  await next()
}

const cacheHeadersMiddleware = async (c: Context, next: Next) => {
  c.header('Cache-Control', 'no-cache')
  await next()
}

// ❌ BAD: Apply ALL middleware to ALL routes
app.use('*', loggerMiddleware)
app.use('*', expensiveAuthMiddleware)
app.use('*', rateLimiterMiddleware)
app.use('*', securityHeadersMiddleware)
app.use('*', corsHeadersMiddleware)
app.use('*', cacheHeadersMiddleware)

// Health check endpoint - unnecessarily pays 31ms middleware cost
app.get('/health', (c) => c.text('OK'))

// Public API endpoint - doesn't need auth but still runs it
app.get('/api/public', (c) => {
  return c.json({ message: 'Public data' })
})

// Protected API endpoint - needs all middleware
app.get('/api/protected', (c) => {
  const user = c.get('user')
  return c.json({ message: 'Protected data', user })
})

export default app
