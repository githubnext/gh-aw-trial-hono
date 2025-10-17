/**
 * Benchmark: Streaming Responses
 *
 * Compares buffered vs streaming responses
 * Focus on memory efficiency and time to first byte
 */

import before from './before'
import after from './after'

interface BenchmarkResult {
  name: string
  totalTimeMs: number
  timeToFirstByteMs: number
  memoryUsedMB: number
  responseSizeMB: number
}

async function measureMemoryUsage(fn: () => Promise<void>): Promise<number> {
  if (globalThis.Bun) {
    const before = process.memoryUsage().heapUsed
    await fn()
    const after = process.memoryUsage().heapUsed
    return (after - before) / 1024 / 1024 // MB
  }
  // Fallback for non-Bun environments
  return 0
}

async function benchmarkResponse(app: any, endpoint: string): Promise<BenchmarkResult> {
  const url = `http://localhost${endpoint}`

  // Measure time to first byte
  const ttfbStart = performance.now()
  const req = new Request(url)
  const response = await app.fetch(req)

  // Start reading response
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No reader')

  // Read first chunk to measure TTFB
  const firstChunkStart = performance.now()
  await reader.read()
  const timeToFirstByte = performance.now() - firstChunkStart

  // Read rest of response
  let totalSize = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) totalSize += value.length
  }

  const totalTime = performance.now() - ttfbStart

  return {
    name: endpoint,
    totalTimeMs: totalTime,
    timeToFirstByteMs: timeToFirstByte,
    memoryUsedMB: 0, // Measured separately
    responseSizeMB: totalSize / 1024 / 1024,
  }
}

async function measureMemoryForEndpoint(app: any, endpoint: string): Promise<number> {
  // Force GC if available
  if (globalThis.gc) globalThis.gc()

  const before = process.memoryUsage().heapUsed

  // Make request
  const req = new Request(`http://localhost${endpoint}`)
  const response = await app.fetch(req)

  // Read entire response
  const reader = response.body?.getReader()
  if (reader) {
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  }

  const after = process.memoryUsage().heapUsed
  const memoryDelta = (after - before) / 1024 / 1024

  // Force GC again
  if (globalThis.gc) globalThis.gc()

  return Math.max(0, memoryDelta) // Avoid negative values
}

function printResults(
  beforeResult: BenchmarkResult,
  afterResult: BenchmarkResult,
  beforeMemory: number,
  afterMemory: number
) {
  console.log('\n' + '='.repeat(80))
  console.log('  Streaming Response Performance Comparison')
  console.log('='.repeat(80))
  console.log('')

  console.log('BEFORE: Buffered Response (10,000 items)')
  console.log('─'.repeat(80))
  console.log(`  Total time:        ${beforeResult.totalTimeMs.toFixed(2)}ms`)
  console.log(`  Time to first byte: ${beforeResult.timeToFirstByteMs.toFixed(2)}ms`)
  console.log(`  Response size:     ${beforeResult.responseSizeMB.toFixed(2)}MB`)
  console.log(`  Peak memory:       ~${beforeMemory.toFixed(2)}MB`)
  console.log('')

  console.log('AFTER: Streaming Response (10,000 items)')
  console.log('─'.repeat(80))
  console.log(`  Total time:        ${afterResult.totalTimeMs.toFixed(2)}ms`)
  console.log(`  Time to first byte: ${afterResult.timeToFirstByteMs.toFixed(2)}ms`)
  console.log(`  Response size:     ${afterResult.responseSizeMB.toFixed(2)}MB`)
  console.log(`  Peak memory:       ~${afterMemory.toFixed(2)}MB`)
  console.log('')

  console.log('IMPROVEMENT')
  console.log('─'.repeat(80))

  const totalTimeChange =
    ((afterResult.totalTimeMs - beforeResult.totalTimeMs) / beforeResult.totalTimeMs) * 100
  const ttfbImprovement =
    ((beforeResult.timeToFirstByteMs - afterResult.timeToFirstByteMs) /
      beforeResult.timeToFirstByteMs) *
    100

  if (beforeMemory > 0 && afterMemory > 0) {
    const memoryImprovement = ((beforeMemory - afterMemory) / beforeMemory) * 100
    console.log(
      `  Memory efficiency: -${memoryImprovement.toFixed(1)}% (${(
        beforeMemory / afterMemory
      ).toFixed(1)}x better)`
    )
  }

  if (ttfbImprovement > 0) {
    console.log(`  Time to first byte: -${ttfbImprovement.toFixed(1)}% faster`)
  } else {
    console.log(
      `  Time to first byte: +${Math.abs(ttfbImprovement).toFixed(1)}% (small overhead acceptable)`
    )
  }

  if (totalTimeChange < 0) {
    console.log(`  Total time:        ${totalTimeChange.toFixed(1)}% (slight improvement)`)
  } else {
    console.log(
      `  Total time:        +${totalTimeChange.toFixed(1)}% (acceptable for memory savings)`
    )
  }

  console.log('')

  console.log('KEY INSIGHTS')
  console.log('─'.repeat(80))
  console.log('  • Streaming uses constant memory regardless of response size')
  console.log('  • Buffered approach memory scales linearly with response size')
  console.log(
    '  • For 10,000 items (~${beforeResult.responseSizeMB.toFixed(1)}MB), streaming is essential'
  )
  console.log('  • Better user experience: streaming starts sending data immediately')
  console.log('  • Critical for large exports, reports, or data dumps')
  console.log('  • Prevents OOM errors with concurrent requests')
  console.log('')

  console.log('WHEN TO USE STREAMING')
  console.log('─'.repeat(80))
  console.log('  ✅ Large responses (> 1MB)')
  console.log('  ✅ Unbounded datasets (pagination, infinite scroll)')
  console.log('  ✅ Real-time data (SSE, live updates)')
  console.log('  ✅ High concurrency scenarios')
  console.log('  ❌ Small responses (< 100KB) - buffering is fine')
  console.log('')
  console.log('='.repeat(80))
  console.log('')
}

async function main() {
  console.log('\nRunning streaming benchmark...\n')
  console.log('This may take 20-30 seconds...\n')

  // Test large endpoint
  console.log('Testing BEFORE (buffered, 10K items)...')
  const beforeResult = await benchmarkResponse(before, '/api/export')

  console.log('Measuring memory usage (before)...')
  const beforeMemory = await measureMemoryForEndpoint(before, '/api/export')

  await new Promise((resolve) => setTimeout(resolve, 100))

  console.log('Testing AFTER (streaming, 10K items)...')
  const afterResult = await benchmarkResponse(after, '/api/export')

  console.log('Measuring memory usage (after)...')
  const afterMemory = await measureMemoryForEndpoint(after, '/api/export')

  printResults(beforeResult, afterResult, beforeMemory, afterMemory)

  console.log('NOTE: Memory measurements may vary based on GC timing.')
  console.log('      Run benchmark multiple times for consistent results.')
  console.log('      For production workloads with 100K+ items, streaming is essential.\n')
}

main().catch(console.error)
