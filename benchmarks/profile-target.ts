/**
 * Simple benchmark target for testing profiling tools
 *
 * This creates a realistic HTTP workload for profiling:
 * - Multiple routes with different patterns
 * - Middleware chains
 * - JSON responses
 * - Query parameter handling
 *
 * Usage:
 *   bun run tools/profile.ts benchmarks/profile-target.ts
 */

import { Hono } from '../src/hono'

const app = new Hono()

// Middleware: Timing
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  c.header('X-Response-Time', `${duration}ms`)
})

// Middleware: Request ID
app.use('*', async (c, next) => {
  c.set('requestId', Math.random().toString(36).slice(2))
  await next()
})

// Routes: Simple text
app.get('/ping', (c) => c.text('pong'))

// Routes: JSON response
app.get('/api/users/:id', (c) => {
  const id = c.req.param('id')
  return c.json({
    id,
    name: `User ${id}`,
    email: `user${id}@example.com`,
    active: true,
  })
})

// Routes: Query parameters
app.get('/api/search', (c) => {
  const query = c.req.query('q') || ''
  const limit = parseInt(c.req.query('limit') || '10')
  const results = Array.from({ length: Math.min(limit, 100) }, (_, i) => ({
    id: i,
    title: `Result ${i} for "${query}"`,
    relevance: Math.random(),
  }))
  return c.json({ query, results })
})

// Routes: POST with body
app.post('/api/users', async (c) => {
  const body = await c.req.json()
  return c.json({
    id: Math.random().toString(36).slice(2),
    ...body,
    createdAt: new Date().toISOString(),
  })
})

// Routes: Complex computation
app.get('/api/fibonacci/:n', (c) => {
  const n = parseInt(c.req.param('n') || '10')

  function fib(x: number): number {
    if (x <= 1) return x
    return fib(x - 1) + fib(x - 2)
  }

  const result = fib(Math.min(n, 35)) // Cap to avoid excessive computation
  return c.json({ n, result })
})

// Simulate load by making requests
async function simulateLoad() {
  console.log('🚀 Starting profiling target...')
  console.log('   Making continuous requests for profiling')
  console.log('   Press Ctrl+C to stop\n')

  const endpoints = ['/ping', '/api/users/123', '/api/search?q=test&limit=20', '/api/fibonacci/15']

  let requestCount = 0
  const startTime = Date.now()

  // Print status every 2 seconds
  const statusInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000
    const rps = Math.round(requestCount / elapsed)
    console.log(`   Requests: ${requestCount} | RPS: ${rps}`)
  }, 2000)

  // Continuous request loop
  while (true) {
    const promises = endpoints.map(async (path) => {
      try {
        await app.request(path)
        requestCount++
      } catch (err) {
        // Ignore errors during profiling
      }
    })

    await Promise.all(promises)

    // Small delay to avoid overwhelming the system
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\n\n✅ Profiling target stopped')
  // eslint-disable-next-line n/no-process-exit
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n\n✅ Profiling target stopped')
  // eslint-disable-next-line n/no-process-exit
  process.exit(0)
})

// Start load simulation
simulateLoad().catch((err) => {
  console.error('Error:', err)
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
})
