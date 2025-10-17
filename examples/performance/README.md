# Application-Level Performance Optimization Examples

This directory contains working examples demonstrating performance optimization techniques for Hono applications. Each example includes before/after implementations and benchmarks to measure the impact.

## Examples

### 1. Response Caching (`01-caching/`)

Demonstrates in-memory caching strategies for API responses.

- **Before:** No caching, expensive operations on every request
- **After:** In-memory cache with TTL, LRU eviction
- **Impact:** 100-400x improvement for cached requests
- **Run:** `bun run examples/performance/01-caching/benchmark.ts`

### 2. Database Optimization (`02-database/`)

Shows database performance best practices including connection pooling, query optimization, and N+1 problem solutions.

- **Before:** New connection per request, N+1 queries, inefficient queries
- **After:** Connection pooling, optimized queries, batch loading
- **Impact:** 10-50x improvement for database-heavy workloads
- **Run:** `bun run examples/performance/02-database/benchmark.ts`

### 3. Middleware Organization (`03-middleware/`)

Illustrates middleware ordering and consolidation strategies.

- **Before:** Expensive middleware on all routes, multiple separate middleware
- **After:** Selective middleware application, combined middleware
- **Impact:** 2-10x improvement for routes with reduced middleware
- **Run:** `bun run examples/performance/03-middleware/benchmark.ts`

### 4. Streaming Responses (`04-streaming/`)

Demonstrates streaming for large responses to reduce memory usage.

- **Before:** Buffer entire response in memory
- **After:** Stream response incrementally
- **Impact:** 10x better memory efficiency, better perceived performance
- **Run:** `bun run examples/performance/04-streaming/benchmark.ts`

### 5. Complete API Example (`05-complete-api/`)

Real-world API example combining multiple optimization techniques.

- **Includes:** Caching, database optimization, middleware organization, streaming
- **Metrics:** Before/after comparison with realistic workload
- **Run:** `bun run examples/performance/05-complete-api/benchmark.ts`

## Running Benchmarks

### Run All Benchmarks

```bash
bun run examples/performance/run-all-benchmarks.ts
```

### Run Individual Example

```bash
cd examples/performance/01-caching
bun run benchmark.ts
```

## Performance Measurement

Each example includes:

1. **Before implementation:** Baseline performance
2. **After implementation:** Optimized version
3. **Benchmark script:** Measures requests/second, latency, memory usage
4. **Results output:** Clear before/after comparison with percentage improvements

## Key Takeaways

1. **Caching:** Provides the largest improvements (100-1000x) for cacheable content
2. **Database optimization:** Critical for query-heavy applications (10-50x)
3. **Streaming:** Essential for large responses (10x memory efficiency)
4. **Middleware organization:** Small but cumulative gains (2-10x)
5. **Combined approach:** Real applications benefit from multiple techniques together

## Prerequisites

These examples use:

- **Bun runtime:** Fast JavaScript runtime with built-in SQLite
- **Hono framework:** Already installed in the repository
- **No external dependencies:** Examples are self-contained

## Related Documentation

- [Application Performance Guide](../../.github/copilot/instructions/application-performance-guide.md) - Detailed optimization strategies
- [Performance Measurement](../../.github/copilot/instructions/performance-measurement.md) - How to measure performance
- [Memory Performance](../../.github/copilot/instructions/memory-performance.md) - Memory optimization patterns

## Contributing

When adding new examples:

1. Follow the existing structure (before/after/benchmark)
2. Include clear performance measurements
3. Document the optimization technique
4. Keep examples simple and focused on one optimization
5. Ensure examples run successfully with `bun run`

## License

These examples are part of the Hono project and follow the same MIT license.
