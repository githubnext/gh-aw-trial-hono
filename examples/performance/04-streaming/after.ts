/**
 * AFTER: Streaming response - sends data incrementally
 *
 * Benefits:
 * - Constant memory usage (only current chunk in memory)
 * - Fast time to first byte (TTFB)
 * - Can handle very large datasets
 * - Better user experience (progressive rendering)
 */

import { Hono } from '../../../src'
import { stream } from '../../../src/helper/streaming'

const app = new Hono()

// Generate large dataset
function* generateLargeDataset(count: number) {
  for (let i = 0; i < count; i++) {
    yield {
      id: i,
      name: `Item ${i}`,
      description: `This is item number ${i} with some description text`,
      metadata: {
        created: new Date().toISOString(),
        value: Math.random() * 1000,
      },
    }
  }
}

// ✅ GOOD: Stream response incrementally
app.get('/api/export', (c) => {
  return stream(c, async (stream) => {
    // Start JSON array
    await stream.write('[')

    let first = true
    // Generate and stream items one at a time
    for (const item of generateLargeDataset(10000)) {
      if (!first) {
        await stream.write(',')
      }
      await stream.write(JSON.stringify(item))
      first = false
    }

    // End JSON array
    await stream.write(']')
  })
})

app.get('/api/small', (c) => {
  // Small response - streaming overhead not worth it
  const items = Array.from(generateLargeDataset(10))
  return c.json(items)
})

export default app
