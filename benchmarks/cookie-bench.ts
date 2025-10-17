import { parse, serialize } from '../src/utils/cookie'

const iterations = 100_000

// Test scenarios
const testCases = {
  simpleCookie: 'sessionId=abc123',
  multipleCookies: 'sessionId=abc123; userId=user456; theme=dark; lang=en',
  quotedCookie: 'data="quoted value"; other=normal',
  encodedCookie: 'search=hello%20world; filter=type%3Dtest',
  complexCookie:
    'sessionId=abc123; userId=user456; theme=dark; lang=en; prefs=a%3Db%26c%3Dd; token=xyz789',
}

console.log('=== Cookie Parsing Performance ===\n')

// Benchmark parse - all cookies
console.log('Parse all cookies:')
for (const [name, cookieString] of Object.entries(testCases)) {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    parse(cookieString)
  }
  const end = performance.now()
  const opsPerSec = iterations / ((end - start) / 1000)
  const nsPerOp = ((end - start) * 1_000_000) / iterations
  console.log(
    `  ${name.padEnd(20)}: ${opsPerSec.toFixed(0).padStart(12)} ops/s (${nsPerOp.toFixed(2)} ns/op)`
  )
}

console.log('\nParse specific cookie:')
for (const [name, cookieString] of Object.entries(testCases)) {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    parse(cookieString, 'sessionId')
  }
  const end = performance.now()
  const opsPerSec = iterations / ((end - start) / 1000)
  const nsPerOp = ((end - start) * 1_000_000) / iterations
  console.log(
    `  ${name.padEnd(20)}: ${opsPerSec.toFixed(0).padStart(12)} ops/s (${nsPerOp.toFixed(2)} ns/op)`
  )
}

console.log('\n=== Cookie Serialization Performance ===\n')

// Benchmark serialize - different options
const serializeTests = [
  { name: 'simple', value: 'abc123', opts: {} },
  { name: 'with-path', value: 'abc123', opts: { path: '/' } },
  {
    name: 'with-options',
    value: 'abc123',
    opts: { path: '/', httpOnly: true, secure: true, sameSite: 'Strict' as const },
  },
  {
    name: 'full-options',
    value: 'abc123',
    opts: {
      path: '/',
      domain: 'example.com',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax' as const,
      maxAge: 3600,
      priority: 'High' as const,
    },
  },
]

console.log('Serialize cookies:')
for (const { name, value, opts } of serializeTests) {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    serialize('sessionId', value, opts)
  }
  const end = performance.now()
  const opsPerSec = iterations / ((end - start) / 1000)
  const nsPerOp = ((end - start) * 1_000_000) / iterations
  console.log(
    `  ${name.padEnd(20)}: ${opsPerSec.toFixed(0).padStart(12)} ops/s (${nsPerOp.toFixed(2)} ns/op)`
  )
}

console.log('\n=== Overall Statistics ===')
console.log(`Total iterations per test: ${iterations.toLocaleString()}`)
console.log(`Runtime: Bun ${Bun.version}`)
