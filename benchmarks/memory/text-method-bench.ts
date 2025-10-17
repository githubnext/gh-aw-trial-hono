#!/usr/bin/env bun
/**
 * Direct micro-benchmark for text() method memory allocation
 */

import { Context } from '../../src/context'

interface MemorySnapshot {
  heapUsed: number
}

function captureMemory(): MemorySnapshot {
  return {
    heapUsed: process.memoryUsage().heapUsed,
  }
}

async function forceGC(): Promise<void> {
  if (global.gc) {
    global.gc()
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function benchmarkTextMethod() {
  console.log('🔬 Direct text() Method Memory Benchmark')
  console.log('='.repeat(70))
  console.log('')

  if (!global.gc) {
    console.log('⚠️  Warning: GC not exposed. Run with `bun --expose-gc`')
    console.log('')
  }

  const iterations = 50000

  // Scenario 1: Simple text response (fast path)
  await forceGC()
  const before1 = captureMemory()
  const start1 = performance.now()

  for (let i = 0; i < iterations; i++) {
    const req = new Request('http://localhost/test')
    const c = new Context(req)
    c.text('Hello, World!')
  }

  const end1 = performance.now()
  const after1 = captureMemory()
  const growth1 = after1.heapUsed - before1.heapUsed
  const perRequest1 = growth1 / iterations
  const throughput1 = iterations / ((end1 - start1) / 1000)

  console.log('Scenario 1: Simple text() - Fast Path')
  console.log(`  Iterations: ${iterations.toLocaleString()}`)
  console.log(`  Throughput: ${Math.round(throughput1).toLocaleString()} ops/s`)
  console.log(`  Heap growth: ${(growth1 / 1024).toFixed(2)} KB`)
  console.log(`  Per-operation: ${perRequest1.toFixed(2)} B`)
  console.log('')

  // Scenario 2: Text with headers (slow path)
  await forceGC()
  const before2 = captureMemory()
  const start2 = performance.now()

  for (let i = 0; i < iterations; i++) {
    const req = new Request('http://localhost/test')
    const c = new Context(req)
    c.header('X-Custom', 'value')
    c.text('Hello, World!')
  }

  const end2 = performance.now()
  const after2 = captureMemory()
  const growth2 = after2.heapUsed - before2.heapUsed
  const perRequest2 = growth2 / iterations
  const throughput2 = iterations / ((end2 - start2) / 1000)

  console.log('Scenario 2: text() with header - Slow Path')
  console.log(`  Iterations: ${iterations.toLocaleString()}`)
  console.log(`  Throughput: ${Math.round(throughput2).toLocaleString()} ops/s`)
  console.log(`  Heap growth: ${(growth2 / 1024).toFixed(2)} KB`)
  console.log(`  Per-operation: ${perRequest2.toFixed(2)} B`)
  console.log('')

  // Scenario 3: JSON for comparison (fast path)
  await forceGC()
  const before3 = captureMemory()
  const start3 = performance.now()

  for (let i = 0; i < iterations; i++) {
    const req = new Request('http://localhost/test')
    const c = new Context(req)
    c.json({ message: 'Hello, World!' })
  }

  const end3 = performance.now()
  const after3 = captureMemory()
  const growth3 = after3.heapUsed - before3.heapUsed
  const perRequest3 = growth3 / iterations
  const throughput3 = iterations / ((end3 - start3) / 1000)

  console.log('Scenario 3: json() - Fast Path (for comparison)')
  console.log(`  Iterations: ${iterations.toLocaleString()}`)
  console.log(`  Throughput: ${Math.round(throughput3).toLocaleString()} ops/s`)
  console.log(`  Heap growth: ${(growth3 / 1024).toFixed(2)} KB`)
  console.log(`  Per-operation: ${perRequest3.toFixed(2)} B`)
  console.log('')

  console.log('='.repeat(70))
  console.log('📊 Summary')
  console.log('='.repeat(70))
  console.log('')
  console.log(`text() fast path allocation:  ${perRequest1.toFixed(2)} B/op`)
  console.log(`text() slow path allocation:  ${perRequest2.toFixed(2)} B/op`)
  console.log(`json() fast path allocation:  ${perRequest3.toFixed(2)} B/op`)
  console.log('')

  const improvement = ((perRequest2 - perRequest1) / perRequest2) * 100
  console.log(`Fast path improvement over slow path: ${improvement.toFixed(1)}%`)
  console.log('')

  if (perRequest1 < perRequest3 * 1.5) {
    console.log('✅ text() fast path is comparable to json() fast path')
  } else {
    console.log(
      `⚠️  text() still allocates ${((perRequest1 / perRequest3) * 100).toFixed(0)}% of json()`
    )
  }
  console.log('')
}

benchmarkTextMethod().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
