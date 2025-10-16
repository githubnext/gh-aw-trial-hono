# Memory Performance Guide for Hono

This guide covers memory optimization strategies for Hono applications, including allocation reduction, garbage collection management, and memory profiling techniques.

## Overview

Memory performance matters for:
- **Throughput** - Less allocation = less GC pressure = higher request throughput
- **Latency** - GC pauses affect P99 latency in high-traffic applications
- **Resource efficiency** - Lower memory footprint enables more concurrent requests
- **Cold start time** - Serverless/edge environments benefit from minimal allocation

## Quick Start: Memory Profiling

```bash
cd benchmarks/memory
bun --expose-gc memory-profile.ts
```

This measures per-request heap allocation across common scenarios. Use results to:
1. Identify high-allocation patterns in your code
2. Validate that optimizations reduce allocation
3. Track memory efficiency over time

## Memory Optimization Principles

### 1. Reduce Allocations on Hot Paths

**Hot paths** are code that executes for every request:
- Context creation
- Request/Response handling
- Middleware execution
- Response formatting

**Strategies:**
- Object pooling for frequently created objects
- Reuse buffers instead of creating new ones
- Lazy initialization of rarely-used properties
- Fast paths that skip unnecessary object creation

**Example - Context Fast Path (already implemented):**
```typescript
// Fast path for simple JSON responses - skips header object allocation
json: JSONRespond = (object, arg?, headers?) => {
  const body = JSON.stringify(object)
  return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized
    ? (Response.json(object) as any)  // ← Fast path, minimal allocation
    : (this.#newResponse(body, arg, setDefaultContentType('application/json', headers)) as any)
}
```

### 2. Avoid String Concatenation in Loops

String concatenation creates intermediate string objects.

**❌ Bad:**
```typescript
let result = ''
for (const item of items) {
  result += `${item.name}: ${item.value};`  // Creates new string each iteration
}
```

**✅ Good:**
```typescript
const parts: string[] = []
for (const item of items) {
  parts.push(`${item.name}: ${item.value}`)
}
const result = parts.join(';')  // Single final allocation
```

**Example in Hono (JSX style rendering, PR #10):**
```typescript
// Before: String concatenation
let styleStr = ''
styleObjectForEach(v, (property, value) => {
  if (value != null) {
    styleStr += `${styleStr ? ';' : ''}${property}:${value}`  // Multiple allocations
  }
})

// After: Array + join
const styleParts: string[] = []
styleObjectForEach(v, (property, value) => {
  if (value != null) {
    styleParts.push(`${property}:${value}`)
  }
})
const styleStr = styleParts.join(';')  // Single allocation
```

### 3. Cache Computed Values

Avoid repeatedly computing the same value.

**Example - Variable getter caching (PR #7):**
```typescript
// Before: Recompute on every access
get var() {
  if (!this.#var) return {} as any
  return Object.fromEntries(this.#var)  // New object every time
}

// After: Cache the result
#varCache: Record<string, unknown> | undefined

get var() {
  if (!this.#var) return {} as any
  if (!this.#varCache) {
    this.#varCache = Object.fromEntries(this.#var)  // Compute once
  }
  return this.#varCache  // Reuse cached value
}

set(key, value) {
  this.#var ??= new Map()
  this.#var.set(key, value)
  this.#varCache = undefined  // Invalidate cache on mutation
}
```

### 4. Use Appropriate Data Structures

Choose data structures based on access patterns:
- **Set** for O(1) membership testing (vs Array.includes O(n))
- **Map** for O(1) key-value lookup (vs Object for dynamic keys)
- **WeakMap** for object-keyed data without preventing GC
- **Array** for sequential access and iteration

**Example - Boolean attribute lookup (PR #10):**
```typescript
// Before: Linear search
export const booleanAttributes = ['allowfullscreen', 'async', ...]
if (typeof v === 'boolean' && booleanAttributes.includes(key))  // O(n) lookup

// After: Constant time lookup
const booleanAttributesSet = new Set(booleanAttributes)
if (typeof v === 'boolean' && booleanAttributesSet.has(key))  // O(1) lookup
```

### 5. Lazy Initialization

Defer creation of objects until actually needed.

**Example - HonoRequest (already implemented):**
```typescript
class Context {
  #req: HonoRequest | undefined

  // Lazy: Only create HonoRequest when accessed
  get req(): HonoRequest {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult)
    return this.#req
  }
}
```

**Benefits:**
- Requests that don't access `c.req` avoid allocation
- Reduces baseline memory usage
- Faster for simple middleware that passes through

## Measurement and Validation

### Memory Profiling Workflow

1. **Establish baseline:**
   ```bash
   git checkout main
   cd benchmarks/memory
   bun --expose-gc memory-profile.ts > baseline.txt
   ```

2. **Implement optimization:**
   Make your changes to reduce allocations

3. **Measure impact:**
   ```bash
   git checkout feature-branch
   cd benchmarks/memory
   bun --expose-gc memory-profile.ts > optimized.txt
   ```

4. **Compare results:**
   ```bash
   diff baseline.txt optimized.txt
   # Look for reduced "Heap/Request" values
   ```

### Interpreting Memory Profile Results

```
| Scenario              | Throughput    | Heap/Request | Total Heap Growth |
|-----------------------|---------------|--------------|-------------------|
| JSON response         | 217,714 req/s | 5.17 B       | 50.53 KB          |
| Simple text response  | 177,683 req/s | 27.76 B      | 271.14 KB         |
```

**What to look for:**
- **Heap/Request < 10 B** - Excellent efficiency
- **Heap/Request 10-20 B** - Good efficiency
- **Heap/Request > 20 B** - Potential optimization target

**Note:** Absolute values vary by runtime and GC timing. Focus on:
- Relative comparisons between scenarios
- Before/after optimization deltas
- Consistent patterns across multiple runs

### Validation Checklist

Before claiming memory improvements:
- ✅ Run memory profile 3+ times for consistency
- ✅ Test with realistic request patterns, not just synthetic benchmarks
- ✅ Verify throughput hasn't regressed
- ✅ Confirm all tests still pass
- ✅ Check that optimization doesn't increase code complexity significantly

## Common Memory Anti-Patterns

### ❌ Creating Objects in Loops

```typescript
// Bad: Creates N objects
for (const item of items) {
  const obj = { name: item.name, value: item.value }
  process(obj)
}

// Better: Reuse object or avoid if possible
const obj = { name: '', value: '' }
for (const item of items) {
  obj.name = item.name
  obj.value = item.value
  process(obj)
}

// Best: Process directly without intermediate object
for (const item of items) {
  processDirectly(item.name, item.value)
}
```

### ❌ Unnecessary Object Spreading

```typescript
// Bad: Creates new object
return { ...headers, 'Content-Type': 'application/json' }

// Better: Mutate if object is temporary
headers['Content-Type'] = 'application/json'
return headers
```

### ❌ Array Allocation for Fixed Size

```typescript
// Bad: Array may reallocate as it grows
const items = []
for (let i = 0; i < 1000; i++) {
  items.push(i)
}

// Better: Pre-allocate if size known
const items = new Array(1000)
for (let i = 0; i < 1000; i++) {
  items[i] = i
}
```

### ❌ Forgetting to Reuse Runtime APIs

```typescript
// Bad: Re-parse URL on every call
function getQueryParam(req: Request, key: string) {
  const url = new URL(req.url)  // Expensive parsing
  return url.searchParams.get(key)
}

// Good: Parse once, cache result
class HonoRequest {
  #url: URL | undefined

  get url(): URL {
    this.#url ??= new URL(this.#rawRequest.url)
    return this.#url
  }

  query(key: string) {
    return this.url.searchParams.get(key)
  }
}
```

## Advanced Techniques

### Object Pooling

For high-frequency object creation, maintain a pool of reusable objects.

**When to use:**
- Object creation is measurably expensive (profile first!)
- Object lifetime is short and well-defined
- Application can handle stateful object reuse

**Trade-offs:**
- Adds complexity
- Must ensure proper reset between uses
- May not benefit from modern GC optimizations for short-lived objects

**Example pattern:**
```typescript
class ObjectPool<T> {
  private available: T[] = []

  constructor(private create: () => T, private reset: (obj: T) => void, size: number) {
    for (let i = 0; i < size; i++) {
      this.available.push(create())
    }
  }

  acquire(): T {
    return this.available.pop() ?? this.create()
  }

  release(obj: T): void {
    this.reset(obj)
    this.available.push(obj)
  }
}

// Usage
const bufferPool = new ObjectPool(
  () => new Uint8Array(4096),
  (buf) => buf.fill(0),
  10
)
```

**Note:** Modern JavaScript engines optimize short-lived allocations heavily. Always profile before adding pooling complexity.

### WeakMap for Object-Keyed Caches

Use WeakMap when caching data keyed by objects to avoid memory leaks.

**Example:**
```typescript
// Bad: Prevents garbage collection of request objects
const cache = new Map<Request, CachedData>()
app.use('*', async (c, next) => {
  cache.set(c.req.raw, computeExpensiveData(c))  // Leaks memory!
  await next()
})

// Good: Allows GC of request objects
const cache = new WeakMap<Request, CachedData>()
app.use('*', async (c, next) => {
  cache.set(c.req.raw, computeExpensiveData(c))  // Cleaned up with request
  await next()
})
```

### Streaming for Large Responses

Use streaming instead of buffering large responses.

```typescript
// Bad: Buffers entire response in memory
app.get('/large', (c) => {
  const data = generateHugeDataset()  // All in memory at once
  return c.json(data)
})

// Good: Stream response incrementally
import { stream } from 'hono/streaming'

app.get('/large', (c) => {
  return stream(c, async (stream) => {
    for await (const chunk of generateDatasetChunks()) {
      await stream.write(JSON.stringify(chunk))
    }
  })
})
```

## Runtime-Specific Considerations

### Bun

- Excellent allocation performance for short-lived objects
- JavaScriptCore GC is optimized for request/response patterns
- Use `--expose-gc` flag for profiling

### Node.js

- V8 GC has generational collection (young/old generation)
- Short-lived allocations (per-request) are cheap
- Watch for old generation growth (memory leaks)

### Deno

- Uses V8 like Node.js
- Strong focus on Web Standards API performance
- Response/Request objects are highly optimized

### Cloudflare Workers

- Extremely memory-constrained (128MB default)
- **Critical:** Minimize per-request allocation
- No long-lived state between requests
- Focus on computational efficiency over caching

## Debugging Memory Issues

### Identifying Memory Leaks

**Symptoms:**
- Memory usage grows over time without bound
- GC runs more frequently but doesn't recover memory
- Application becomes slower over time

**Tools:**
```bash
# Bun
bun --expose-gc --heap-snapshot app.ts

# Node.js
node --inspect --expose-gc app.js
# Then use Chrome DevTools for heap snapshots

# Deno
deno run --inspect --v8-flags=--expose-gc app.ts
```

**Common causes in web servers:**
- Global caches without size limits
- Event listeners not cleaned up
- Closures capturing unnecessary context
- Holding references to request/response objects

### Profiling Real Applications

```typescript
// Add memory tracking to your app
app.use('*', async (c, next) => {
  if (process.memoryUsage) {
    const before = process.memoryUsage().heapUsed
    await next()
    const after = process.memoryUsage().heapUsed
    const growth = after - before

    if (growth > 100_000) {  // > 100KB per request is suspicious
      console.warn(`High allocation on ${c.req.path}: ${growth} bytes`)
    }
  } else {
    await next()
  }
})
```

## Performance Budgets

Suggested per-request allocation targets:

| Application Type      | Target (bytes/request) | Notes |
|-----------------------|------------------------|-------|
| Edge/serverless       | < 5 KB                 | Extremely memory-constrained |
| Static API            | < 10 KB                | Simple JSON responses |
| Application API       | < 50 KB                | With middleware, auth, DB |
| Complex SSR           | < 200 KB               | JSX rendering, data fetching |

**Exceeding budgets doesn't mean slow code**, but may indicate:
- Optimization opportunities
- Architectural review needed
- GC tuning required for high traffic

## Related Resources

- **Memory profiling benchmark:** `benchmarks/memory/`
- **Runtime performance guide:** `runtime-performance.md`
- **JSX performance guide:** `jsx-performance.md`
- **Performance measurement guide:** `performance-measurement.md`

## Summary

Key takeaways for memory-efficient Hono applications:

1. **Profile before optimizing** - Use `benchmarks/memory/` to identify hotspots
2. **Reduce hot path allocations** - Context, middleware, response formatting
3. **Cache computed values** - Avoid redundant work
4. **Choose right data structures** - Set/Map for lookups, Array for iteration
5. **Lazy initialization** - Defer expensive object creation
6. **Avoid string concatenation in loops** - Use Array + join pattern
7. **Validate improvements** - Measure before/after with memory profiler

**Remember:** Modern JavaScript engines are highly optimized. Focus on:
- Measurable improvements (profile first!)
- Maintainable code (don't sacrifice readability)
- Real-world impact (synthetic benchmarks ≠ production)

When in doubt, prioritize:
1. **Correctness** - Code must work correctly
2. **Clarity** - Code should be maintainable
3. **Performance** - Optimize with data, not hunches
