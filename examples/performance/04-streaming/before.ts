/**
 * BEFORE: Buffered response - loads all data into memory
 *
 * Problems:
 * - Loads entire dataset into memory before sending
 * - High memory usage (scales with response size)
 * - Long time to first byte (TTFB)
 * - Risk of OOM with large datasets or concurrent requests
 */

import { Hono } from '../../../src'

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

// ❌ BAD: Buffer entire response in memory
app.get('/api/export', (c) => {
  // Generate 10,000 items - all buffered in memory
  const items = Array.from(generateLargeDataset(10000))

  // Entire response built in memory before sending
  return c.json(items)
})

app.get('/api/small', (c) => {
  // Small response for comparison
  const items = Array.from(generateLargeDataset(10))
  return c.json(items)
})

export default app
