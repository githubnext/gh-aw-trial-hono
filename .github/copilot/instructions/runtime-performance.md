# Runtime Performance Optimization Guide for Hono

This guide covers optimizations for Hono's runtime performance - the hot path that executes on every request.

## Critical Performance Paths

Every HTTP request in Hono follows this path:
1. **Router lookup**: Match URL to handler
2. **Middleware execution**: Run middleware chain
3. **Context creation/access**: Request context management
4. **Handler execution**: User code
5. **Response generation**: Build HTTP response

Optimizations to any of these steps directly impact throughput and latency.

## Router Performance

### Current State
- Multiple router implementations: RegExpRouter (default), TrieRouter, SmartRouter, LinearRouter, PatternRouter
- RegExpRouter is highlighted as "really fast" - no linear loops
- Already highly optimized with wildcard RegExp caching
- Static path fast path already implemented in matcher

### Investigation Results (Oct 2025)

**Router Initialization Performance:**
Investigated optimizing `findMiddleware()` function which sorts middleware keys on each call during route registration.

**Attempted optimization**: Cache sorted middleware keys to avoid repeated O(n log n) sorting.

**Result**: No measurable improvement for typical workloads:
- Most applications have 0-5 wildcard middleware patterns
- Sorting overhead is negligible for small n (microseconds)
- Cache management overhead offsets potential gains
- Current implementation is already optimal for common case

**Benchmark data** (100 iterations, 5 middleware + 200 routes):
- Baseline: 2.09ms per app initialization
- With caching: 2.16ms (slightly worse due to Map allocation overhead)

**Conclusion**: Router initialization in RegExpRouter is already well-optimized. The current implementation strikes the right balance between simplicity and performance for typical workloads.

### Real Optimization Opportunities

**1. Route Compilation Caching (Already Implemented)**
```typescript
// Location: src/router/reg-exp-router/router.ts:19-28
// Wildcard RegExp patterns are cached in wildcardRegExpCache
let wildcardRegExpCache: Record<string, RegExp> = Object.create(null)
function buildWildcardRegExp(path: string): RegExp {
  return (wildcardRegExpCache[path] ??= new RegExp(/* ... */))
}
```
✅ Already optimized - no action needed.

**2. Static Path Fast Path (Already Implemented)**
```typescript
// Location: src/router/reg-exp-router/matcher.ts:17-20
const staticMatch = matcher[2][path]
if (staticMatch) {
  return staticMatch  // O(1) lookup, bypasses regex matching
}
```
✅ Already optimized - no action needed.

**3. Potential Future Optimizations**
- **HTTP Method-specific routing**: Pre-filter routes by HTTP method before matching
- **Trie node structure**: Investigate cache-friendly memory layouts (complex trade-off)
- **JIT compilation**: For apps with 1000s of routes, consider generating specialized matching code

### When to Optimize Router

Only consider router optimization if:
1. Profiling shows router matching is >10% of request time
2. Application has 100+ routes with complex patterns
3. Measurable P99 latency impact on production traffic

For most applications, router performance is NOT the bottleneck.

### Measurement Strategy
```bash
# Router lookup benchmark (comparing implementations)
cd benchmarks/routers
bun install
bun run src/bench.mts

# Real HTTP request performance
cd ../http-server
bun run benchmark.ts

# Custom micro-benchmark for specific patterns
cat > /tmp/router-bench.ts << 'EOF'
import { Hono } from './src/hono'

const app = new Hono()
// Add your routes
app.get('/api/:id', (c) => c.text('ok'))

const iterations = 100_000
const start = performance.now()
for (let i = 0; i < iterations; i++) {
  await app.request('/api/123')
}
const end = performance.now()
console.log(`${iterations / ((end - start) / 1000)} req/s`)
EOF
bun run /tmp/router-bench.ts
```

## Middleware Composition Performance

### Location
- `src/compose.ts` - Middleware composition
- `src/hono-base.ts` - Middleware execution

### Current Implementation
```typescript
// Middleware chain is composed and executed sequentially
const compose = (middleware: Middleware[]) => {
  return (context: Context, next: Next) => {
    // Executes middleware[0], then middleware[1], etc.
    // Uses recursive dispatch pattern
  }
}
```

### Existing Optimizations
- **Single middleware fast path** (`src/hono-base.ts:416-434`): Skips composition entirely when only one handler exists
- **Recursive dispatch**: Efficient pattern borrowed from koa-compose
- **Per-request index tracking**: Ensures `next()` called once per middleware

### Investigation Results (Oct 2025)

**Benchmark measurements** (50k iterations, Bun 1.2.19):
- No middleware: 336,207 req/s (baseline)
- 1 middleware: 213,120 req/s (37% overhead)
- 3 middleware: 199,157 req/s (41% overhead)
- 5 middleware: 198,456 req/s (41% overhead)
- 10 middleware: 142,462 req/s (58% overhead)

**Key finding**: Single middleware has highest overhead due to context creation. Additional middleware (2-5) have minimal incremental cost.

**Attempted optimization**: Unrolling recursion for 2-4 middleware chains
- **Result**: Failed - index state shared between requests causes corruption
- **Lesson**: The recursive dispatch closure pattern is essential for correct per-request state isolation

### Optimization Challenges

**1. State Isolation Requirements**
```typescript
// The index variable MUST be per-request:
return (context, next) => {
  let index = -1  // Fresh for each request

  // If index is shared (closure scope issue),
  // concurrent requests corrupt each other
}
```

**2. Async Overhead is Minimal**
The async/await overhead in modern runtimes (V8, JSC) is negligible compared to:
- Context object allocation
- Request/Response processing
- Actual middleware logic

**3. The Real Bottleneck is Context Creation**
Middleware composition overhead is dominated by per-request context creation, not the dispatch mechanism.

### Recommended Optimization Strategy

Instead of optimizing middleware composition, focus on:

1. **Reduce middleware count**: Combine related middleware
2. **Optimize middleware logic**: Make individual middleware faster
3. **Use single-middleware pattern**: When possible, use one handler that does everything
4. **Context pooling**: Reuse context objects (future work, requires careful design)

### Measurement Strategy
```bash
# Micro-benchmark for middleware chains
cat > middleware-bench.ts << 'EOF'
import { Hono } from './src/hono';

const iterations = 50_000
const testMiddleware = async () => {
  const app = new Hono()
  for (let i = 0; i < 3; i++) {
    app.use('*', async (c, next) => await next())
  }
  app.get('/test', (c) => c.text('ok'))

  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    await app.request('/test')
  }
  const end = performance.now()
  console.log(`${iterations / ((end - start) / 1000)} req/s`)
}
await testMiddleware()
EOF

bun run middleware-bench.ts
```

### Conclusion

Middleware composition in Hono is already highly optimized. The recursive dispatch pattern provides correct semantics with minimal overhead. Further optimization requires:
- Careful handling of per-request state isolation
- Understanding that context creation dominates middleware overhead
- Recognizing that modern JS runtimes handle async/await efficiently

**Recommendation**: Deprioritize middleware composition optimization in favor of:
- Context object efficiency (already completed in PR #7)
- Router performance improvements
- Reducing overall middleware count in applications

## URL Path Extraction Performance

### Location
- `src/utils/url.ts` - URL parsing utilities
- Key function: `getPath()` (lines 106-125)

### Current Implementation
```typescript
export const getPath = (request: Request): string => {
  const url = request.url
  const start = url.indexOf('/', url.indexOf(':') + 4)
  let i = start
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i)
    if (charCode === 37) { // '%'
      // Handle percent encoding
      const queryIndex = url.indexOf('?', i)
      const path = url.slice(start, queryIndex === -1 ? undefined : queryIndex)
      return tryDecodeURI(path.includes('%25') ? path.replace(/%25/g, '%2525') : path)
    } else if (charCode === 63) { // '?'
      break
    }
  }
  return url.slice(start, i)
}
```

### Investigation Results (Oct 2025)

**Path extraction is CRITICAL HOT PATH** - called for every single HTTP request.

**Baseline performance** (1M iterations, Bun 1.2.19):
- Simple path (`/api/users`): 18.2M ops/sec (54.8ns/op)
- Path with query (`/api/users?id=123`): 17.2M ops/sec (57.9ns/op)
- Root path (`/`): 22.8M ops/sec (43.8ns/op)
- Long path (`/api/users/123/profile`): 19.9M ops/sec (50.0ns/op)
- Encoded query (`?q=hello%20world`): 26.5M ops/sec (37.6ns/op)

**Attempted optimization**: Replace character-by-character scan with `indexOf` calls for both `%` and `?`.

**Rationale**: Multiple `indexOf` calls could be faster than manual iteration.

**Result**: **Performance regression** across typical workloads:
- Simple path: -2.9% slower (extra `indexOf` overhead)
- Path with query: -4.4% slower
- Root path: +12.0% faster (only case that improved)
- Long path: -16.5% slower (iteration becomes more efficient at scale)
- Encoded query: -68.9% slower (encoding check now happens twice)

**Why the current implementation is optimal:**

1. **Character-by-character scan is highly optimized in V8/JSC**
   - Modern JIT compilers optimize tight loops extremely well
   - Direct charCode access is faster than string search

2. **Single-pass design minimizes work**
   - Current: One scan that checks both `%` and `?` simultaneously
   - Attempted: Multiple `indexOf` passes = redundant work

3. **Fast path for common case (no encoding, no query)**
   - Most URLs are simple: `/api/users`, `/products/123`
   - Current implementation: Scan once, return immediately
   - Attempted optimization: Three `indexOf` calls before returning

4. **Branch prediction friendly**
   - Linear scan with predictable branches
   - CPU can speculatively execute the common path

**Lesson learned**: URL parsing is already micro-optimized. The current implementation represents years of refinement in similar frameworks (Express, Koa, Fastify). Do not attempt to "optimize" without extensive profiling.

### When to Optimize URL Parsing

Only consider URL parsing optimization if:
1. CPU profiling shows `getPath()` consuming >5% of request time
2. Benchmarks demonstrate clear improvement (>10%) across all URL patterns
3. You have a novel algorithm backed by research/data

For 99.9% of applications, URL parsing performance is NOT a bottleneck.

### Measurement Strategy
```bash
# Micro-benchmark path extraction
cat > /tmp/gh-aw/agent/path-bench.ts << 'EOF'
const iterations = 1_000_000
const testUrls = [
  'http://localhost:3000/api/users',
  'http://localhost:3000/api/users?id=123',
  'http://localhost:3000/',
  'http://localhost:3000/api/users/123/profile',
]

for (const urlString of testUrls) {
  const req = new Request(urlString)
  const start = performance.now()

  for (let i = 0; i < iterations; i++) {
    // Your getPath implementation here
  }

  const end = performance.now()
  console.log(`${urlString}: ${(iterations / ((end - start) / 1000)).toFixed(0)} ops/sec`)
}
EOF

bun run /tmp/gh-aw/agent/path-bench.ts
```

### Conclusion

URL path extraction in Hono is already highly optimized for the common case. The character-by-character scan with charCode comparison is faster than alternative approaches (indexOf, regex, split) for typical web application URLs.

**Recommendation**: Do not attempt to optimize `getPath()` without strong profiling evidence showing it as a bottleneck. Focus on higher-impact areas like middleware efficiency, context allocation, or application-level caching.

## Context Object Performance

### Location
- `src/context.ts` - Request context

### Current State
```typescript
class Context {
  req: HonoRequest
  env: Env
  finalized: boolean
  // Many properties and methods
}
```

### Optimization Opportunities

**1. Lazy Initialization**
```typescript
// Don't initialize rarely-used properties upfront
class Context {
  private _parsedBody?: unknown;

  // Lazy getter
  get parsedBody() {
    if (this._parsedBody === undefined) {
      this._parsedBody = parseBody(this.req);
    }
    return this._parsedBody;
  }
}
```

**2. Reduce Object Allocations**
```typescript
// Pool and reuse context objects for simple requests
const contextPool: Context[] = [];

function getContext(): Context {
  return contextPool.pop() ?? new Context();
}

function releaseContext(c: Context) {
  c.reset();  // Clear state
  contextPool.push(c);
}
```

**3. Optimize Frequently-Accessed Properties**
```typescript
// Use direct property access instead of getters for hot paths
// Profile first to identify hot properties

// Before:
get status() { return this._status; }

// After (if proven hot):
status: number;  // Direct property
```

### Measurement Strategy
```bash
# Micro-benchmark context creation
cat > /tmp/gh-aw/agent/context-bench.ts << 'EOF'
import { Context } from '../src/context';

const iterations = 1_000_000;
const start = performance.now();

for (let i = 0; i < iterations; i++) {
  const c = new Context(mockRequest);
  c.status = 200;
  c.text('ok');
}

const end = performance.now();
console.log(`${iterations / ((end - start) / 1000)} ctx/s`);
EOF

bun run /tmp/gh-aw/agent/context-bench.ts
```

## General Performance Principles

### 1. Hot Path Optimization
Focus on code executed on every request:
- Router lookup
- Middleware execution
- Context access (req, res, env)
- Common helpers (c.json(), c.text())

### 2. Allocation Reduction
Minimize object/array allocations in hot paths:
```typescript
// Before: Creates array on every call
function getHeaders() {
  return Object.entries(this.headers);
}

// After: Return iterator, let caller decide
function *getHeaders() {
  for (const key in this.headers) {
    yield [key, this.headers[key]];
  }
}
```

### 3. Branch Prediction
Help CPU predict branches:
```typescript
// Before: Unpredictable branch
if (specialCase || otherCase || rareCase) {
  // ...
}

// After: Check common case first
if (commonCase) {
  // fast path
  return;
}
// Rare cases
if (specialCase) { ... }
```

### 4. Cache Locality
Keep related data together:
```typescript
// Before: Scattered properties
class Router {
  routes: Route[]
  cache: Map<string, Handler>
  stats: Stats
  // Other unrelated data
}

// After: Group hot data
class Router {
  // Hot data first
  cache: Map<string, Handler>
  routes: Route[]

  // Cold data later
  stats: Stats
}
```

## Testing Performance Changes

### 1. Benchmark Before/After
```bash
# Baseline
git checkout main
bun run build
cd benchmarks/http-server && bun run benchmark.ts > /tmp/baseline.txt

# Your changes
git checkout your-branch
bun run build
cd benchmarks/http-server && bun run benchmark.ts > /tmp/optimized.txt

# Compare
diff /tmp/baseline.txt /tmp/optimized.txt
```

### 2. Run Tests
```bash
# Ensure correctness maintained
bun run test
```

### 3. Profile If Needed
```bash
# Use Node.js profiler
node --prof your-benchmark.js
node --prof-process isolate-*.log > profile.txt

# Or Bun's profiler
bun --profile your-benchmark.js
```

## Performance Anti-Patterns to Avoid

1. **Premature optimization**: Profile first
2. **Micro-optimizations with complexity cost**: Keep code readable
3. **Optimizing cold paths**: Focus on hot paths
4. **Breaking API for minor gains**: Maintain compatibility
5. **Ignoring trade-offs**: Document memory/complexity costs

## Validation Checklist

Before submitting a runtime performance PR:

- [ ] Baseline measurements recorded
- [ ] Performance improvement validated (>5% meaningful)
- [ ] All tests pass (`bun run test`)
- [ ] No new linting errors (`bun run lint`)
- [ ] Code formatted (`bun run format`)
- [ ] Multiple benchmark runs (statistical confidence)
- [ ] Trade-offs documented
- [ ] Reproduction steps provided

## Next Steps

- See `performance-measurement.md` for measurement strategies
- See `build-performance.md` for development workflow optimization
- See `jsx-performance.md` for JSX-specific optimizations
