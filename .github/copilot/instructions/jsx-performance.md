# JSX Rendering Performance Guide for Hono

This guide covers optimizations for Hono's JSX implementation, focusing on server-side rendering (SSR) and client-side performance.

## JSX Implementation Overview

### Locations
- `src/jsx/` - Core JSX implementation
- `src/jsx/streaming.tsx` - Streaming SSR
- `src/jsx/dom/` - Client-side DOM JSX
- `benchmarks/jsx/` - JSX benchmarks

### Current Capabilities
- Server-side rendering (sync and streaming)
- Client-side hydration
- JSX intrinsic elements
- Fragment support
- Async components

## Server-Side JSX Performance

### 1. Element Creation Optimization

**Current approach** (`src/jsx/`):
```typescript
// JSX.createElement or jsx() function
function jsx(type, props, ...children) {
  return { type, props, children };
}
```

**Optimization opportunities**:

**A. Reduce object allocations**:
```typescript
// Before: Creates intermediate arrays
function jsx(type, props, ...children) {
  return { type, props, children };
}

// After: Avoid rest parameters for common cases
function jsx(type, props, child1?, child2?) {
  if (child1 === undefined) {
    return { type, props };
  }
  if (child2 === undefined) {
    return { type, props, children: [child1] };
  }
  // Only use array for 2+ children
  return { type, props, children: [child1, child2] };
}
```

**B. String concatenation optimization**:
```typescript
// Before: Array join
const children = ['<div>', content, '</div>'].join('');

// After: Template literal (often faster)
const children = `<div>${content}</div>`;

// Or: Direct concatenation for simple cases
const children = '<div>' + content + '</div>';
```

### 2. Rendering Pipeline Optimization

**Hot path**: JSX element → HTML string

**Benchmark baseline**:
```typescript
// benchmarks/jsx/
// Measure current rendering performance

import { jsx } from '../../src/jsx';

const iterations = 100_000;
const element = jsx('div', { class: 'test' }, 'content');

const start = performance.now();
for (let i = 0; i < iterations; i++) {
  renderToString(element);
}
const end = performance.now();

console.log(`${iterations / ((end - start) / 1000)} renders/sec`);
```

**Optimization strategies**:

**A. Fast path for simple elements**:
```typescript
function renderToString(element) {
  // Fast path: No children, no special props
  if (typeof element === 'string') return element;

  if (!element.children && isSimpleProps(element.props)) {
    // Direct string construction
    return `<${element.type}${renderProps(element.props)}/>`;
  }

  // Full rendering path
  return renderFull(element);
}
```

**B. Props serialization optimization**:
```typescript
// Before: Object.entries creates array
function renderProps(props) {
  return Object.entries(props)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
}

// After: Direct iteration
function renderProps(props) {
  let result = '';
  for (const key in props) {
    if (props.hasOwnProperty(key)) {
      result += ` ${key}="${props[key]}"`;
    }
  }
  return result;
}
```

### 3. Streaming SSR Optimization

**Location**: `src/jsx/streaming.tsx`

**Current**: Async streaming with suspense support

**Optimization opportunities**:

**A. Reduce async overhead for sync components**:
```typescript
// Detect if component is sync or async
function isAsyncComponent(component) {
  return component.constructor.name === 'AsyncFunction';
}

// Use sync path when possible
if (!isAsyncComponent(component)) {
  // Synchronous rendering (faster)
  return renderSync(component);
} else {
  // Async streaming
  return renderAsync(component);
}
```

**B. Buffer management**:
```typescript
// Before: Small writes
stream.write('<div>');
stream.write(content);
stream.write('</div>');

// After: Buffered writes
const buffer = [];
buffer.push('<div>', content, '</div>');
stream.write(buffer.join(''));
```

**C. Chunk size optimization**:
```typescript
// Experiment with chunk sizes
const CHUNK_SIZE = 16 * 1024;  // 16KB chunks
let buffer = '';

function flushIfNeeded() {
  if (buffer.length >= CHUNK_SIZE) {
    stream.write(buffer);
    buffer = '';
  }
}
```

### 4. Component Memoization

**Pattern**: Cache rendered output for static components

```typescript
// Simple memoization for pure components
const memoCache = new Map();

function memo(Component) {
  return (props) => {
    const key = JSON.stringify(props);
    if (memoCache.has(key)) {
      return memoCache.get(key);
    }

    const result = Component(props);
    memoCache.set(key, result);
    return result;
  };
}

// Usage:
const Header = memo(({ title }) => (
  <header><h1>{title}</h1></header>
));
```

**Trade-offs**:
- Memory usage for cache
- Serialization cost for cache key
- Only beneficial for expensive/repeated components

## Client-Side JSX Performance

**Location**: `src/jsx/dom/`

### 1. DOM Manipulation Optimization

**Virtual DOM diffing** (if applicable):
```typescript
// Minimize DOM operations
// Batch updates together
// Use document fragments for multiple insertions

// Before: Multiple DOM updates
for (const child of children) {
  parent.appendChild(child);
}

// After: Single fragment insertion
const fragment = document.createDocumentFragment();
for (const child of children) {
  fragment.appendChild(child);
}
parent.appendChild(fragment);
```

### 2. Event Handler Optimization

```typescript
// Before: New function on every render
<button onClick={() => handleClick(id)}>

// After: Memoized handler
const memoizedHandler = useMemo(
  () => () => handleClick(id),
  [id]
);
<button onClick={memoizedHandler}>
```

## JSX-Specific Benchmarking

### Create Focused Benchmarks

```typescript
// /tmp/gh-aw/agent/jsx-bench.ts
import { jsx } from '../src/jsx';
import { renderToString } from '../src/jsx/render';

// Benchmark different scenarios
const benchmarks = {
  simple: jsx('div', {}, 'text'),
  nested: jsx('div', {},
    jsx('p', {}, 'nested'),
    jsx('span', {}, 'text')
  ),
  withProps: jsx('div', {
    class: 'foo',
    id: 'bar',
    'data-test': 'value'
  }, 'content'),
  deeply: jsx('div', {},
    jsx('div', {},
      jsx('div', {},
        jsx('div', {}, 'deep')
      )
    )
  )
};

for (const [name, element] of Object.entries(benchmarks)) {
  const iterations = 100_000;
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    renderToString(element);
  }

  const end = performance.now();
  const perSec = iterations / ((end - start) / 1000);
  console.log(`${name}: ${perSec.toFixed(0)} renders/sec`);
}
```

### Run JSX Benchmarks

```bash
# Use existing benchmarks
cd benchmarks/jsx
# Follow README for specific commands

# Or run custom benchmark
bun run /tmp/gh-aw/agent/jsx-bench.ts
```

## Common JSX Performance Patterns

### 1. Static Markup Optimization

```typescript
// For truly static content, skip JSX entirely
// Before:
const Footer = () => (
  <footer>
    <p>Copyright 2024</p>
    <a href="/terms">Terms</a>
  </footer>
);

// After: Raw string (if never changes)
const FOOTER_HTML = '<footer><p>Copyright 2024</p><a href="/terms">Terms</a></footer>';
```

### 2. List Rendering Optimization

```typescript
// Before: Spread children array
<ul>{...items.map(i => <li>{i}</li>)}</ul>

// After: Direct array (if supported)
<ul>{items.map(i => <li>{i}</li>)}</ul>

// Or: Pre-allocate array
const lis = new Array(items.length);
for (let i = 0; i < items.length; i++) {
  lis[i] = <li>{items[i]}</li>;
}
<ul>{lis}</ul>
```

### 3. Avoid Unnecessary Wrapping

```typescript
// Before: Extra div wrapper
return <div><Component /></div>;

// After: Fragment or direct return
return <Component />;
// Or: <>component</>
```

## JSX Performance Checklist

For JSX performance PRs:

- [ ] Benchmark baseline established
- [ ] Tested with both simple and complex components
- [ ] Streaming performance considered (if applicable)
- [ ] Memory impact assessed
- [ ] Client-side hydration still works
- [ ] All JSX tests pass
- [ ] Real-world usage patterns tested

## Anti-Patterns

**1. Expensive operations in render**:
```typescript
// ✗ Bad: Computation in render
const Component = ({ items }) => (
  <div>
    {items.sort().filter(i => i.active).map(i => <Item {...i} />)}
  </div>
);

// ✓ Good: Compute outside render
const Component = ({ items }) => {
  const activeItems = useMemo(
    () => items.filter(i => i.active).sort(),
    [items]
  );
  return <div>{activeItems.map(i => <Item {...i} />)}</div>;
};
```

**2. Deep component nesting**:
```typescript
// ✗ Bad: Unnecessary nesting
<div><div><div><span>text</span></div></div></div>

// ✓ Good: Flatten when possible
<div><span>text</span></div>
```

**3. Large inline objects**:
```typescript
// ✗ Bad: Creates new object every render
<Component style={{ margin: 10, padding: 20, ... }} />

// ✓ Good: Define outside
const style = { margin: 10, padding: 20, ... };
<Component style={style} />
```

## Profiling JSX Performance

### 1. Identify Hot Paths

```typescript
// Add timing to rendering
const times = [];

function timedRender(element) {
  const start = performance.now();
  const result = renderToString(element);
  const end = performance.now();

  times.push(end - start);
  return result;
}

// Analyze
console.log('Min:', Math.min(...times));
console.log('Max:', Math.max(...times));
console.log('Avg:', times.reduce((a,b) => a+b) / times.length);
```

### 2. Memory Profiling

```bash
# Node.js heap snapshot
node --expose-gc --inspect your-jsx-app.js

# Bun profiling
bun --profile your-jsx-app.js
```

## Integration with HTTP Benchmarks

**Test JSX performance in realistic scenarios**:

```typescript
// benchmarks/http-server/
// Add JSX endpoint
app.get('/jsx', (c) => {
  return c.html(
    <html>
      <body>
        <h1>Test</h1>
        <p>Content</p>
      </body>
    </html>
  );
});

// Benchmark this endpoint
bombardier -c 100 -d 10s http://localhost:3000/jsx
```

## Quick Wins

Easiest JSX optimizations:

1. [ ] Profile current rendering performance
2. [ ] Optimize props serialization (avoid Object.entries)
3. [ ] Add fast path for simple elements
4. [ ] Reduce object allocations in createElement
5. [ ] Buffer streaming writes

## Next Steps

- See `performance-measurement.md` for benchmarking strategies
- See `runtime-performance.md` for general optimization patterns
- See `build-performance.md` for development workflow
