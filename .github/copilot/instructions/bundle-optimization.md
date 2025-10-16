# Bundle Size Optimization Guide for Hono

This guide covers strategies for minimizing Hono's bundle size to improve user experience through faster downloads and parsing.

## Current Bundle Size

### Targets
- **`hono/tiny`**: <12kB minified (current goal)
- **Core bundle**: Track trend, prevent regressions
- **Zero dependencies**: Keep it that way

### Measurement Infrastructure
```bash
# Check current bundle size
cd perf-measures/bundle-check
# Run bundle measurement script

# Or use esbuild directly
esbuild src/index.ts --bundle --minify --format=esm --outfile=/tmp/bundle.js
ls -lh /tmp/bundle.js
```

## Bundle Size Optimization Strategies

### 1. Tree-Shaking Optimization

**Ensure clean module structure**:

```typescript
// ✓ Good: Named exports, no side effects
export const router = new RegExpRouter();
export function createContext() { ... }

// ✗ Bad: Side effects prevent tree-shaking
export const router = new RegExpRouter();
router.init();  // Side effect!
```

**Package.json configuration**:
```json
{
  "sideEffects": false  // Declare no side effects
}
```

**Or specify files with side effects**:
```json
{
  "sideEffects": [
    "src/polyfills.ts"  // Only this file has side effects
  ]
}
```

### 2. Analyze Bundle Composition

**Generate metafile**:
```bash
cat > /tmp/gh-aw/agent/analyze-bundle.ts << 'EOF'
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: true,
  format: 'esm',
  metafile: true,
  outfile: '/tmp/bundle.js'
});

// Analyze what's in the bundle
for (const [file, data] of Object.entries(result.metafile.outputs)) {
  console.log('\nOutput:', file);
  console.log('Size:', data.bytes, 'bytes');
  console.log('Inputs:', Object.keys(data.inputs));
}

// Check for unexpected dependencies
const inputs = Object.keys(result.metafile.inputs);
const unexpected = inputs.filter(i =>
  i.includes('node_modules') ||
  i.includes('test')
);

if (unexpected.length > 0) {
  console.log('\n⚠️ Unexpected files in bundle:');
  unexpected.forEach(f => console.log('  -', f));
}
EOF

bun run /tmp/gh-aw/agent/analyze-bundle.ts
```

**Use esbuild analyzer**:
```bash
# Generate and visualize bundle
esbuild src/index.ts --bundle --minify --metafile=meta.json
# Use https://esbuild.github.io/analyze/ to upload meta.json
```

### 3. Code Splitting by Entry Point

**Current structure** (package.json exports):
- Main: `hono` (full)
- Minimal: `hono/tiny` (router only)
- Middleware: Individual exports (`hono/cors`, etc.)

**Optimization**: Ensure no cross-contamination
```typescript
// ✓ Good: Tiny preset doesn't import middleware
// src/preset/tiny.ts
export { Hono } from '../hono-base';
export { RegExpRouter } from '../router/reg-exp-router';

// ✗ Bad: Accidentally importing large modules
import { someUtil } from '../middleware/jwt';  // Don't do this!
```

**Verify with bundle check**:
```bash
# Check tiny preset specifically
esbuild src/preset/tiny.ts --bundle --minify --format=esm --outfile=/tmp/tiny.js
ls -lh /tmp/tiny.js  # Should be <12kB
```

### 4. Minimize Utility Code Duplication

**Problem**: Same utility duplicated across modules

**Solution**: Shared utility module
```typescript
// Before: Duplicated in multiple files
// src/middleware/cors/index.ts
function parseHeaders(headers) { ... }

// src/middleware/cache/index.ts
function parseHeaders(headers) { ... }

// After: Shared utility
// src/utils/headers.ts
export function parseHeaders(headers) { ... }

// Import in both
import { parseHeaders } from '../../utils/headers';
```

**Validation**:
```bash
# Search for duplicate code
grep -r "function parseHeaders" src/

# Bundle analysis should show single copy
```

### 5. Optimize String Constants

**Large error messages impact bundle size**:

```typescript
// Before: Long error message in code
throw new Error(
  'Invalid configuration: The provided options do not match the expected schema. ' +
  'Please check the documentation at https://hono.dev/api/configuration for details.'
);

// After: Concise message
throw new Error('Invalid config. See: hono.dev/api/config');

// Or: Error codes
throw new Error('ERR_INVALID_CONFIG');  // Document codes elsewhere
```

**Production build optimization**:
```typescript
// Use build-time constant replacement
const DEV_MESSAGES = {
  CONFIG_ERROR: 'Detailed development message...'
};

const PROD_MESSAGES = {
  CONFIG_ERROR: 'Config error'
};

// Build tool replaces this
const MESSAGES = __DEV__ ? DEV_MESSAGES : PROD_MESSAGES;
```

### 6. Lazy Loading for Large Features

**Pattern**: Don't import large dependencies in main module

```typescript
// Before: Imports large crypto library in main module
import { verify } from './crypto/jwt-verify';

export class Hono {
  verifyJWT(token: string) {
    return verify(token);  // Crypto lib in every bundle!
  }
}

// After: Separate middleware, imported only when used
// src/middleware/jwt/index.ts
import { verify } from './crypto/jwt-verify';

export const jwt = () => {
  return async (c, next) => {
    const token = c.req.header('Authorization');
    await verify(token);
    await next();
  }
}

// User imports only if needed
import { jwt } from 'hono/jwt';
```

### 7. Minification-Friendly Patterns

**Help minifier reduce size**:

```typescript
// Before: Long property names in hot code
class RequestContext {
  internalStateForCaching: Map<string, any>;
  temporaryBufferForParsing: Buffer;
}

// After: Short names (minifier will handle, but start shorter)
class RequestContext {
  cache: Map<string, any>;
  buffer: Buffer;
}

// Before: Repeated strings
if (method === 'GET') { }
if (method === 'POST') { }
if (method === 'PUT') { }

// After: Constant (minified to single reference)
const GET = 'GET', POST = 'POST', PUT = 'PUT';
if (method === GET) { }
if (method === POST) { }
```

## Avoiding Bundle Bloat

### Anti-Patterns

**1. Importing from index files**:
```typescript
// ✗ Bad: Imports entire router module
import { RegExpRouter } from './router';

// ✓ Good: Import specific implementation
import { RegExpRouter } from './router/reg-exp-router';
```

**2. Circular dependencies**:
```typescript
// ✗ Bad: A imports B, B imports A
// src/hono.ts
import { Context } from './context';

// src/context.ts
import { Hono } from './hono';  // Circular!

// ✓ Good: Extract shared types
// src/types.ts
export interface HonoInterface { ... }

// Both import from types, no circle
```

**3. Unused exports**:
```typescript
// ✗ Bad: Exports unused functions
export function internalHelper() { }  // Not used externally

// ✓ Good: Remove or make internal
function internalHelper() { }  // Not exported
```

## Bundle Size Performance Budget

### Set Thresholds

Create `scripts/check-bundle-size.ts`:
```typescript
import { build } from 'esbuild';
import fs from 'fs';

const bundles = [
  { name: 'tiny', entry: 'src/preset/tiny.ts', maxSize: 12 * 1024 },
  { name: 'core', entry: 'src/index.ts', maxSize: 50 * 1024 },
];

for (const bundle of bundles) {
  await build({
    entryPoints: [bundle.entry],
    bundle: true,
    minify: true,
    format: 'esm',
    outfile: `/tmp/${bundle.name}.js`
  });

  const size = fs.statSync(`/tmp/${bundle.name}.js`).size;
  console.log(`${bundle.name}: ${size} bytes (max: ${bundle.maxSize})`);

  if (size > bundle.maxSize) {
    console.error(`❌ ${bundle.name} exceeds budget!`);
    process.exit(1);
  }
}

console.log('✅ All bundles within budget');
```

**Run in CI**:
```yaml
- name: Check bundle size
  run: bun run scripts/check-bundle-size.ts
```

## Measuring Bundle Size Impact

### Before/After Comparison

```bash
# Baseline
git checkout main
bun run build
esbuild src/preset/tiny.ts --bundle --minify --outfile=/tmp/tiny-before.js
SIZE_BEFORE=$(ls -l /tmp/tiny-before.js | awk '{print $5}')

# Your changes
git checkout your-branch
bun run build
esbuild src/preset/tiny.ts --bundle --minify --outfile=/tmp/tiny-after.js
SIZE_AFTER=$(ls -l /tmp/tiny-after.js | awk '{print $5}')

# Compare
echo "Before: $SIZE_BEFORE bytes"
echo "After: $SIZE_AFTER bytes"
echo "Difference: $((SIZE_AFTER - SIZE_BEFORE)) bytes"
```

## Compression-Aware Optimization

**Real-world impact**: Gzip/Brotli compression

```bash
# Measure compressed size
esbuild src/preset/tiny.ts --bundle --minify --outfile=/tmp/tiny.js

# Uncompressed
ls -lh /tmp/tiny.js

# Gzip
gzip -c /tmp/tiny.js > /tmp/tiny.js.gz
ls -lh /tmp/tiny.js.gz

# Brotli (better compression)
brotli -c /tmp/tiny.js > /tmp/tiny.js.br
ls -lh /tmp/tiny.js.br
```

**Compression-friendly patterns**:
- Repeated code compresses well
- Similar strings compress well
- Random/unique strings compress poorly

## Bundle Optimization Checklist

For bundle size optimization PRs:

- [ ] Measured bundle size before/after
- [ ] Checked compressed size (gzip/brotli)
- [ ] Verified tree-shaking works (`sideEffects` config)
- [ ] No unexpected dependencies in bundle
- [ ] Tested bundle still works (runtime tests)
- [ ] Documented any trade-offs
- [ ] Updated bundle size budget if needed

## Quick Wins

Easiest bundle optimizations:

1. [ ] Run bundle analyzer, identify largest modules
2. [ ] Check for duplicate utility code
3. [ ] Verify `sideEffects: false` in package.json
4. [ ] Shorten error messages in production
5. [ ] Remove unused exports

## Tools and Resources

**Bundle analysis**:
- esbuild metafile: Built-in analysis
- https://esbuild.github.io/analyze/: Visualizer
- `source-map-explorer`: Treemap visualization

**Size tracking**:
- CI integration with size comments on PRs
- Automated budget enforcement

## Next Steps

- See `performance-measurement.md` for measurement strategies
- See `runtime-performance.md` for runtime optimizations
- See `build-performance.md` for build speed improvements
