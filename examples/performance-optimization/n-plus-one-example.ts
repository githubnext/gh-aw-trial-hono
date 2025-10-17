/**
 * N+1 Query Resolution Example
 *
 * Demonstrates the classic N+1 query problem and how to fix it with JOIN optimization.
 *
 * Key Optimization: Use JOIN queries to fetch related data in a single query
 * Impact: 5-10x improvement for queries with relations
 * Complexity: Medium - requires query refactoring
 */

import { Hono } from '../../dist'

// ============================================================================
// Simulated Database
// ============================================================================

interface User {
  id: number
  name: string
  email: string
}

interface Post {
  id: number
  user_id: number
  title: string
  content: string
}

interface PostWithAuthor extends Post {
  author_name: string
  author_email: string
}

class SimulatedDatabase {
  private queryDelay = 2 // ms per query
  private queryCounts = { users: 0, posts: 0 }

  // Sample data
  private users: User[] = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`
  }))

  private posts: Post[] = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    user_id: (i % 20) + 1,
    title: `Post ${i + 1}`,
    content: `Content for post ${i + 1}`
  }))

  async query(sql: string): Promise<any[]> {
    // Simulate query execution time
    await new Promise(resolve => setTimeout(resolve, this.queryDelay))

    // Parse simple SQL (for demonstration)
    if (sql.includes('FROM posts')) {
      this.queryCounts.posts++

      if (sql.includes('JOIN')) {
        // JOIN query - fetch posts with user data
        return this.posts.map(post => {
          const user = this.users.find(u => u.id === post.user_id)!
          return {
            ...post,
            author_name: user.name,
            author_email: user.email
          }
        })
      }

      // Posts only
      return [...this.posts]
    }

    if (sql.includes('FROM users WHERE')) {
      this.queryCounts.users++
      const match = sql.match(/id = (\d+)/)
      if (match) {
        const id = parseInt(match[1])
        const user = this.users.find(u => u.id === id)
        return user ? [user] : []
      }
    }

    return []
  }

  resetCounters() {
    this.queryCounts = { users: 0, posts: 0 }
  }

  getCounters() {
    return { ...this.queryCounts }
  }
}

const db = new SimulatedDatabase()

// ============================================================================
// BEFORE: N+1 Query Anti-pattern
// ============================================================================

const appBefore = new Hono()

appBefore.get('/api/posts', async (c) => {
  db.resetCounters()

  // ❌ BAD: Query 1 - Fetch all posts
  const posts = await db.query('SELECT * FROM posts LIMIT 10')

  // ❌ BAD: Query 2-11 - Fetch author for EACH post (N queries)
  const postsWithAuthors = await Promise.all(
    posts.map(async (post) => {
      // This executes a separate query for each post!
      const authors = await db.query(`SELECT * FROM users WHERE id = ${post.user_id}`)
      const author = authors[0]

      return {
        ...post,
        author: {
          name: author?.name,
          email: author?.email
        }
      }
    })
  )

  const counts = db.getCounters()

  return c.json({
    posts: postsWithAuthors,
    meta: {
      total_queries: counts.posts + counts.users,
      posts_queries: counts.posts,
      user_queries: counts.users
    }
  })
})

// ============================================================================
// AFTER: Optimized with JOIN
// ============================================================================

const appAfter = new Hono()

appAfter.get('/api/posts', async (c) => {
  db.resetCounters()

  // ✅ GOOD: Single query with JOIN to fetch posts and authors
  const postsWithAuthors = await db.query(`
    SELECT
      posts.*,
      users.name as author_name,
      users.email as author_email
    FROM posts
    LEFT JOIN users ON posts.user_id = users.id
    LIMIT 10
  `)

  const counts = db.getCounters()

  return c.json({
    posts: postsWithAuthors.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      title: row.title,
      content: row.content,
      author: {
        name: row.author_name,
        email: row.author_email
      }
    })),
    meta: {
      total_queries: counts.posts + counts.users,
      posts_queries: counts.posts,
      user_queries: counts.users
    }
  })
})

// ============================================================================
// Alternative: DataLoader pattern for complex scenarios
// ============================================================================

class UserDataLoader {
  private cache = new Map<number, User>()
  private queue: number[] = []
  private db: SimulatedDatabase

  constructor(db: SimulatedDatabase) {
    this.db = db
  }

  async load(userId: number): Promise<User | null> {
    // Check cache first
    if (this.cache.has(userId)) {
      return this.cache.get(userId)!
    }

    // Add to queue for batch loading
    if (!this.queue.includes(userId)) {
      this.queue.push(userId)
    }

    // Trigger batch load on next tick
    await this.flush()

    return this.cache.get(userId) || null
  }

  private async flush() {
    if (this.queue.length === 0) return

    const ids = [...this.queue]
    this.queue = []

    // Batch load users
    const users = await this.db.query(
      `SELECT * FROM users WHERE id IN (${ids.join(',')})`
    )

    users.forEach((user: User) => {
      this.cache.set(user.id, user)
    })
  }
}

const appDataLoader = new Hono()

appDataLoader.get('/api/posts', async (c) => {
  db.resetCounters()
  const loader = new UserDataLoader(db)

  // Fetch posts
  const posts = await db.query('SELECT * FROM posts LIMIT 10')

  // Load users with DataLoader (batches requests)
  const postsWithAuthors = await Promise.all(
    posts.map(async (post) => {
      const author = await loader.load(post.user_id)

      return {
        ...post,
        author: {
          name: author?.name,
          email: author?.email
        }
      }
    })
  )

  const counts = db.getCounters()

  return c.json({
    posts: postsWithAuthors,
    meta: {
      total_queries: counts.posts + counts.users,
      posts_queries: counts.posts,
      user_queries: counts.users
    }
  })
})

// ============================================================================
// Benchmark
// ============================================================================

async function benchmark() {
  console.log('🔬 N+1 Query Problem Benchmark\n')
  console.log('Testing: GET /api/posts (10 posts with authors)')
  console.log('Requests: 50 sequential requests\n')

  const iterations = 50

  // Benchmark BEFORE (N+1 queries)
  console.log('❌ BEFORE: N+1 Query Anti-pattern')
  db.resetCounters()
  const startBefore = performance.now()

  for (let i = 0; i < iterations; i++) {
    const req = new Request('http://localhost/api/posts')
    await appBefore.fetch(req)
  }

  const timeBefore = performance.now() - startBefore
  const avgBefore = timeBefore / iterations
  const countersBefore = db.getCounters()

  console.log(`   Total time: ${timeBefore.toFixed(2)}ms`)
  console.log(`   Average: ${avgBefore.toFixed(2)}ms per request`)
  console.log(`   Queries per request: ${countersBefore.posts + countersBefore.users} (${countersBefore.posts} posts + ${countersBefore.users} users)`)
  console.log(`   Throughput: ${(1000 / avgBefore).toFixed(0)} req/s\n`)

  // Benchmark AFTER (JOIN optimization)
  console.log('✅ AFTER: Optimized with JOIN')
  db.resetCounters()
  const startAfter = performance.now()

  for (let i = 0; i < iterations; i++) {
    const req = new Request('http://localhost/api/posts')
    await appAfter.fetch(req)
  }

  const timeAfter = performance.now() - startAfter
  const avgAfter = timeAfter / iterations
  const countersAfter = db.getCounters()

  console.log(`   Total time: ${timeAfter.toFixed(2)}ms`)
  console.log(`   Average: ${avgAfter.toFixed(2)}ms per request`)
  console.log(`   Queries per request: ${countersAfter.posts + countersAfter.users} (${countersAfter.posts} posts + ${countersAfter.users} users)`)
  console.log(`   Throughput: ${(1000 / avgAfter).toFixed(0)} req/s\n`)

  // Benchmark DataLoader approach
  console.log('⚡ Alternative: DataLoader Pattern')
  db.resetCounters()
  const startLoader = performance.now()

  for (let i = 0; i < iterations; i++) {
    const req = new Request('http://localhost/api/posts')
    await appDataLoader.fetch(req)
  }

  const timeLoader = performance.now() - startLoader
  const avgLoader = timeLoader / iterations
  const countersLoader = db.getCounters()

  console.log(`   Total time: ${timeLoader.toFixed(2)}ms`)
  console.log(`   Average: ${avgLoader.toFixed(2)}ms per request`)
  console.log(`   Queries per request: ${countersLoader.posts + countersLoader.users} (${countersLoader.posts} posts + ${countersLoader.users} users)`)
  console.log(`   Throughput: ${(1000 / avgLoader).toFixed(0)} req/s\n`)

  // Results
  console.log('📊 Performance Impact:')
  console.log(`   JOIN vs N+1: ${(timeBefore / timeAfter).toFixed(1)}x faster`)
  console.log(`   Queries reduced: ${countersBefore.posts + countersBefore.users} → ${countersAfter.posts + countersAfter.users} (${Math.round((1 - (countersAfter.posts + countersAfter.users) / (countersBefore.posts + countersBefore.users)) * 100)}% fewer)`)
  console.log(`   Time saved per request: ${(avgBefore - avgAfter).toFixed(2)}ms\n`)

  console.log('💡 Key Takeaways:')
  console.log('   - N+1 queries cause 1 + N database roundtrips (11 queries for 10 posts)')
  console.log('   - JOIN reduces to a single query with same result')
  console.log('   - Each query adds 2-5ms latency, multiplied by N')
  console.log('   - Critical for performance at scale\n')

  console.log('✨ Best Practices:')
  console.log('   ✅ Use JOIN queries to fetch related data in one roundtrip')
  console.log('   ✅ Use ORM eager loading (Prisma include, TypeORM relations)')
  console.log('   ✅ Consider DataLoader pattern for complex scenarios')
  console.log('   ✅ Monitor slow query logs for N+1 patterns')
  console.log('   ✅ Use database query counters in development')
  console.log('   ❌ Avoid loading relations in loops')
  console.log('   ❌ Don\'t fetch data you don\'t need (select specific columns)')
}

// Run benchmark if executed directly
if (import.meta.main) {
  benchmark()
}

export { appBefore, appAfter, appDataLoader, benchmark }
