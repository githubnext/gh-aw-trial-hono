# Hono HTTP Request/Response Header Handling - Performance Analysis Report

## Executive Summary

This report identifies critical performance optimization opportunities in Hono's header handling code. The analysis focuses on hot paths that execute on every request and response. Several patterns were identified that could benefit from optimization, particularly around header copying, iteration, and normalization operations.

---

## 1. REQUEST HEADER READING

### Location: `/src/request.ts` (Lines 180-190)

**Current Implementation:**
```typescript
header(name?: string) {
  if (name) {
    return this.raw.headers.get(name) ?? undefined
  }

  const headerData: Record<string, string | undefined> = {}
  this.raw.headers.forEach((value, key) => {
    headerData[key] = value
  })
  return headerData
}
```

**Issues Identified:**
- **Issue 1**: When getting all headers without a specific key, the code calls `.forEach()` which creates an iterator and loops through all headers
- **Issue 2**: Creates a new object for every call to `header()` without memoization
- **Issue 3**: Uses `headers.forEach()` callback pattern instead of `entries()` iteration, which may have overhead
- **Pattern**: O(n) operation performed frequently

**Optimization Potential:**
- **Cache all-headers result** on first call to `header()` without arguments
- **Replace forEach with entries()** for potential performance gains
- **Consider lazy initialization** for the full header object

---

## 2. RESPONSE HEADER SETTING & MERGING

### Location: `/src/context.ts` (Lines 499-511)

**Current Implementation:**
```typescript
header: SetHeaders = (name, value, options): void => {
  if (this.finalized) {
    this.#res = new Response((this.#res as Response).body, this.#res)
  }
  const headers = this.#res ? this.#res.headers : (this.#preparedHeaders ??= new Headers())
  if (value === undefined) {
    headers.delete(name)
  } else if (options?.append) {
    headers.append(name, value)
  } else {
    headers.set(name, value)
  }
}
```

**Issues Identified:**
- **Issue 1**: Ternary conditional on every call to access/create headers
- **Issue 2**: When response is finalized, creates new Response object which copies all headers
- **Issue 3**: No header normalization caching (header names are looked up differently each time)

---

### Location: `/src/context.ts` (Lines 594-629) - `#newResponse()` method

**Current Implementation:**
```typescript
#newResponse(
  data: Data | null,
  arg?: StatusCode | ResponseOrInit,
  headers?: HeaderRecord
): Response {
  const responseHeaders = this.#res
    ? new Headers(this.#res.headers)
    : this.#preparedHeaders ?? new Headers()

  if (typeof arg === 'object' && 'headers' in arg) {
    const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers)
    for (const [key, value] of argHeaders) {
      if (key.toLowerCase() === 'set-cookie') {
        responseHeaders.append(key, value)
      } else {
        responseHeaders.set(key, value)
      }
    }
  }

  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      if (typeof v === 'string') {
        responseHeaders.set(k, v)
      } else {
        responseHeaders.delete(k)
        for (const v2 of v) {
          responseHeaders.append(k, v2)
        }
      }
    }
  }

  const status = typeof arg === 'number' ? arg : arg?.status ?? this.#status
  return new Response(data, { status, headers: responseHeaders })
}
```

**Issues Identified:**
- **Issue 1**: String case normalization on EVERY iteration: `key.toLowerCase() === 'set-cookie'`
- **Issue 2**: Creates new Headers object from existing headers (full copy): `new Headers(this.#res.headers)`
- **Issue 3**: Multiple nested loops for header merging (lines 615-624)
- **Issue 4**: Checks header type inline during iteration
- **Pattern**: O(n) operations where n = number of headers to merge/copy
- **Hot Path**: Called for every response that needs headers (json(), text(), html(), etc.)

**Optimization Potential:**
- **Pre-compute header key case normalization** instead of calling `toLowerCase()` in loop
- **Avoid full header copies** by using append/set operations directly
- **Batch header operations** instead of individual set/append calls

---

## 3. SET-COOKIE HEADER HANDLING

### Location: `/src/context.ts` (Lines 398-418) - Response setter

**Current Implementation:**
```typescript
set res(_res: Response | undefined) {
  if (this.#res && _res) {
    _res = new Response(_res.body, _res)
    for (const [k, v] of this.#res.headers.entries()) {
      if (k === 'content-type') {
        continue
      }
      if (k === 'set-cookie') {
        const cookies = this.#res.headers.getSetCookie()
        _res.headers.delete('set-cookie')
        for (const cookie of cookies) {
          _res.headers.append('set-cookie', cookie)
        }
      } else {
        _res.headers.set(k, v)
      }
    }
  }
  this.#res = _res
  this.finalized = true
}
```

**Issues Identified:**
- **Issue 1**: String comparison in loop without case normalization: `k === 'content-type'` and `k === 'set-cookie'`
- **Issue 2**: Iterates through ALL headers with `.entries()` to find set-cookie
- **Issue 3**: Additional `.getSetCookie()` call inside the condition
- **Issue 4**: Nested loops for cookie handling (lines 406-410)
- **Pattern**: Inefficient header searching in critical path

**Optimization Potential:**
- **Use header existence checks** instead of iterating all headers
- **Cache set-cookie detection** before main loop
- **Pre-normalize header names** for comparison

---

### Location: `/src/adapter/aws-lambda/handler.ts` (Lines 318-326)

**Current Implementation:**
```typescript
if (result.multiValueHeaders) {
  res.headers.forEach((value, key) => {
    result.multiValueHeaders[key] = [value]
  })
} else {
  res.headers.forEach((value, key) => {
    result.headers[key] = value
  })
}
```

**Issues Identified:**
- **Issue 1**: Uses `.forEach()` to iterate all headers
- **Issue 2**: Allocates new array for each header in multiValueHeaders path
- **Pattern**: O(n) operation on response headers

---

### Location: `/src/adapter/lambda-edge/handler.ts` (Lines 105-114)

**Current Implementation:**
```typescript
const convertHeaders = (headers: Headers): CloudFrontHeaders => {
  const cfHeaders: CloudFrontHeaders = {}
  headers.forEach((value, key) => {
    cfHeaders[key.toLowerCase()] = [
      ...(cfHeaders[key.toLowerCase()] || []),
      { key: key.toLowerCase(), value },
    ]
  })
  return cfHeaders
}
```

**Issues Identified:**
- **Issue 1**: Calls `key.toLowerCase()` TWICE per iteration (lines 108 and 110)
- **Issue 2**: Creates spread operator array `[...(cfHeaders[...] || [])]` for each header
- **Issue 3**: Nested object creation per header
- **Pattern**: String normalization is duplicated on every iteration
- **Hot Path**: Called for every Lambda@Edge response

**Optimization Potential:**
- **Cache lowercased key** in variable to avoid double normalization
- **Use push() instead of spread operator** for array concatenation

---

## 4. COOKIE PARSING & SERIALIZATION

### Location: `/src/utils/cookie.ts` (Lines 79-112) - Cookie parsing

**Current Implementation:**
```typescript
export const parse = (cookie: string, name?: string): Cookie => {
  if (name && cookie.indexOf(name) === -1) {
    // Fast-path: return immediately if the demanded-key is not in the cookie string
    return {}
  }
  const pairs = cookie.trim().split(';')
  const parsedCookie: Cookie = {}
  for (let pairStr of pairs) {
    pairStr = pairStr.trim()
    const valueStartPos = pairStr.indexOf('=')
    if (valueStartPos === -1) {
      continue
    }

    const cookieName = pairStr.substring(0, valueStartPos).trim()
    if ((name && name !== cookieName) || !validCookieNameRegEx.test(cookieName)) {
      continue
    }

    let cookieValue = pairStr.substring(valueStartPos + 1).trim()
    if (cookieValue.startsWith('"') && cookieValue.endsWith('"')) {
      cookieValue = cookieValue.slice(1, -1)
    }
    if (validCookieValueRegEx.test(cookieValue)) {
      parsedCookie[cookieName] =
        cookieValue.indexOf('%') !== -1 ? tryDecode(cookieValue, decodeURIComponent_) : cookieValue
      if (name) {
        // Fast-path: return only the demanded-key immediately. Other keys are not needed.
        break
      }
    }
  }
  return parsedCookie
}
```

**Good Patterns:**
- Uses fast-path optimization when specific cookie requested (lines 80-82)
- Breaks early when target cookie found (line 107)

**Potential Improvements:**
- **Regex testing**: `validCookieNameRegEx.test()` and `validCookieValueRegEx.test()` called per cookie
- **Multiple string operations**: indexOf, substring, trim, slice operations
- **Pattern**: Many string operations per cookie pair

---

### Location: `/src/utils/cookie.ts` (Lines 141-222) - Cookie serialization

**Current Implementation:**
```typescript
const _serialize = (name: string, value: string, opt: CookieOptions = {}): string => {
  let cookie = `${name}=${value}`
  
  // Multiple if blocks with string concatenation
  if (opt && typeof opt.maxAge === 'number' && opt.maxAge >= 0) {
    if (opt.maxAge > 34560000) {
      throw new Error(...)
    }
    cookie += `; Max-Age=${opt.maxAge | 0}`
  }

  if (opt.domain && opt.prefix !== 'host') {
    cookie += `; Domain=${opt.domain}`
  }

  if (opt.path) {
    cookie += `; Path=${opt.path}`
  }
  
  // ... more if blocks with string concatenation
}
```

**Issues Identified:**
- **Issue 1**: Uses string concatenation in loop-like pattern (multiple `+=` operations)
- **Issue 2**: Each conditional adds to the cookie string incrementally
- **Pattern**: String concatenation can be inefficient; should use array.join() or template literals

**Optimization Potential:**
- **Replace += concatenation** with array collection and single join()
- **Pre-allocate array** for known cookie parts

---

## 5. HEADER PARSING (Accept, Content-Type)

### Location: `/src/utils/accept.ts` (Lines 12-24)

**Current Implementation:**
```typescript
export const parseAccept = (acceptHeader: string): Accept[] => {
  if (!acceptHeader) {
    return []
  }

  const acceptValues = acceptHeader.split(',').map((value, index) => ({ value, index }))

  return acceptValues
    .map(parseAcceptValue)
    .filter((item): item is Accept & { index: number } => Boolean(item))
    .sort(sortByQualityAndIndex)
    .map(({ type, params, q }) => ({ type, params, q }))
}
```

**Issues Identified:**
- **Issue 1**: Multiple chained map/filter/sort operations create intermediate arrays
- **Issue 2**: String split followed by map creates new objects for each value
- **Issue 3**: Regex split operation: `parseAcceptValueRegex = /;(?=(?:(?:[^"]*"){2})*[^"]*$)/`
- **Pattern**: Multiple iterations over header values

**Optimization Potential:**
- **Combine operations** to reduce intermediate array allocations
- **Lazy evaluation** could be considered for large Accept headers

---

## 6. HEADER MERGING IN MIDDLEWARE

### Location: `/src/middleware/cors/index.ts` (Lines 139-148)

**Current Implementation:**
```typescript
let headers = opts.allowHeaders
if (!headers?.length) {
  const requestHeaders = c.req.header('Access-Control-Request-Headers')
  if (requestHeaders) {
    headers = requestHeaders.split(/\s*,\s*/)
  }
}
if (headers?.length) {
  set('Access-Control-Allow-Headers', headers.join(','))
  c.res.headers.append('Vary', 'Access-Control-Request-Headers')
}
```

**Issues Identified:**
- **Issue 1**: String split and join operations for header values
- **Issue 2**: Each response call may repeat similar parsing

---

### Location: `/src/middleware/cache/index.ts` (Lines 76-110)

**Current Implementation:**
```typescript
const addHeader = (c: Context) => {
  if (cacheControlDirectives) {
    const existingDirectives =
      c.res.headers
        .get('Cache-Control')
        ?.split(',')
        .map((d) => d.trim().split('=', 1)[0]) ?? []
    for (const directive of cacheControlDirectives) {
      let [name, value] = directive.trim().split('=', 2)
      name = name.toLowerCase()
      if (!existingDirectives.includes(name)) {
        c.header('Cache-Control', `${name}${value ? `=${value}` : ''}`, { append: true })
      }
    }
  }

  if (varyDirectives) {
    const existingDirectives =
      c.res.headers
        .get('Vary')
        ?.split(',')
        .map((d) => d.trim()) ?? []

    const vary = Array.from(
      new Set(
        [...existingDirectives, ...varyDirectives].map((directive) => directive.toLowerCase())
      )
    ).sort()

    if (vary.includes('*')) {
      c.header('Vary', '*')
    } else {
      c.header('Vary', vary.join(', '))
    }
  }
}
```

**Issues Identified:**
- **Issue 1**: Split/parse operations every time header is accessed
- **Issue 2**: `.includes()` lookup on array (O(n)) inside Set deduplication
- **Issue 3**: Multiple array operations: spread, Set creation, Array.from, sort, join
- **Issue 4**: `toLowerCase()` called multiple times per directive
- **Pattern**: Heavy string manipulation in hot path (cache middleware runs on all responses)

**Optimization Potential:**
- **Cache parsed directives** instead of re-parsing on every call
- **Avoid redundant normalization** (toLowerCase already done)
- **Pre-compute deduplication** using better data structure

---

### Location: `/src/middleware/secure-headers/secure-headers.ts` (Lines 327-331)

**Current Implementation:**
```typescript
function setHeaders(ctx: Context, headersToSet: [string, string][]) {
  headersToSet.forEach(([header, value]) => {
    ctx.res.headers.set(header, value)
  })
}
```

**Issues Identified:**
- **Minor**: Uses forEach instead of for loop, but not a hot path

---

## 7. HEADER COPYING & CLONING

### Location: `/src/context.ts` (Lines 599-601)

**Current Implementation:**
```typescript
const responseHeaders = this.#res
  ? new Headers(this.#res.headers)
  : this.#preparedHeaders ?? new Headers()
```

**Issues Identified:**
- **Issue 1**: `new Headers(this.#res.headers)` creates a full copy of all existing headers
- **Issue 2**: This happens for every response creation (json, text, html, etc.)
- **Pattern**: Unnecessary full copies when only appending/setting new headers

**Optimization Potential:**
- **Avoid full header copies** when not necessary
- **Append operations directly** to existing headers instead of copying then modifying

---

### Location: `/src/adapter/lambda-edge/handler.ts` (Lines 160-162)

**Current Implementation:**
```typescript
Object.entries(event.Records[0].cf.request.headers).forEach(([k, v]) => {
  v.forEach((header) => headers.set(k, header.value))
})
```

**Issues Identified:**
- **Issue 1**: Nested forEach loops
- **Issue 2**: Sets last value for headers with multiple values (should append)

---

## 8. HEADER NORMALIZATION PATTERNS

### Multiple Case-Sensitive Comparisons

The codebase has several instances of case-sensitive header name comparisons that should be case-insensitive:

1. **`context.ts` Line 402**: `k === 'content-type'`
2. **`context.ts` Line 405**: `k === 'set-cookie'`
3. **`context.ts` Line 606**: `key.toLowerCase() === 'set-cookie'` (with normalization)
4. **`lambda-edge/handler.ts` Lines 108, 110**: `key.toLowerCase()` (duplicate normalization)

**Pattern**: Inconsistent header name normalization - some use direct comparison, some use toLowerCase()

---

## 9. ADAPTER HEADER PROCESSING

### AWS Lambda Handler - `/src/adapter/aws-lambda/handler.ts`

**Current Pattern (Lines 373-378, 425-429, 463-476):**
```typescript
for (const [k, v] of Object.entries(event.headers)) {
  if (v) {
    headers.set(k, v)
  }
}
```

**Issues:**
- **Issue 1**: Multiple similar loops across different event processor classes
- **Issue 2**: Repeated pattern with slight variations (sanitization in some cases)
- **Pattern**: Code duplication in header processing

---

## SUMMARY OF OPTIMIZATION OPPORTUNITIES

### Critical/High-Impact Issues (Hot Path):

| Issue | Location | Impact | Priority |
|-------|----------|--------|----------|
| Header copying in `#newResponse()` | context.ts:600 | Copies all headers on every response | **HIGH** |
| String case normalization in loops | lambda-edge/handler.ts:108-110 | Duplicate toLowerCase() calls | **HIGH** |
| Cache-Control/Vary parsing | middleware/cache/index.ts:76-110 | String parsing on every cached response | **HIGH** |
| Response header setter overhead | context.ts:498-511 | Ternary conditional on every header set | **MEDIUM** |
| Set-cookie special handling | context.ts:398-418 | Iterates all headers looking for set-cookie | **MEDIUM** |
| All-headers fetch without caching | request.ts:180-190 | forEach on all headers, creates new object | **MEDIUM** |
| Header merging in newResponse | context.ts:614-625 | Multiple nested loops for merging | **MEDIUM** |
| Cookie serialization concatenation | utils/cookie.ts:141-222 | String += in multiple conditional blocks | **LOW** |

### Recommended Optimizations:

1. **Cache header copies** - Avoid `new Headers(existingHeaders)` when possible
2. **Pre-normalize header names** - Cache lowercase versions instead of computing in loops
3. **Batch header operations** - Collect headers and apply in fewer operations
4. **Lazy header parsing** - Parse header values only when accessed
5. **Use array operations** instead of string concatenation for cookie serialization
6. **Memoize full header retrieval** in request.header()
7. **Skip unnecessary header checking** - Use has() before iterating

---

## PERFORMANCE IMPACT ANALYSIS

### Estimated Frequency:
- **Per-Request Operations**: header() calls, newResponse() calls
- **Per-Response Operations**: Response header setting/merging, cookie handling
- **Per-Middleware Operations**: Cache middleware, CORS, Secure headers

### Estimated Call Frequency (per typical request):
- `header()` method: 3-10 times
- `#newResponse()`: 1-2 times
- `set()` for headers: 2-5 times
- Response finalization: 0-1 times

### Cumulative Impact:
A high-traffic server handling 10,000 requests/sec would execute:
- 30,000-100,000 header() calls/sec
- 10,000-20,000 #newResponse() calls/sec
- 20,000-50,000 header set operations/sec

Even small optimizations (10-20% improvements per operation) would compound to significant gains at scale.

