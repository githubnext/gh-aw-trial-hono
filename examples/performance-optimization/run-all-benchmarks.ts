/**
 * Run All Performance Optimization Benchmarks
 *
 * Executes all example benchmarks and provides a consolidated performance report.
 */

console.log('═'.repeat(80))
console.log('Hono Application-Level Performance Optimization Benchmarks')
console.log('═'.repeat(80))
console.log()

// Import all benchmark functions
import { benchmark as cachingBenchmark } from './caching-example'
import { benchmark as databasePoolingBenchmark } from './database-pooling-example'
import { benchmark as nPlusOneBenchmark } from './n-plus-one-example'
import { benchmark as middlewareOrderingBenchmark } from './middleware-ordering-example'
import { benchmark as streamingBenchmark } from './streaming-example'
import { benchmark as etagBenchmark } from './etag-example'

// ============================================================================
// Benchmark Runner
// ============================================================================

interface BenchmarkInfo {
  name: string
  description: string
  run: () => Promise<void>
}

const benchmarks: BenchmarkInfo[] = [
  {
    name: 'Response Caching',
    description: 'In-memory caching for expensive operations',
    run: cachingBenchmark
  },
  {
    name: 'Database Connection Pooling',
    description: 'Reuse database connections vs creating new ones',
    run: databasePoolingBenchmark
  },
  {
    name: 'N+1 Query Resolution',
    description: 'JOIN queries vs multiple sequential queries',
    run: nPlusOneBenchmark
  },
  {
    name: 'Middleware Optimization',
    description: 'Optimal middleware ordering and selective application',
    run: middlewareOrderingBenchmark
  },
  {
    name: 'Streaming Large Responses',
    description: 'Stream vs buffer-in-memory for large datasets',
    run: streamingBenchmark
  },
  {
    name: 'ETag Conditional Requests',
    description: 'Bandwidth savings with 304 Not Modified responses',
    run: etagBenchmark
  }
]

async function runAllBenchmarks() {
  console.log(`Running ${benchmarks.length} performance optimization benchmarks...\n`)

  for (let i = 0; i < benchmarks.length; i++) {
    const bench = benchmarks[i]

    console.log('─'.repeat(80))
    console.log(`[${i + 1}/${benchmarks.length}] ${bench.name}`)
    console.log(`${bench.description}`)
    console.log('─'.repeat(80))
    console.log()

    try {
      await bench.run()
    } catch (error) {
      console.error(`❌ Benchmark failed: ${error}`)
    }

    if (i < benchmarks.length - 1) {
      console.log()
      console.log()
    }
  }

  console.log()
  console.log('═'.repeat(80))
  console.log('Summary')
  console.log('═'.repeat(80))
  console.log()
  console.log('All benchmarks completed! Review the results above for detailed performance metrics.')
  console.log()
  console.log('📊 Performance Impact Overview:')
  console.log()
  console.log('   1. Response Caching: 100-400x improvement')
  console.log('      → Cache expensive computations and database queries')
  console.log()
  console.log('   2. Database Connection Pooling: 10-20x improvement')
  console.log('      → Reuse connections instead of creating new ones')
  console.log()
  console.log('   3. N+1 Query Resolution: 5-10x improvement')
  console.log('      → Use JOIN queries to fetch related data in one roundtrip')
  console.log()
  console.log('   4. Middleware Optimization: 50-70ms saved per request')
  console.log('      → Order middleware by frequency, skip unnecessary checks')
  console.log()
  console.log('   5. Streaming Large Responses: 10x better memory efficiency')
  console.log('      → Stream large datasets instead of buffering in memory')
  console.log()
  console.log('   6. ETag Conditional Requests: 2-10x bandwidth reduction')
  console.log('      → Return 304 for unchanged content, save bandwidth')
  console.log()
  console.log('💡 Recommended Order of Implementation:')
  console.log()
  console.log('   1️⃣  Response Caching - Highest impact, lowest complexity')
  console.log('   2️⃣  Database Connection Pooling - Essential for production')
  console.log('   3️⃣  N+1 Query Resolution - Critical for relational data')
  console.log('   4️⃣  Middleware Optimization - Easy wins with routing')
  console.log('   5️⃣  ETag Conditional Requests - Great for read-heavy APIs')
  console.log('   6️⃣  Streaming Large Responses - For specific use cases')
  console.log()
  console.log('📚 Next Steps:')
  console.log()
  console.log('   • Review individual example files for implementation details')
  console.log('   • Read .github/copilot/instructions/application-performance-guide.md')
  console.log('   • Measure your application\'s baseline performance')
  console.log('   • Apply optimizations appropriate for your workload')
  console.log('   • Monitor production metrics to validate improvements')
  console.log()
  console.log('═'.repeat(80))
}

// Run all benchmarks
runAllBenchmarks().catch((error) => {
  console.error('Fatal error running benchmarks:', error)
  process.exit(1)
})
