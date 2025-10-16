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
- Already highly optimized

### Optimization Opportunities

**1. Route Compilation Caching**
```typescript
// Consider caching compiled RegExp patterns
// Location: src/router/reg-exp-router/router.ts

// Instead of recompiling on each lookup:
const pattern = new RegExp(routePattern);

// Cache compiled patterns:
const patternCache = new Map<string, RegExp>();
const getPattern = (route: string) => {
  if (!patternCache.has(route)) {
    patternCache.set(route, new RegExp(route));
  }
  return patternCache.get(route)!;
};
```

**2. Trie Node Structure Optimization**
```typescript
// Location: src/router/trie-router/node.ts
// Consider memory layout and cache locality

// Current: Object with multiple properties
class TrieNode {
  children: Map<string, TrieNode>
  handlers: Handler[]
  // ... other properties
}

// Potential: Flat array for better cache locality
// Trade-off: Complexity vs speed
```

**3. Fast Path for Common Cases**
```typescript
// Add fast path for exact matches (no params)
// Before full pattern matching

if (exactMatchCache.has(path)) {
  return exactMatchCache.get(path);
}
// Fall back to pattern matching
```

### Measurement Strategy
```bash
# Quick iteration
cd benchmarks/routers
bun run benchmark.ts  # Compare implementations

# Validate with HTTP benchmark
cd ../http-server
bun run benchmark.ts  # Real request performance
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
  }
}
```

### Optimization Opportunities

**1. Reduce Function Call Overhead**
```typescript
// Instead of multiple function calls:
await middleware1(c, next)
await middleware2(c, next)
await middleware3(c, next)

// Consider inlining for short middleware chains:
if (middlewareCount <= 3) {
  // Inline execution
} else {
  // Use composition
}
```

**2. Middleware Chain Compilation**
```typescript
// For static middleware chains (known at startup),
// compile into a single function

// Instead of:
const chain = [mw1, mw2, mw3];
for (const mw of chain) await mw(c, next);

// Compile to:
const compiled = async (c) => {
  await mw1(c, async () => {
    await mw2(c, async () => {
      await mw3(c, next)
    })
  })
}
```

**3. Avoid Unnecessary Async**
```typescript
// If middleware is synchronous, avoid async overhead
const isSyncMiddleware = (mw: Middleware) => {
  // Detect if middleware is sync
  return !mw.constructor.name.includes('Async');
}

// Separate sync and async execution paths
```

### Measurement Strategy
```bash
# Create focused middleware benchmark
cat > /tmp/gh-aw/agent/middleware-bench.ts << 'EOF'
import { Hono } from '../src/hono';

const app = new Hono();
const middleware = (c, next) => next();

// Add multiple middleware
for (let i = 0; i < 10; i++) {
  app.use(middleware);
}

app.get('/', (c) => c.text('ok'));

// Benchmark request handling
const iterations = 100_000;
const start = performance.now();
// ... run requests
const end = performance.now();
console.log(`${iterations / ((end - start) / 1000)} req/s`);
EOF

bun run /tmp/gh-aw/agent/middleware-bench.ts
```

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
