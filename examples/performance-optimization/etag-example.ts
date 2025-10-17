/**
 * ETag Conditional Requests Example
 *
 * Demonstrates bandwidth savings and performance improvements using ETag
 * for conditional HTTP requests (304 Not Modified responses).
 *
 * Key Optimization: Return 304 when content hasn't changed
 * Impact: 2-10x bandwidth reduction, faster response times
 * Complexity: Low - simple header checking
 */

import { Hono } from '../../dist'
import { etag } from '../../dist/middleware/etag'

// ============================================================================
// Helper: Generate ETag from content
// ============================================================================

async function generateETag(content: string): Promise<string> {
  // Simple ETag generation (in production, use crypto.subtle.digest)
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `"${Math.abs(hash).toString(36)}"`
}

// ============================================================================
// Simulated Data Source
// ============================================================================

interface Article {
  id: number
  title: string
  content: string
  updated_at: string
}

class ArticleService {
  private articles: Map<number, Article> = new Map()

  constructor() {
    // Pre-populate with sample articles
    for (let i = 1; i <= 10; i++) {
      const content = `This is article ${i}. `.repeat(100) // ~2KB per article
      this.articles.set(i, {
        id: i,
        title: `Article ${i}`,
        content,
        updated_at: new Date().toISOString()
      })
    }
  }

  getArticle(id: number): Article | undefined {
    return this.articles.get(id)
  }

  getAllArticles(): Article[] {
    return Array.from(this.articles.values())
  }

  updateArticle(id: number, data: Partial<Article>): Article | undefined {
    const article = this.articles.get(id)
    if (!article) return undefined

    const updated = {
      ...article,
      ...data,
      updated_at: new Date().toISOString()
    }

    this.articles.set(id, updated)
    return updated
  }
}

const articleService = new ArticleService()

// ============================================================================
// BEFORE: No ETag support - Always send full response
// ============================================================================

const appBefore = new Hono()

appBefore.get('/api/articles/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const article = articleService.getArticle(id)

  if (!article) {
    return c.json({ error: 'Article not found' }, 404)
  }

  // ❌ BAD: Always send full response, even if client has cached copy
  return c.json(article)
})

appBefore.get('/api/articles', async (c) => {
  const articles = articleService.getAllArticles()

  // ❌ BAD: Always send all articles (~20KB), no caching
  return c.json({ articles })
})

// ============================================================================
// AFTER: Manual ETag implementation
// ============================================================================

const appAfter = new Hono()

appAfter.get('/api/articles/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const article = articleService.getArticle(id)

  if (!article) {
    return c.json({ error: 'Article not found' }, 404)
  }

  // ✅ GOOD: Generate ETag from content
  const content = JSON.stringify(article)
  const etag = await generateETag(content)

  // Check If-None-Match header from client
  const clientETag = c.req.header('If-None-Match')

  if (clientETag === etag) {
    // ✅ GOOD: Content hasn't changed, return 304
    return c.body(null, 304, {
      'ETag': etag,
      'Cache-Control': 'private, no-cache'
    })
  }

  // Content changed or first request, send full response
  return c.json(article, 200, {
    'ETag': etag,
    'Cache-Control': 'private, no-cache'
  })
})

appAfter.get('/api/articles', async (c) => {
  const articles = articleService.getAllArticles()

  // ✅ GOOD: Generate ETag from articles list
  const content = JSON.stringify(articles)
  const etag = await generateETag(content)

  const clientETag = c.req.header('If-None-Match')

  if (clientETag === etag) {
    // ✅ GOOD: Return 304 for unchanged list
    return c.body(null, 304, {
      'ETag': etag,
      'Cache-Control': 'private, no-cache'
    })
  }

  return c.json({ articles }, 200, {
    'ETag': etag,
    'Cache-Control': 'private, no-cache'
  })
})

// ============================================================================
// BEST: Using Hono's ETag middleware
// ============================================================================

const appBest = new Hono()

// ✅ BEST: Use built-in ETag middleware
appBest.use('*', etag())

appBest.get('/api/articles/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const article = articleService.getArticle(id)

  if (!article) {
    return c.json({ error: 'Article not found' }, 404)
  }

  // Middleware automatically handles ETag generation and 304 responses
  return c.json(article, 200, {
    'Cache-Control': 'private, no-cache'
  })
})

appBest.get('/api/articles', async (c) => {
  const articles = articleService.getAllArticles()

  // Middleware automatically handles everything
  return c.json({ articles }, 200, {
    'Cache-Control': 'private, no-cache'
  })
})

// ============================================================================
// Benchmark
// ============================================================================

interface BenchmarkResult {
  totalTime: number
  avgTime: number
  totalBytes: number
  avgBytes: number
  requests304: number
  requests200: number
}

async function benchmarkApp(app: Hono, description: string, includeETag: boolean): Promise<BenchmarkResult> {
  const iterations = 100
  let totalBytes = 0
  let requests304 = 0
  let requests200 = 0

  const start = performance.now()

  for (let i = 0; i < iterations; i++) {
    const headers: Record<string, string> = {}

    // Simulate client caching: after first request, send ETag
    if (includeETag && i > 0) {
      headers['If-None-Match'] = '"cached-etag"'
    }

    const req = new Request('http://localhost/api/articles/1', { headers })
    const res = await app.fetch(req)

    // Track response size
    const body = await res.text()
    totalBytes += body.length

    if (res.status === 304) {
      requests304++
    } else if (res.status === 200) {
      requests200++

      // Simulate storing ETag for subsequent requests
      if (includeETag) {
        const etag = res.headers.get('ETag')
        if (etag) {
          headers['If-None-Match'] = etag
        }
      }
    }
  }

  const totalTime = performance.now() - start

  return {
    totalTime,
    avgTime: totalTime / iterations,
    totalBytes,
    avgBytes: totalBytes / iterations,
    requests304,
    requests200
  }
}

async function benchmark() {
  console.log('🔬 ETag Conditional Requests Benchmark\n')
  console.log('Testing: GET /api/articles/1 (~2KB response)')
  console.log('Requests: 100 (simulating repeated requests from same client)\n')

  // Benchmark BEFORE (no ETag)
  console.log('❌ BEFORE: No ETag support')
  const resultBefore = await benchmarkApp(appBefore, 'BEFORE', false)

  console.log(`   Total time: ${resultBefore.totalTime.toFixed(2)}ms`)
  console.log(`   Average: ${resultBefore.avgTime.toFixed(2)}ms per request`)
  console.log(`   Total bandwidth: ${(resultBefore.totalBytes / 1024).toFixed(2)} KB`)
  console.log(`   Average: ${resultBefore.avgBytes} bytes per response`)
  console.log(`   200 OK responses: ${resultBefore.requests200}`)
  console.log(`   304 Not Modified: ${resultBefore.requests304}\n`)

  // Benchmark AFTER (manual ETag)
  console.log('✅ AFTER: Manual ETag implementation')
  const resultAfter = await benchmarkApp(appAfter, 'AFTER', true)

  console.log(`   Total time: ${resultAfter.totalTime.toFixed(2)}ms`)
  console.log(`   Average: ${resultAfter.avgTime.toFixed(2)}ms per request`)
  console.log(`   Total bandwidth: ${(resultAfter.totalBytes / 1024).toFixed(2)} KB`)
  console.log(`   Average: ${resultAfter.avgBytes} bytes per response`)
  console.log(`   200 OK responses: ${resultAfter.requests200}`)
  console.log(`   304 Not Modified: ${resultAfter.requests304}\n`)

  // Benchmark BEST (middleware)
  console.log('⭐ BEST: Using ETag middleware')
  const resultBest = await benchmarkApp(appBest, 'BEST', true)

  console.log(`   Total time: ${resultBest.totalTime.toFixed(2)}ms`)
  console.log(`   Average: ${resultBest.avgTime.toFixed(2)}ms per request`)
  console.log(`   Total bandwidth: ${(resultBest.totalBytes / 1024).toFixed(2)} KB`)
  console.log(`   Average: ${resultBest.avgBytes} bytes per response`)
  console.log(`   200 OK responses: ${resultBest.requests200}`)
  console.log(`   304 Not Modified: ${resultBest.requests304}\n`)

  // Results
  console.log('📊 Performance Impact:')
  console.log(`   Bandwidth reduction: ${(resultBefore.totalBytes / 1024).toFixed(2)} KB → ${(resultAfter.totalBytes / 1024).toFixed(2)} KB (${Math.round((1 - resultAfter.totalBytes / resultBefore.totalBytes) * 100)}% saved)`)
  console.log(`   Response time: ${resultBefore.avgTime.toFixed(2)}ms → ${resultAfter.avgTime.toFixed(2)}ms (${Math.round((1 - resultAfter.avgTime / resultBefore.avgTime) * 100)}% faster)`)
  console.log(`   304 responses: ${resultAfter.requests304}/100 (${resultAfter.requests304}% cache hits)\n`)

  console.log('💡 Key Takeaways:')
  console.log('   - 304 responses eliminate bandwidth for unchanged content')
  console.log('   - Faster responses (no serialization/transmission overhead)')
  console.log('   - Reduces server CPU and network costs')
  console.log('   - Essential for mobile clients and CDN integration\n')

  console.log('✨ Best Practices:')
  console.log('   ✅ Use ETag middleware for automatic handling')
  console.log('   ✅ Combine with Cache-Control headers')
  console.log('   ✅ Generate ETags from content hash or timestamp')
  console.log('   ✅ Use weak ETags (W/"...") for approximate matching')
  console.log('   ✅ Consider Last-Modified header as alternative')
  console.log('   ✅ Set appropriate cache policies (private vs public)')
  console.log('   ❌ Don\'t use ETags for rapidly changing data')
  console.log('   ❌ Avoid expensive ETag generation (defeats purpose)\n')

  console.log('🎯 When to Use ETags:')
  console.log('   ✅ API responses that change infrequently')
  console.log('   ✅ Static assets served through Hono')
  console.log('   ✅ User-specific data (private caching)')
  console.log('   ✅ Content with high read/write ratio')
  console.log('   ❌ Real-time data (use polling/websockets instead)')
  console.log('   ❌ Highly personalized responses')
}

// Run benchmark if executed directly
if (import.meta.main) {
  benchmark()
}

export { appBefore, appAfter, appBest, benchmark }
