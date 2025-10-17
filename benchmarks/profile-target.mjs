/**
 * Simple benchmark target for testing profiling tools
 * Uses built dist for Node.js compatibility
 *
 * Usage:
 *   bun run tools/profile.ts benchmarks/profile-target.mjs
 *   bun run tools/profile.ts --runtime=node benchmarks/profile-target.mjs
 */

import { Hono } from '../dist/index.js'

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

// Routes
app.get('/ping', (c) => c.text('pong'))

app.get('/api/users/:id', (c) => {
  const id = c.req.param('id')
  return c.json({
    id,
    name: `User ${id}`,
    email: `user${id}@example.com`,
    active: true,
  })
})

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

app.get('/api/fibonacci/:n', (c) => {
  const n = parseInt(c.req.param('n') || '10')

  function fib(x) {
    if (x <= 1) return x
    return fib(x - 1) + fib(x - 2)
  }

  const result = fib(Math.min(n, 35))
  return c.json({ n, result })
})

// Simulate load
async function simulateLoad() {
  console.log('🚀 Starting profiling target...')
  console.log('   Making continuous requests for profiling')
  console.log('   Press Ctrl+C to stop\n')

  const endpoints = [
    '/ping',
    '/api/users/123',
    '/api/search?q=test&limit=20',
    '/api/fibonacci/15',
  ]

  let requestCount = 0
  const startTime = Date.now()

  const statusInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000
    const rps = Math.round(requestCount / elapsed)
    console.log(`   Requests: ${requestCount} | RPS: ${rps}`)
  }, 2000)

  while (true) {
    const promises = endpoints.map(async (path) => {
      try {
        await app.request(path)
        requestCount++
      } catch (err) {
        // Ignore
      }
    })

    await Promise.all(promises)
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}

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

simulateLoad().catch(err => {
  console.error('Error:', err)
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
})
