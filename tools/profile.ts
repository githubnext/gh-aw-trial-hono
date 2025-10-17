#!/usr/bin/env bun
/**
 * Performance Profiling Tool for Hono
 *
 * Quick CPU profiling for identifying performance bottlenecks.
 * Supports multiple runtimes and output formats.
 *
 * Usage:
 *   bun run tools/profile.ts [target] [options]
 *
 * Examples:
 *   bun run tools/profile.ts benchmarks/http-server/server.ts
 *   bun run tools/profile.ts --duration=10 benchmarks/http-server/server.ts
 *   node --cpu-prof tools/profile-node.js benchmarks/http-server/server.ts
 */

import { parseArgs } from 'node:util'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'

interface ProfileOptions {
  target?: string
  duration: number
  runtime: 'bun' | 'node'
  output: string
  help: boolean
  flamegraph: boolean
  compare?: string
}

// Check if we're running in Bun or Node
const isRunningInBun = typeof Bun !== 'undefined'

const HELP_TEXT = `
Performance Profiling Tool for Hono

USAGE:
  bun run tools/profile.ts [OPTIONS] <target>

OPTIONS:
  --duration=N      Duration to profile in seconds (default: 10)
  --runtime=RUNTIME Runtime to use: node|bun (default: node, recommended)
  --output=DIR      Output directory for profile data (default: ./profiles)
  --flamegraph      Generate flamegraph (requires speedscope CLI)
  --compare=FILE    Compare with previous profile
  --help            Show this help message

EXAMPLES:
  # Profile HTTP server for 10 seconds (Node.js, recommended)
  bun run tools/profile.ts benchmarks/profile-target.ts

  # Profile with custom duration
  bun run tools/profile.ts --duration=30 benchmarks/profile-target.ts

  # Profile with Bun runtime (experimental)
  bun run tools/profile.ts --runtime=bun benchmarks/profile-target.ts

  # Generate flamegraph visualization
  bun run tools/profile.ts --flamegraph benchmarks/http-server/server.ts

  # Compare with previous profile
  bun run tools/profile.ts --compare=profiles/baseline.cpuprofile benchmarks/http-server/server.ts

SUPPORTED TARGETS:
  - HTTP benchmarks (benchmarks/http-server/*)
  - Router benchmarks (benchmarks/routers/*)
  - Custom scripts

OUTPUT:
  Profiles are saved to ./profiles/ directory with timestamp
  - *.cpuprofile - Chrome DevTools compatible CPU profile
  - *.txt - Text summary of hot functions
  - *.json - Structured profile data

VIEWING PROFILES:
  1. Chrome DevTools: chrome://inspect > "Open dedicated DevTools for Node"
  2. Speedscope: https://speedscope.app (drag & drop .cpuprofile)
  3. VS Code: JavaScript Profiler extension

See .github/copilot/instructions/profiling-guide.md for detailed workflows.
`

function parseOptions(): ProfileOptions {
  try {
    const { values, positionals } = parseArgs({
      options: {
        duration: { type: 'string', default: '10' },
        runtime: { type: 'string', default: 'node' },
        output: { type: 'string', default: './profiles' },
        flamegraph: { type: 'boolean', default: false },
        compare: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: true,
    })

    return {
      target: positionals[0],
      duration: parseInt(values.duration as string),
      runtime: values.runtime as 'bun' | 'node',
      output: values.output as string,
      help: values.help as boolean,
      flamegraph: values.flamegraph as boolean,
      compare: values.compare as string | undefined,
    }
  } catch (err) {
    console.error('Error parsing arguments:', err)
    console.log(HELP_TEXT)
    process.exit(1)
  }
}

async function profileWithBun(target: string, duration: number, outputDir: string): Promise<string> {
  console.log(`📊 Profiling with Bun for ${duration}s...`)
  console.log(`   Target: ${target}`)
  console.log(`   ⚠️  Note: Bun profiling uses inspector API (experimental)`)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  const profileName = `${basename(target, '.ts')}-${timestamp}.cpuprofile`
  const profilePath = join(outputDir, profileName)

  // Create a wrapper script that uses inspector API
  const wrapperPath = join(outputDir, '_profile-wrapper.ts')
  const wrapperScript = `
import { Session } from 'bun:inspector'
import { writeFileSync } from 'fs'

const session = new Session()
session.connect()

// Start CPU profiling
session.post('Profiler.enable')
session.post('Profiler.start')

console.log('Profiling started...')

// Import and run target
import('${resolve(target)}').catch(err => {
  console.error('Target error:', err)
})

// Stop profiling after duration
setTimeout(async () => {
  const { profile } = await session.post('Profiler.stop')
  writeFileSync('${profilePath}', JSON.stringify(profile))
  console.log('\\nProfile saved')
  process.exit(0)
}, ${duration * 1000})
`

  try {
    writeFileSync(wrapperPath, wrapperScript)

    return new Promise((resolve, reject) => {
      const child = spawn('bun', [wrapperPath], {
        stdio: 'inherit',
      })

      child.on('close', (code) => {
        // Clean up wrapper
        try {
          const fs = require('fs')
          fs.unlinkSync(wrapperPath)
        } catch {}

        if (code === 0 || code === null) {
          if (existsSync(profilePath)) {
            console.log(`✅ Profile saved: ${profilePath}`)
            resolve(profilePath)
          } else {
            reject(new Error('Profile file not created'))
          }
        } else {
          reject(new Error(`Profiling failed with code ${code}`))
        }
      })

      child.on('error', reject)
    })
  } catch (err) {
    throw new Error(`Failed to create profiling wrapper: ${err}`)
  }
}

async function profileWithNode(target: string, duration: number, outputDir: string): Promise<string> {
  console.log(`📊 Profiling with Node.js for ${duration}s...`)
  console.log(`   Target: ${target}`)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  const profileName = `${basename(target, '.ts')}-${timestamp}.cpuprofile`
  const profilePath = join(outputDir, profileName)

  return new Promise((resolve, reject) => {
    // Node profiling: --cpu-prof flag
    const child = spawn('node', [
      '--cpu-prof',
      '--cpu-prof-dir=' + outputDir,
      '--cpu-prof-name=' + profileName,
      target
    ], {
      stdio: 'inherit',
    })

    // Kill after duration
    const timeout = setTimeout(() => {
      child.kill('SIGINT')
    }, duration * 1000)

    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0 || code === null || code === 130) {
        console.log(`✅ Profile saved: ${profilePath}`)
        resolve(join(outputDir, profileName))
      } else {
        reject(new Error(`Profiling failed with code ${code}`))
      }
    })

    child.on('error', reject)
  })
}

interface HotFunction {
  name: string
  selfTime: number
  totalTime: number
  percentage: number
}

function analyzeProfile(profilePath: string): HotFunction[] {
  try {
    const profileData = JSON.parse(readFileSync(profilePath, 'utf-8'))

    // Extract hot functions from CPU profile
    const nodes = profileData.nodes || []
    const samples = profileData.samples || []
    const timeDeltas = profileData.timeDeltas || []

    if (nodes.length === 0) {
      return []
    }

    // Calculate time spent in each function
    const functionTime = new Map<number, { self: number; total: number; name: string }>()

    // Initialize all nodes
    nodes.forEach((node: any, index: number) => {
      const callFrame = node.callFrame || {}
      functionTime.set(node.id || index, {
        self: 0,
        total: 0,
        name: callFrame.functionName || '(anonymous)'
      })
    })

    // Accumulate time from samples
    let totalTime = 0
    samples.forEach((sampleNodeId: number, index: number) => {
      const timeDelta = timeDeltas[index] || 0
      totalTime += timeDelta

      const func = functionTime.get(sampleNodeId)
      if (func) {
        func.self += timeDelta
        func.total += timeDelta
      }
    })

    // Convert to array and sort by self time
    const hotFunctions: HotFunction[] = Array.from(functionTime.values())
      .map(f => ({
        name: f.name,
        selfTime: f.self,
        totalTime: f.total,
        percentage: totalTime > 0 ? (f.self / totalTime) * 100 : 0
      }))
      .filter(f => f.selfTime > 0)
      .sort((a, b) => b.selfTime - a.selfTime)
      .slice(0, 20) // Top 20

    return hotFunctions
  } catch (err) {
    console.warn('⚠️  Could not analyze profile:', err)
    return []
  }
}

function printAnalysis(hotFunctions: HotFunction[]) {
  if (hotFunctions.length === 0) {
    console.log('\n⚠️  No profile data available for analysis')
    return
  }

  console.log('\n📈 Hot Functions (Top 20 by self time):')
  console.log('─'.repeat(80))
  console.log('Function Name'.padEnd(50) + 'Self Time'.padEnd(15) + 'Percentage')
  console.log('─'.repeat(80))

  hotFunctions.forEach((func) => {
    const name = func.name.slice(0, 48)
    const selfTime = `${(func.selfTime / 1000).toFixed(2)}ms`
    const percentage = `${func.percentage.toFixed(1)}%`
    console.log(name.padEnd(50) + selfTime.padEnd(15) + percentage)
  })

  console.log('─'.repeat(80))
  console.log(`\n💡 Focus optimization efforts on functions with >5% self time`)
}

function compareProfiles(baselinePath: string, currentPath: string) {
  console.log('\n🔍 Comparing profiles...')

  const baselineHot = analyzeProfile(baselinePath)
  const currentHot = analyzeProfile(currentPath)

  if (baselineHot.length === 0 || currentHot.length === 0) {
    console.log('⚠️  Cannot compare: insufficient profile data')
    return
  }

  console.log('\n📊 Function Time Changes:')
  console.log('─'.repeat(90))
  console.log('Function Name'.padEnd(50) + 'Baseline'.padEnd(12) + 'Current'.padEnd(12) + 'Change')
  console.log('─'.repeat(90))

  // Build maps for comparison
  const baselineMap = new Map(baselineHot.map(f => [f.name, f]))
  const currentMap = new Map(currentHot.map(f => [f.name, f]))

  // Get all unique function names
  const allFunctions = new Set([...baselineMap.keys(), ...currentMap.keys()])

  const changes: Array<{name: string; baselineTime: number; currentTime: number; change: number}> = []

  allFunctions.forEach(name => {
    const baseline = baselineMap.get(name)
    const current = currentMap.get(name)

    if (baseline && current) {
      const change = ((current.selfTime - baseline.selfTime) / baseline.selfTime) * 100
      changes.push({
        name,
        baselineTime: baseline.selfTime,
        currentTime: current.selfTime,
        change
      })
    }
  })

  // Sort by absolute change magnitude
  changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))

  changes.slice(0, 15).forEach(({ name, baselineTime, currentTime, change }) => {
    const displayName = name.slice(0, 48)
    const baselineStr = `${(baselineTime / 1000).toFixed(2)}ms`
    const currentStr = `${(currentTime / 1000).toFixed(2)}ms`
    const changeStr = `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
    const marker = Math.abs(change) > 10 ? (change > 0 ? '🔴' : '🟢') : '⚪'

    console.log(displayName.padEnd(50) + baselineStr.padEnd(12) + currentStr.padEnd(12) + changeStr + ' ' + marker)
  })

  console.log('─'.repeat(90))
  console.log('\n🟢 = Improved   🔴 = Regressed   ⚪ = Small change (<10%)')
}

async function generateFlamegraph(profilePath: string) {
  console.log('\n🔥 Generating flamegraph...')

  // Check if speedscope is available
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('speedscope', ['--version'], { stdio: 'ignore' })
      child.on('close', (code) => {
        if (code === 0) resolve(null)
        else reject(new Error('speedscope not found'))
      })
      child.on('error', reject)
    })

    // Open with speedscope
    const child = spawn('speedscope', [profilePath], {
      stdio: 'inherit',
      detached: true
    })

    child.unref()
    console.log('✅ Opened in speedscope')
  } catch (err) {
    console.log('⚠️  speedscope not installed')
    console.log('   Install: npm install -g speedscope')
    console.log('   Or view online: https://speedscope.app')
    console.log(`   Drag and drop: ${profilePath}`)
  }
}

async function main() {
  const options = parseOptions()

  if (options.help) {
    console.log(HELP_TEXT)
    process.exit(0)
  }

  if (!options.target) {
    console.error('Error: Target file required')
    console.log(HELP_TEXT)
    process.exit(1)
  }

  const targetPath = resolve(options.target)
  if (!existsSync(targetPath)) {
    console.error(`Error: Target file not found: ${targetPath}`)
    process.exit(1)
  }

  // Ensure output directory exists
  if (!existsSync(options.output)) {
    mkdirSync(options.output, { recursive: true })
  }

  console.log('🚀 Hono Performance Profiler')
  console.log('─'.repeat(80))

  try {
    // Profile based on runtime
    const profilePath = options.runtime === 'node'
      ? await profileWithNode(targetPath, options.duration, options.output)
      : await profileWithBun(targetPath, options.duration, options.output)

    // Analyze profile
    const hotFunctions = analyzeProfile(profilePath)
    printAnalysis(hotFunctions)

    // Save text summary
    const summaryPath = profilePath.replace('.cpuprofile', '.txt')
    const summary = hotFunctions
      .map(f => `${f.name}: ${(f.selfTime / 1000).toFixed(2)}ms (${f.percentage.toFixed(1)}%)`)
      .join('\n')
    writeFileSync(summaryPath, summary)
    console.log(`\n📄 Summary saved: ${summaryPath}`)

    // Compare if baseline provided
    if (options.compare) {
      const baselinePath = resolve(options.compare)
      if (existsSync(baselinePath)) {
        compareProfiles(baselinePath, profilePath)
      } else {
        console.warn(`⚠️  Baseline not found: ${baselinePath}`)
      }
    }

    // Generate flamegraph
    if (options.flamegraph) {
      await generateFlamegraph(profilePath)
    }

    console.log('\n✅ Profiling complete!')
    console.log(`\n📂 View profile:`)
    console.log(`   Chrome DevTools: chrome://inspect`)
    console.log(`   Speedscope: https://speedscope.app`)
    console.log(`   Profile file: ${profilePath}`)

  } catch (err) {
    console.error('❌ Profiling failed:', err)
    process.exit(1)
  }
}

main()
