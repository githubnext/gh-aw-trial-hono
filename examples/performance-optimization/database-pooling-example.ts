/**
 * Database Connection Pooling Example
 *
 * Demonstrates the performance impact of proper database connection pooling
 * vs creating new connections for each request.
 *
 * Key Optimization: Reuse database connections instead of creating new ones
 * Impact: 10-20x improvement for database queries
 * Complexity: Low - simple pattern change
 */

import { Hono } from '../../dist'

// ============================================================================
// Simulated Database (for demonstration purposes)
// ============================================================================

interface DBConnection {
  id: number
  query: (sql: string) => Promise<any[]>
  close: () => Promise<void>
}

class SimulatedDatabase {
  private connectionId = 0
  private connectionDelay = 5 // ms to simulate connection overhead

  async createConnection(): Promise<DBConnection> {
    // Simulate connection establishment overhead
    await new Promise(resolve => setTimeout(resolve, this.connectionDelay))

    const id = ++this.connectionId

    return {
      id,
      query: async (sql: string) => {
        // Simulate query execution (1ms)
        await new Promise(resolve => setTimeout(resolve, 1))
        return [{ id: 1, name: 'Test User', email: 'test@example.com' }]
      },
      close: async () => {
        // Simulate connection cleanup
        await new Promise(resolve => setTimeout(resolve, 1))
      }
    }
  }
}

class ConnectionPool {
  private pool: DBConnection[] = []
  private inUse: Set<number> = new Set()
  private db: SimulatedDatabase
  private maxConnections = 10

  constructor(db: SimulatedDatabase) {
    this.db = db
  }

  async initialize() {
    // Pre-create initial connections
    for (let i = 0; i < 5; i++) {
      const conn = await this.db.createConnection()
      this.pool.push(conn)
    }
  }

  async acquire(): Promise<DBConnection> {
    // Try to find available connection
    const available = this.pool.find(conn => !this.inUse.has(conn.id))

    if (available) {
      this.inUse.add(available.id)
      return available
    }

    // Create new connection if under limit
    if (this.pool.length < this.maxConnections) {
      const conn = await this.db.createConnection()
      this.pool.push(conn)
      this.inUse.add(conn.id)
      return conn
    }

    // Wait for connection to become available
    await new Promise(resolve => setTimeout(resolve, 10))
    return this.acquire()
  }

  release(conn: DBConnection) {
    this.inUse.delete(conn.id)
  }

  async closeAll() {
    await Promise.all(this.pool.map(conn => conn.close()))
    this.pool = []
    this.inUse.clear()
  }
}

// ============================================================================
// BEFORE: Anti-pattern - Creating new connection per request
// ============================================================================

const db = new SimulatedDatabase()

const appBefore = new Hono()

appBefore.get('/api/users/:id', async (c) => {
  // ❌ BAD: Create new connection for every request
  const conn = await db.createConnection()

  try {
    const users = await conn.query(`SELECT * FROM users WHERE id = ${c.req.param('id')}`)
    return c.json({ user: users[0] })
  } finally {
    await conn.close()
  }
})

appBefore.get('/api/users', async (c) => {
  // ❌ BAD: New connection again
  const conn = await db.createConnection()

  try {
    const users = await conn.query('SELECT * FROM users LIMIT 10')
    return c.json({ users })
  } finally {
    await conn.close()
  }
})

// ============================================================================
// AFTER: Optimized - Using connection pool
// ============================================================================

const pool = new ConnectionPool(db)
await pool.initialize()

const appAfter = new Hono()

appAfter.get('/api/users/:id', async (c) => {
  // ✅ GOOD: Acquire connection from pool
  const conn = await pool.acquire()

  try {
    const users = await conn.query(`SELECT * FROM users WHERE id = ${c.req.param('id')}`)
    return c.json({ user: users[0] })
  } finally {
    pool.release(conn)
  }
})

appAfter.get('/api/users', async (c) => {
  // ✅ GOOD: Reuse pooled connections
  const conn = await pool.acquire()

  try {
    const users = await conn.query('SELECT * FROM users LIMIT 10')
    return c.json({ users })
  } finally {
    pool.release(conn)
  }
})

// ============================================================================
// Even Better: Middleware for automatic connection management
// ============================================================================

const appBest = new Hono()

// Middleware to automatically handle connection lifecycle
appBest.use('*', async (c, next) => {
  const conn = await pool.acquire()
  c.set('db', conn)

  try {
    await next()
  } finally {
    pool.release(conn)
  }
})

appBest.get('/api/users/:id', async (c) => {
  // ✅ BEST: Connection already available via middleware
  const conn = c.get('db') as DBConnection
  const users = await conn.query(`SELECT * FROM users WHERE id = ${c.req.param('id')}`)
  return c.json({ user: users[0] })
})

appBest.get('/api/users', async (c) => {
  // ✅ BEST: Clean handler code
  const conn = c.get('db') as DBConnection
  const users = await conn.query('SELECT * FROM users LIMIT 10')
  return c.json({ users })
})

// ============================================================================
// Benchmark
// ============================================================================

async function benchmark() {
  console.log('🔬 Database Connection Pooling Benchmark\n')
  console.log('Testing: GET /api/users/1')
  console.log('Requests: 100 sequential requests\n')

  const iterations = 100

  // Benchmark BEFORE (new connection per request)
  console.log('❌ BEFORE: Creating new connection per request')
  const startBefore = performance.now()

  for (let i = 0; i < iterations; i++) {
    const req = new Request('http://localhost/api/users/1')
    await appBefore.fetch(req)
  }

  const timeBefore = performance.now() - startBefore
  const avgBefore = timeBefore / iterations

  console.log(`   Total time: ${timeBefore.toFixed(2)}ms`)
  console.log(`   Average: ${avgBefore.toFixed(2)}ms per request`)
  console.log(`   Throughput: ${(1000 / avgBefore).toFixed(0)} req/s\n`)

  // Benchmark AFTER (connection pooling)
  console.log('✅ AFTER: Using connection pool')
  const startAfter = performance.now()

  for (let i = 0; i < iterations; i++) {
    const req = new Request('http://localhost/api/users/1')
    await appAfter.fetch(req)
  }

  const timeAfter = performance.now() - startAfter
  const avgAfter = timeAfter / iterations

  console.log(`   Total time: ${timeAfter.toFixed(2)}ms`)
  console.log(`   Average: ${avgAfter.toFixed(2)}ms per request`)
  console.log(`   Throughput: ${(1000 / avgAfter).toFixed(0)} req/s\n`)

  // Benchmark BEST (middleware + pooling)
  console.log('⭐ BEST: Middleware + connection pool')
  const startBest = performance.now()

  for (let i = 0; i < iterations; i++) {
    const req = new Request('http://localhost/api/users/1')
    await appBest.fetch(req)
  }

  const timeBest = performance.now() - startBest
  const avgBest = timeBest / iterations

  console.log(`   Total time: ${timeBest.toFixed(2)}ms`)
  console.log(`   Average: ${avgBest.toFixed(2)}ms per request`)
  console.log(`   Throughput: ${(1000 / avgBest).toFixed(0)} req/s\n`)

  // Results
  console.log('📊 Performance Impact:')
  console.log(`   AFTER vs BEFORE: ${(timeBefore / timeAfter).toFixed(1)}x faster`)
  console.log(`   BEST vs BEFORE: ${(timeBefore / timeBest).toFixed(1)}x faster`)
  console.log(`   Time saved per request: ${(avgBefore - avgBest).toFixed(2)}ms\n`)

  console.log('💡 Key Takeaways:')
  console.log('   - Connection pooling eliminates 5-10ms overhead per request')
  console.log('   - Middleware pattern reduces boilerplate and prevents leaks')
  console.log('   - For 1000 req/s, pooling saves 5-10 seconds of CPU time per second')
  console.log('   - Essential for production database applications\n')

  console.log('✨ Best Practices:')
  console.log('   ✅ Use connection pooling (pg.Pool, mysql2/pool, prisma, etc.)')
  console.log('   ✅ Pre-warm pool with initial connections')
  console.log('   ✅ Set reasonable min/max pool sizes (e.g., 5-20)')
  console.log('   ✅ Always release connections in finally blocks')
  console.log('   ✅ Use middleware for automatic connection management')
  console.log('   ✅ Monitor pool exhaustion and connection leaks')

  // Cleanup
  await pool.closeAll()
}

// Run benchmark if executed directly
if (import.meta.main) {
  benchmark()
}

export { appBefore, appAfter, appBest, benchmark }
