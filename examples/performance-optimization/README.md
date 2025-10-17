# Hono Performance Optimization Examples

This directory contains practical, runnable examples demonstrating application-level performance optimizations for Hono applications.

## Examples Overview

Each example includes:
- **Before:** Anti-pattern showing common performance issues
- **After:** Optimized version with measurements
- **Benchmark:** Script to measure the improvement

## Available Examples

### 1. Response Caching (`caching-example.ts`)
Demonstrates in-memory caching for expensive operations.
- **Pattern:** Simple cache with TTL
- **Impact:** 100-400x improvement for cached requests
- **Use case:** Static config, infrequently changing data

### 2. Database Connection Pooling (`database-pooling-example.ts`)
Shows proper connection pool usage vs creating new connections.
- **Pattern:** Reuse database connections
- **Impact:** 10-20x improvement
- **Use case:** Any database-backed API

### 3. N+1 Query Resolution (`n-plus-one-example.ts`)
Fixes the classic N+1 query problem with JOIN optimization.
- **Pattern:** Single query with JOIN vs multiple queries
- **Impact:** 5-10x improvement
- **Use case:** Fetching related data

###4. Middleware Optimization (`middleware-ordering-example.ts`)
Demonstrates optimal middleware ordering and consolidation.
- **Pattern:** Fast paths first, selective middleware
- **Impact:** 50-70ms saved for unauthenticated routes
- **Use case:** Mixed public/protected APIs

### 5. Streaming Large Responses (`streaming-example.ts`)
Compares buffered vs streamed responses for large datasets.
- **Pattern:** Stream vs buffer-in-memory
- **Impact:** 10x better memory efficiency
- **Use case:** Large JSON exports, file downloads

### 6. ETag Conditional Requests (`etag-example.ts`)
Shows bandwidth savings with proper ETag implementation.
- **Pattern:** 304 Not Modified responses
- **Impact:** 2-10x bandwidth reduction
- **Use case:** APIs with infrequent data changes

## Running the Examples

### Prerequisites

```bash
# Install dependencies
bun install

# Ensure Hono is built
bun run build
```

### Run Individual Examples

```bash
# Run example with benchmark
bun run examples/performance-optimization/caching-example.ts

# Run with detailed timing
bun run examples/performance-optimization/database-pooling-example.ts
```

### Run All Benchmarks

```bash
# Compare all optimizations
bun run examples/performance-optimization/run-all-benchmarks.ts
```

## Example Structure

Each example follows this structure:

```typescript
// 1. Imports and setup
import { Hono } from 'hono'

// 2. BEFORE: Anti-pattern implementation
const appBefore = new Hono()
// ... inefficient code

// 3. AFTER: Optimized implementation
const appAfter = new Hono()
// ... optimized code

// 4. Benchmark comparing both
async function benchmark() {
  // Measure and compare performance
}

benchmark()
```

## Key Takeaways

1. **Measure First**: Always benchmark before and after optimizations
2. **Real Workloads**: Test with realistic data volumes and patterns
3. **Trade-offs**: Understand complexity vs performance gains
4. **Context Matters**: Choose optimizations appropriate for your use case

## Performance Comparison Summary

| Example | Before | After | Improvement | Complexity |
|---------|--------|-------|-------------|------------|
| Caching | 50-200ms | 0.5-2ms | 100-400x | Low |
| Connection Pooling | 50-100ms | 2-10ms | 10-20x | Low |
| N+1 Resolution | 110-220ms | 10-20ms | 10x | Medium |
| Middleware Ordering | 70ms | 0ms | Eliminates overhead | Low |
| Streaming | 10MB memory | 1MB memory | 10x | Medium |
| ETags | Full response | 304 (minimal) | 5-10x bandwidth | Low |

## Best Practices Demonstrated

- ✅ Connection pooling over new connections
- ✅ Caching with appropriate TTLs
- ✅ JOIN queries over N+1 patterns
- ✅ Selective middleware application
- ✅ Streaming large responses
- ✅ Conditional requests with ETags
- ✅ Early returns in middleware
- ✅ Resource cleanup in finally blocks

## Related Documentation

- [Application Performance Guide](../../.github/copilot/instructions/application-performance-guide.md) - Detailed strategies
- [Performance Measurement Guide](../../.github/copilot/instructions/performance-measurement.md) - How to measure
- [Runtime Performance Guide](../../.github/copilot/instructions/runtime-performance.md) - Framework-level optimizations

## Contributing

When adding new examples:

1. Follow the before/after structure
2. Include realistic benchmarks
3. Document the performance impact
4. Explain trade-offs
5. Keep examples focused and simple

---

💡 **Tip**: Start with caching and database optimization - they provide the biggest wins with the least complexity.
