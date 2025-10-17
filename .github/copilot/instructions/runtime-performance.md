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
  return staticMatch // O(1) lookup, bypasses regex matching
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
  let index = -1 // Fresh for each request

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
    if (charCode === 37) {
      // '%'
      // Handle percent encoding
      const queryIndex = url.indexOf('?', i)
      const path = url.slice(start, queryIndex === -1 ? undefined : queryIndex)
      return tryDecodeURI(path.includes('%25') ? path.replace(/%25/g, '%2525') : path)
    } else if (charCode === 63) {
      // '?'
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

## Response Header Handling Performance

### Location

- `src/context.ts` - Response creation and header merging
- Key methods: `#newResponse()`, `res` setter

### Current Implementation

**Response creation** (`#newResponse()` at context.ts:600-629):

```typescript
const responseHeaders = this.#res
  ? new Headers(this.#res.headers) // Full copy
  : this.#preparedHeaders ?? new Headers()

// Merge headers from ResponseInit
for (const [key, value] of argHeaders) {
  if (key.toLowerCase() === 'set-cookie') {
    responseHeaders.append(key, value)
  } else {
    responseHeaders.set(key, value)
  }
}
```

**Set-cookie handling** (`res` setter at context.ts:398-418):

```typescript
for (const [k, v] of this.#res.headers.entries()) {
  if (k === 'content-type') continue
  if (k === 'set-cookie') {
    const cookies = this.#res.headers.getSetCookie()
    // Handle multiple cookies...
  } else {
    _res.headers.set(k, v)
  }
}
```

### Investigation Results (Oct 2025)

**Header handling is on the CRITICAL PATH** - executed for most responses.

**Identified optimization opportunities:**

1. **Header copying**: `new Headers(this.#res.headers)` creates full copy on every response
2. **Duplicate toLowerCase()**: Called on every header key in iteration loops
3. **set-cookie detection**: Iterates all headers looking for set-cookie
4. **Cache header parsing**: Middleware re-parses Cache-Control/Vary on every response

**Attempted optimizations:**

1. **Avoid header copy when no additional headers**: Check if headers need merging before copying
2. **Cache toLowerCase results**: Store lowercased key in variable to avoid redundant calls
3. **Pre-check for set-cookie**: Use `headers.has('set-cookie')` before iteration

**Results:** Mixed - some micro-optimizations showed small gains (+1-4%) in specific scenarios, but introduced complexity and showed regressions in other common paths.

**Benchmark data** (50k iterations, Bun 1.2.19):

| Scenario                 | Baseline      | Attempted Optimization | Result   |
| ------------------------ | ------------- | ---------------------- | -------- |
| Simple JSON (fast path)  | 256,728 req/s | 260,863 req/s          | +1.6%    |
| JSON with custom headers | 231,287 req/s | 235,635 req/s          | +1.9%    |
| With prepared headers    | 156,285 req/s | 143,743 req/s          | -8.0% ⚠️ |
| With set-cookie          | 247,732 req/s | 237,563 req/s          | -4.1% ⚠️ |
| Response init headers    | 133,941 req/s | 139,636 req/s          | +4.3%    |
| Complex (mixed)          | 154,344 req/s | 149,875 req/s          | -2.9% ⚠️ |

### Why Header Optimizations Are Challenging

**1. Web Standards API Constraints**

- Headers API is standardized and can't be bypassed
- No access to internal representation
- Copying/iteration costs are inherent to the API

**2. Fast Paths Already Exist**

```typescript
// json() and text() already skip header merging for simple cases:
json(data) {
  return !this.#preparedHeaders && !this.#status && !arg && !headers
    ? Response.json(data)  // Native fast path
    : this.#newResponse(data, arg, headers)
}
```

**3. Trade-offs Are Unfavorable**

- Conditional logic to avoid header copying adds overhead
- Benefits only apply to uncommon "no additional headers" case
- Most responses DO have headers to merge (Content-Type, custom headers, middleware headers)

**4. Modern Runtimes Already Optimize Headers**

- V8/JSC optimize Headers object construction
- Header copying is implemented in native code
- JavaScript-level optimizations add overhead that offsets gains

### Real Optimization Opportunities

**1. Application-Level Response Caching**

```typescript
// Cache complete responses when possible
const responseCache = new Map<string, Response>()

app.get('/api/static', (c) => {
  const cached = responseCache.get('/api/static')
  if (cached) return cached.clone()

  const response = c.json({ data: expensiveComputation() })
  responseCache.set('/api/static', response.clone())
  return response
})
```

**2. Reduce Header Operations**

```typescript
// Before: Multiple header calls
app.use('*', async (c, next) => {
  c.header('X-Powered-By', 'Hono')
  c.header('X-Version', '1.0')
  c.header('X-Request-ID', generateId())
  await next()
})

// After: Single header call with object
app.use('*', async (c, next) => {
  await next()
  // Set headers only on final response
  c.res.headers.set('X-Custom', 'all-at-once')
})
```

**3. Middleware Consolidation**

```typescript
// Before: Separate middleware for headers
app.use('*', securityHeaders())
app.use('*', corsHeaders())
app.use('*', cacheHeaders())

// After: Combined middleware
app.use(
  '*',
  combinedHeaders({
    security: true,
    cors: corsConfig,
    cache: cacheConfig,
  })
)
```

### Measurement Strategy

```bash
# Header operation benchmark
cat > /tmp/gh-aw/agent/header-bench.ts << 'EOF'
import { Hono } from './src/hono'

const iterations = 50_000

async function benchHeaderOperations() {
  const app = new Hono()

  // Test scenario (customize as needed)
  app.use('*', async (c, next) => {
    c.header('X-Custom-1', 'value1')
    c.header('X-Custom-2', 'value2')
    await next()
  })
  app.get('/test', (c) => c.json({ ok: true }))

  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    await app.request('/test')
  }
  const end = performance.now()

  console.log(`${iterations / ((end - start) / 1000)} req/s`)
}

await benchHeaderOperations()
EOF

bun run /tmp/gh-aw/agent/header-bench.ts
```

### Conclusion

Response header handling in Hono is already well-optimized given the constraints of the Web Standards Headers API. The fast paths for simple responses (json/text without headers) provide good performance for common cases.

**Micro-optimizations to header copying/iteration:**

- Add complexity
- Provide inconsistent benefits across workloads
- Often regress performance in common cases

**Recommendation**: Focus on application-level optimizations:

- Response caching
- Reducing header operations
- Middleware consolidation
- Avoiding unnecessary header reads/writes

Only consider framework-level header optimizations if profiling shows header operations consuming >10% of response time, which is rare for typical applications.

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
  private _parsedBody?: unknown

  // Lazy getter
  get parsedBody() {
    if (this._parsedBody === undefined) {
      this._parsedBody = parseBody(this.req)
    }
    return this._parsedBody
  }
}
```

**2. Reduce Object Allocations**

```typescript
// Pool and reuse context objects for simple requests
const contextPool: Context[] = []

function getContext(): Context {
  return contextPool.pop() ?? new Context()
}

function releaseContext(c: Context) {
  c.reset() // Clear state
  contextPool.push(c)
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

## JavaScript Engine Optimization Patterns

### Modern Engine Optimizations (V8, JavaScriptCore, SpiderMonkey)

Modern JavaScript engines perform sophisticated optimizations that can make traditional "performance wisdom" obsolete. Understanding what engines already optimize helps avoid wasted effort.

### 1. Regex Literal Compilation

**Traditional wisdom**: "Move regex to module level to avoid recompilation on every call"

**Reality**: Modern engines optimize regex literals extremely well.

**Investigation Results (Oct 2025)**

Tested optimization of `getMimeType()` in `src/utils/mime.ts`:

```typescript
// Baseline: Regex created on every call
export const getMimeType = (filename: string) => {
  const regexp = /\.([a-zA-Z0-9]+?)$/ // Created each call
  const match = filename.match(regexp)
  // ...
}

// Attempted optimization: Module-level regex
const FILE_EXTENSION_REGEXP = /\.([a-zA-Z0-9]+?)$/
export const getMimeType = (filename: string) => {
  const match = filename.match(FILE_EXTENSION_REGEXP) // Reuse regex
  // ...
}
```

**Benchmark results** (1M iterations, 17 test files, Bun 1.2.19):

- Baseline: 3,410ms (4.98M calls/sec, 200.6ns/call)
- Optimized: 3,392ms (5.01M calls/sec, 199.6ns/call)
- **Improvement: 0.53%** (within measurement noise)

Multiple runs showed high variability (-1.5% to +2%), indicating **NO measurable improvement**.

**Why engines optimize this:**

1. **Regex pattern recognition**: Engines detect constant regex patterns and compile once
2. **Inline caching**: JIT compilers cache compiled regexes at call sites
3. **Escape analysis**: Determines regex doesn't escape function scope
4. **Dead store elimination**: Optimizes away redundant regex allocations

**When regex hoisting DOES help:**

- Dynamic regex construction: `new RegExp(pattern)` where pattern varies
- Complex patterns (100+ characters)
- Regex with flags that aren't literal: `new RegExp(str, flags)`

**Lesson learned**: Don't assume traditional optimizations apply to modern engines. Always measure!

### 2. String Operations

**Engine optimizations:**

- **Rope strings**: Concatenation often doesn't copy until needed
- **Slicing is cheap**: `str.slice()` creates views, not copies (often)
- **Template literals**: Optimized similarly to concatenation

**Example that shows unexpected performance:**

```typescript
// Intuition: Pre-allocating array should be faster
const parts = new Array(100)
for (let i = 0; i < 100; i++) {
  parts[i] = someString(i)
}
const result = parts.join('')

// Reality: Simple concatenation is often comparable or faster
let result = ''
for (let i = 0; i < 100; i++) {
  result += someString(i) // Engines optimize this well
}
```

Modern engines use **rope data structures** that defer actual string copying.

### 3. Object Property Access

**Engine optimizations:**

- **Hidden classes (shapes)**: Objects with same structure share optimized access paths
- **Inline caching**: Property lookups cached at call sites
- **Property access is NOT expensive** (unless polymorphic)

**Anti-pattern:**

```typescript
// Premature optimization - caching property lookups
const cachedLength = arr.length
for (let i = 0; i < cachedLength; i++) {
  // ...
}

// Modern engines already optimize this:
for (let i = 0; i < arr.length; i++) {
  // Property access cached by engine
}
```

**When caching DOES help:**

- Computed properties: `obj[dynamicKey]`
- Properties with side effects (getters)
- Cross-function boundaries

### 4. Loop Optimizations

**Engine capabilities:**

- **Loop unrolling**: Engines unroll small loops automatically
- **Bounds check elimination**: Removes redundant array bounds checks
- **SIMD autovectorization**: Parallel execution of loop iterations (when possible)

**Example:**

```typescript
// Manual unrolling is usually NOT needed
for (let i = 0; i < arr.length; i++) {
  result += arr[i] // Engine may unroll this
}

// Manual unrolling can actually HURT performance:
for (let i = 0; i < arr.length; i += 4) {
  result += arr[i] + arr[i + 1] + arr[i + 2] + arr[i + 3] // Less clear, no benefit
}
```

### 5. Function Inlining

**Engine behavior:**

- Small functions (\u003c100 characters) often inlined automatically
- Hot functions identified by profiler and inlined
- Polymorphic call sites prevent inlining

**Don't manually inline unless:**

- Profiler shows function call overhead is significant
- Function is never inlined (check with `--trace-turbo-inlining` in Node)

### Measurement-Driven Optimization

**Golden rule**: Measure first, optimize second, measure again.

**Process:**

1. **Profile** - Identify actual bottlenecks (not assumed ones)
2. **Baseline** - Record current performance with multiple runs
3. **Optimize** - Make targeted changes
4. **Validate** - Benchmark shows \u003e5% improvement consistently
5. **Document** - Explain why optimization works

**Red flags for ineffective optimizations:**

- Improvement \u003c 2% (likely measurement noise)
- High variance across runs (unstable benchmark)
- Improvement only in synthetic micro-benchmark (not realistic workload)
- Complexity added for negligible gain

### Runtime-Specific Considerations

Different engines have different optimization characteristics:

**Bun (JavaScriptCore)**:

- Aggressive JIT compilation
- Fast startup
- Good regex performance
- Excellent string handling

**Node.js (V8)**:

- Tiered compilation (Ignition → TurboFan)
- Excellent for long-running processes
- Strong optimization after warmup
- Memory-efficient

**Deno (V8)**:

- Similar to Node.js
- TypeScript compilation overhead
- Strong Web API performance

**Cloudflare Workers (V8)**:

- Cold start optimization critical
- Limited execution time (50ms CPU)
- Focus on minimal allocation

**Optimization priority by runtime:**

- **Workers/Edge**: Minimize allocations, reduce code size
- **Long-running (Node/Bun)**: Let JIT optimize, avoid premature optimization
- **All**: Focus on algorithmic improvements over micro-optimizations

### Validation: When NOT to Optimize

Skip optimization if:

- [ ] Performance gain \u003c 5% in realistic benchmark
- [ ] High implementation complexity
- [ ] Requires breaking changes
- [ ] Only improves synthetic micro-benchmark
- [ ] Profiler doesn't show this as bottleneck
- [ ] Maintenance burden \u003e performance gain

**Remember**: Code clarity and maintainability often outweigh minor performance improvements. Optimize when it meaningfully improves user experience.

## Cookie Serialization Performance

### Location

- `src/utils/cookie.ts` - Cookie parsing and serialization utilities
- Key functions: `parse()` (lines 79-112), `_serialize()` (lines 141-222)

### Current Implementation

**Cookie serialization** (`_serialize()` at cookie.ts:141-222):

```typescript
const _serialize = (name: string, value: string, opt: CookieOptions = {}): string => {
  let cookie = `${name}=${value}`

  // Validation checks...

  if (opt.maxAge) {
    cookie += `; Max-Age=${opt.maxAge | 0}`
  }

  if (opt.domain) {
    cookie += `; Domain=${opt.domain}`
  }

  // ... more attribute concatenation

  return cookie
}
```

### Investigation Results (Oct 2025)

**Cookie serialization is frequently used** in web applications for authentication, session management, and user tracking.

**Baseline performance** (100k iterations, Bun 1.2.19):

- Simple cookie: 5.72M ops/sec (174.91 ns/op)
- With path: 6.41M ops/sec (156.05 ns/op)
- With full options: 3.42M ops/sec (292.62 ns/op)

**Attempted optimization**: Replace string concatenation (`cookie +=`) with array building + `join('; ')`.

**Rationale**: Traditional advice suggests array+join is faster than repeated string concatenation.

**Result**: **Significant performance regression** across all scenarios:

- Simple cookie: -12.8% slower (5.72M → 4.99M ops/sec)
- With path: -51.8% slower (6.41M → 3.09M ops/sec)
- With full options: -61.1% slower (3.42M → 1.33M ops/sec)

**Why the current implementation is optimal:**

1. **Modern engines optimize string concatenation**
   - V8/JSC use rope data structures that defer copying
   - String concatenation with `+=` is JIT-optimized
   - Small, incremental concatenations are very fast

2. **Array+join introduces overhead**
   - Array allocation and resizing
   - Function call overhead for `.join()`
   - Temporary string creation during join operation

3. **Cookie strings are typically small**
   - Most cookies: 50-200 characters
   - Concatenation is faster than array management for small strings
   - The crossover point (where array+join wins) is much larger (1000s of characters)

4. **The pattern is predictable**
   - Engines can inline and optimize the simple `cookie += string` pattern
   - Linear execution with predictable branches

**Lesson learned**: String concatenation performance has improved dramatically in modern engines. The old "array+join is faster" wisdom no longer applies for small-to-medium string building. Always benchmark!

### When to Optimize Cookie Operations

Only consider cookie serialization optimization if:

1. CPU profiling shows `_serialize()` consuming >5% of request time
2. Application sets cookies on most/all requests
3. Benchmarks demonstrate clear improvement (>10%) across typical cookie configurations

For 99% of applications, cookie serialization performance is NOT a bottleneck.

### Measurement Strategy

```bash
# Cookie serialization benchmark
cat > /tmp/gh-aw/agent/cookie-bench.ts << 'EOF'
import { serialize } from '../src/utils/cookie'

const iterations = 100_000

const tests = [
  { name: 'simple', value: 'abc123', opts: {} },
  { name: 'with-path', value: 'abc123', opts: { path: '/' } },
  {
    name: 'full',
    value: 'abc123',
    opts: {
      path: '/',
      domain: 'example.com',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax' as const,
      maxAge: 3600
    }
  },
]

for (const { name, value, opts } of tests) {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    serialize('sessionId', value, opts)
  }
  const end = performance.now()
  const opsPerSec = iterations / ((end - start) / 1000)
  console.log(`${name}: ${opsPerSec.toFixed(0)} ops/sec`)
}
EOF

bun run /tmp/gh-aw/agent/cookie-bench.ts
```

### Conclusion

Cookie serialization in Hono is already well-optimized. String concatenation with `+=` is faster than array-based string building for typical cookie sizes and attribute counts.

**Attempted micro-optimizations (array+join, helper functions for case normalization):**

- Add code complexity
- Regress performance significantly (-12% to -61%)
- Contradict modern engine optimization strategies

**Recommendation**: Do not attempt to optimize cookie serialization without strong profiling evidence. Focus on higher-impact areas like:

- Reducing unnecessary cookie operations
- Caching serialized cookies when values don't change
- Using signed cookies only when needed (crypto operations are expensive)
- Application-level optimization (fewer cookies, smaller values)

## HTML Escaping Performance

### Location

- `src/utils/html.ts` - HTML escaping utilities for JSX rendering
- Key function: `escapeToBuffer()` (lines 90-127)

### Current Implementation

**HTML escaping** (`escapeToBuffer()` at html.ts:90-127):

```typescript
const escapeRe = /[&<>'"]/

export const escapeToBuffer = (str: string, buffer: StringBuffer): void => {
  const match = str.search(escapeRe)
  if (match === -1) {
    buffer[0] += str
    return
  }

  let escape
  let index
  let lastIndex = 0

  for (index = match; index < str.length; index++) {
    switch (str.charCodeAt(index)) {
      case 34: // "
        escape = '&quot;'
        break
      case 39: // '
        escape = '&#39;'
        break
      case 38: // &
        escape = '&amp;'
        break
      case 60: // <
        escape = '&lt;'
        break
      case 62: // >
        escape = '&gt;'
        break
      default:
        continue
    }

    buffer[0] += str.substring(lastIndex, index) + escape
    lastIndex = index + 1
  }

  buffer[0] += str.substring(lastIndex, index)
}
```

### Investigation Results (Oct 2025)

**HTML escaping is on HOT PATH** - called for every text node in JSX rendering that needs escaping.

**Baseline performance** (100k iterations, Bun 1.2.19):

- No escaping needed (common): 8.70-9.02M ops/sec
- Single escape char: 4.31-4.47M ops/sec
- Multiple escape chars: 3.50-3.82M ops/sec
- Heavy escaping: 3.26-3.27M ops/sec

**Attempted optimizations:**

1. **Array accumulation + join()**: Replace incremental string concatenation with array building
2. **Lookup object**: Replace `switch` statement with object property lookup

**Results:** Both optimizations showed **significant performance regressions**:

**Array accumulation approach:**

| Scenario | Baseline | Optimized | Result |
| --- | --- | --- | --- |
| No escaping | 9.02M ops/s | 9.01M ops/s | -0.2% |
| Single escape | 4.31M ops/s | 3.53M ops/s | -22.2% ⚠️ |
| Multiple escapes | 3.50M ops/s | 1.71M ops/s | -105.4% ⚠️ |
| Heavy escaping | 3.26M ops/s | 1.92M ops/s | -70.3% ⚠️ |

**Lookup object approach:**

| Scenario | Baseline | Optimized | Result |
| --- | --- | --- | --- |
| No escaping | 8.70M ops/s | 11.16M ops/s | +22.0% ✓ |
| Single escape | 4.47M ops/s | 3.54M ops/s | -26.5% ⚠️ |
| Multiple escapes | 3.82M ops/s | 1.13M ops/s | -237.6% ⚠️ |
| Heavy escaping | 3.27M ops/s | 0.99M ops/s | -230.9% ⚠️ |

### Why Current Implementation Is Optimal

**1. Switch Statement Optimization**

Modern JavaScript engines (V8, JavaScriptCore) optimize `switch` statements into **jump tables**:

- O(1) lookup for dense, sequential case values
- Highly predictable branching
- CPU can execute switch extremely efficiently
- Object property lookup adds hash table overhead

**2. String Concatenation is Fast**

As documented in the Cookie Serialization section:

- Modern engines use rope data structures
- Incremental `+=` concatenation is JIT-optimized
- Small strings (typical for HTML text nodes) favor direct concatenation
- Array allocation and join() overhead exceeds concatenation cost

**3. Fast Path for Common Case**

The implementation checks for escape characters first:

```typescript
const match = str.search(escapeRe)
if (match === -1) {
  buffer[0] += str
  return // No escaping needed - fast exit
}
```

Most text nodes don't need escaping, so this fast path is critical.

**4. Implementation Proven in React**

The comment in html.ts notes this is based on React DOM's escaping implementation:

```typescript
// The `escapeToBuffer` implementation is based on code from the MIT licensed `react-dom` package.
// https://github.com/facebook/react/blob/main/packages/react-dom-bindings/src/server/escapeTextForBrowser.js
```

React's implementation has been battle-tested and micro-optimized over years. Hono correctly adopted their proven approach.

### When to Optimize HTML Escaping

Only consider HTML escaping optimization if:

1. CPU profiling shows `escapeToBuffer()` consuming >5% of SSR time
2. Application renders primarily user-generated content (high escaping frequency)
3. Novel algorithm shows >10% improvement across all scenarios (no regressions)

For 99.9% of applications, HTML escaping performance is NOT a bottleneck.

### Measurement Strategy

```bash
# HTML escaping benchmark
cat > /tmp/gh-aw/agent/html-escape-bench.ts << 'EOF'
import { escapeToBuffer } from '../src/utils/html'

const iterations = 100_000

const testCases = [
  'Hello World! Plain text.',
  'Hello <World>',
  '<div class="container">Hello & "World"</div>',
  'Hono is a small, simple, & ultrafast web framework'
]

for (const input of testCases) {
  const buffer = ['']
  const start = performance.now()

  for (let i = 0; i < iterations; i++) {
    buffer[0] = ''
    escapeToBuffer(input, buffer)
  }

  const end = performance.now()
  const opsPerSec = iterations / ((end - start) / 1000)
  console.log(`"${input}": ${(opsPerSec / 1000000).toFixed(2)}M ops/sec`)
}
EOF

bun run /tmp/gh-aw/agent/html-escape-bench.ts
```

### Conclusion

HTML escaping in Hono is already highly optimized, following proven patterns from React DOM. The current implementation using:

- Regex search for fast path (no escaping needed)
- Switch statement for character mapping (engine-optimized jump table)
- Direct string concatenation (modern engine optimization)

**Attempted micro-optimizations (array+join, lookup objects):**

- Add complexity
- Provide major regressions for escaping scenarios (-22% to -237%)
- Only improve the "no escaping" fast path (which is already fast)

**Recommendation**: Do not attempt to optimize `escapeToBuffer()` without strong profiling evidence showing it as a bottleneck (extremely rare). The implementation is already optimal given:

- Modern engine optimizations
- Proven patterns from React
- Fast path for common case

Focus on higher-impact JSX optimizations like:

- Reducing unnecessary JSX re-renders
- Component memoization
- Streaming optimizations
- Application-level caching

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
  return Object.entries(this.headers)
}

// After: Return iterator, let caller decide
function* getHeaders() {
  for (const key in this.headers) {
    yield [key, this.headers[key]]
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
