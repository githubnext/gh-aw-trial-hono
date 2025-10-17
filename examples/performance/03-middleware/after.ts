/**
 * AFTER: Optimized middleware organization
 *
 * Improvements:
 * - Fast paths (health check) skip all middleware
 * - Selective middleware application per route group
 * - Combined header middleware reduces function call overhead
 * - Only protected routes run expensive auth
 */

import { Hono } from '../../../src'
import type { Context, Next } from '../../../src'

const app = new Hono()

// Simulate expensive auth middleware
const expensiveAuthMiddleware = async (c: Context, next: Next) => {
  const start = Date.now()
  while (Date.now() - start < 20) {
    Math.random()
  }
  c.set('user', { id: 1, name: 'Test User' })
  await next()
}

// Simulate rate limiter
const rateLimiterMiddleware = async (c: Context, next: Next) => {
  const start = Date.now()
  while (Date.now() - start < 10) {
    Math.random()
  }
  await next()
}

// Logger middleware
const loggerMiddleware = async (c: Context, next: Next) => {
  const start = Date.now()
  while (Date.now() - start < 1) {
    Math.random()
  }
  await next()
}

// ✅ GOOD: Combined header middleware (reduces function calls)
const combinedHeadersMiddleware = async (c: Context, next: Next) => {
  // Set all headers in single middleware
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Cache-Control', 'no-cache')
  await next()
}

// ✅ GOOD: Health check FIRST, no middleware overhead
app.get('/health', (c) => c.text('OK'))

// ✅ GOOD: Public API with minimal middleware (no auth)
app.use('/api/public/*', loggerMiddleware)
app.use('/api/public/*', rateLimiterMiddleware)
app.use('/api/public/*', combinedHeadersMiddleware)

app.get('/api/public', (c) => {
  return c.json({ message: 'Public data' })
})

// ✅ GOOD: Protected API with full middleware stack
app.use('/api/protected/*', loggerMiddleware)
app.use('/api/protected/*', rateLimiterMiddleware)
app.use('/api/protected/*', expensiveAuthMiddleware)
app.use('/api/protected/*', combinedHeadersMiddleware)

app.get('/api/protected', (c) => {
  const user = c.get('user')
  return c.json({ message: 'Protected data', user })
})

export default app
