/**
 * BEFORE: No caching - expensive operation runs on every request
 *
 * Performance characteristics:
 * - Every request performs expensive computation
 * - High CPU usage
 * - Slow response times
 */

import { Hono } from '../../../src'

const app = new Hono()

// Simulate expensive operation (e.g., complex calculation, external API call)
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

app.get('/api/data', (c) => {
  // No caching - expensive operation on EVERY request
  const result = expensiveOperation()
  return c.json(result)
})

app.get('/api/health', (c) => c.text('OK'))

export default app
