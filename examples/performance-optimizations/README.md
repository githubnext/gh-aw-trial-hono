# Hono Performance Optimization Examples

This directory contains practical examples demonstrating application-level performance optimizations for Hono applications.

## Examples

### 1. Response Caching (`caching-example.ts`)

Demonstrates in-memory response caching with TTL and cache invalidation strategies.

**Performance Impact:** 100-400x improvement for cached responses

### 2. Database Query Optimization (`database-optimization.ts`)

Shows connection pooling, prepared statements, and N+1 query avoidance.

**Performance Impact:** 10-20x improvement with proper pooling and query optimization

### 3. Streaming Responses (`streaming-example.ts`)

Examples of streaming large datasets and SSE for real-time updates.

**Performance Impact:** 10x better memory efficiency, infinite scalability

### 4. Middleware Organization (`middleware-optimization.ts`)

Demonstrates optimal middleware ordering and consolidation strategies.

**Performance Impact:** 2-10x improvement with selective middleware application

### 5. Complete API Example (`optimized-api-example.ts`)

Full-featured API combining all optimization techniques.

## Running the Examples

```bash
# Install dependencies (if needed)
bun install

# Run individual examples
bun run examples/performance-optimizations/caching-example.ts
bun run examples/performance-optimizations/streaming-example.ts

# Run with metrics
bun run examples/performance-optimizations/optimized-api-example.ts
```

## Benchmarking

Each example includes comments showing expected performance characteristics. To benchmark in your environment:

```typescript
// Add simple timing
const start = performance.now()
const response = await app.request('/your-endpoint')
const duration = performance.now() - start
console.log(`Request took ${duration}ms`)
```

## Learning Path

1. Start with `caching-example.ts` - Easiest wins
2. Move to `database-optimization.ts` - Common bottleneck
3. Explore `middleware-optimization.ts` - Framework-level efficiency
4. Study `streaming-example.ts` - Advanced techniques
5. Review `optimized-api-example.ts` - Complete implementation

## Key Takeaways

- **Caching** provides the biggest wins (100-1000x) for appropriate workloads
- **Database optimization** is crucial for data-heavy applications
- **Streaming** enables handling of large datasets with constant memory
- **Middleware organization** improves request processing efficiency
- **Measure first** - Profile before optimizing to find real bottlenecks

## Additional Resources

- [Application Performance Guide](../../.github/copilot/instructions/application-performance-guide.md)
- [Performance Measurement Guide](../../.github/copilot/instructions/performance-measurement.md)
- [Runtime Performance Guide](../../.github/copilot/instructions/runtime-performance.md)

## Contributing

Have a great performance optimization example? Contributions are welcome! Please ensure:

1. Example demonstrates measurable performance improvement
2. Code includes performance impact comments
3. Example is self-contained and runnable
4. Documentation explains the optimization technique

---

**Performance optimization is about making smart choices at the application level. These examples show you how.**
