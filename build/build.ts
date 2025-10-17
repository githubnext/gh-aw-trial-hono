/*
  This script is heavily inspired by `built.ts` used in @kaze-style/react.
  https://github.com/taishinaritomi/kaze-style/blob/main/scripts/build.ts
  MIT License
  Copyright (c) 2022 Taishi Naritomi
*/

/// <reference types="bun-types/bun" />

import arg from 'arg'
import { $, stdout } from 'bun'
import { build } from 'esbuild'
import type { Plugin, PluginBuild, BuildOptions } from 'esbuild'
import * as glob from 'glob'
import fs from 'fs'
import path from 'path'
import { cleanupWorkers, removePrivateFields } from './remove-private-fields'
import { validateExports } from './validate-exports'

const args = arg({
  '--watch': Boolean,
})

const isWatch = args['--watch'] || false

const readJsonExports = (path: string) => JSON.parse(fs.readFileSync(path, 'utf-8')).exports

const [packageJsonExports, jsrJsonExports] = ['./package.json', './jsr.json'].map(readJsonExports)

// Validate exports of package.json and jsr.json
validateExports(packageJsonExports, jsrJsonExports, 'jsr.json')
validateExports(jsrJsonExports, packageJsonExports, 'package.json')

const entryPoints = glob.sync('./src/**/*.ts', {
  ignore: ['./src/**/*.test.ts', './src/mod.ts', './src/middleware.ts', './src/deno/**/*.ts'],
})

/*
  This plugin is inspired by the following.
  https://github.com/evanw/esbuild/issues/622#issuecomment-769462611
*/
const addExtension = (extension: string = '.js', fileExtension: string = '.ts'): Plugin => ({
  name: 'add-extension',
  setup(build: PluginBuild) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.importer) {
        const p = path.join(args.resolveDir, args.path)
        let tsPath = `${p}${fileExtension}`

        let importPath = ''
        if (fs.existsSync(tsPath)) {
          importPath = args.path + extension
        } else {
          tsPath = path.join(args.resolveDir, args.path, `index${fileExtension}`)
          if (fs.existsSync(tsPath)) {
            if (args.path.endsWith('/')) {
              importPath = `${args.path}index${extension}`
            } else {
              importPath = `${args.path}/index${extension}`
            }
          }
        }
        return { path: importPath, external: true }
      }
    })
  },
})

const commonOptions: BuildOptions = {
  watch: isWatch,
  entryPoints,
  logLevel: 'info',
  platform: 'node',
}

const timeStep = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  const start = performance.now()
  const result = await fn()
  const duration = performance.now() - start
  console.log(`[Build Timing] ${name}: ${duration.toFixed(0)}ms`)
  return result
}

const cjsBuild = () =>
  build({
    ...commonOptions,
    outbase: './src',
    outdir: './dist/cjs',
    format: 'cjs',
  })

const esmBuild = () =>
  build({
    ...commonOptions,
    bundle: true,
    outbase: './src',
    outdir: './dist',
    format: 'esm',
    plugins: [addExtension('.js')],
  })

// Run ESM build, CJS build, and TypeScript type generation in parallel
console.log('[Build Timing] Starting parallel build phase...')
const parallelStart = performance.now()
await Promise.all([
  timeStep('ESM Build', esmBuild),
  timeStep('CJS Build', cjsBuild),
  timeStep('TypeScript', () =>
    $`tsc ${
      isWatch ? '-w' : ''
    } --emitDeclarationOnly --declaration --project tsconfig.build.json`.nothrow()
  ),
])
console.log(
  `[Build Timing] Parallel build phase completed: ${(performance.now() - parallelStart).toFixed(
    0
  )}ms`
)

// Remove #private fields
console.log('[Build Timing] Starting private field removal...')
const privateFieldStart = performance.now()
const dtsEntries = glob.globSync('./dist/types/**/*.d.ts')
const writer = stdout.writer()
writer.write('\n')
let lastOutputLength = 0
let removedCount = 0

// Process in batches to reduce overhead
const BATCH_SIZE = 50
for (let i = 0; i < dtsEntries.length; i += BATCH_SIZE) {
  const batch = dtsEntries.slice(i, i + BATCH_SIZE)
  await Promise.all(
    batch.map(async (e) => {
      const content = await fs.promises.readFile(e, 'utf-8')
      const processed = await removePrivateFields(e, content)
      await fs.promises.writeFile(e, processed)

      const message = `Private fields removed(${++removedCount}/${dtsEntries.length}): ${e}`
      writer.write(`\r${' '.repeat(lastOutputLength)}`)
      lastOutputLength = message.length
      writer.write(`\r${message}`)
    })
  )
}

writer.write('\n')
cleanupWorkers()
console.log(
  `[Build Timing] Private field removal completed: ${(
    performance.now() - privateFieldStart
  ).toFixed(0)}ms`
)

const totalTime = performance.now() - parallelStart
console.log(`\n[Build Timing] Total build time: ${(totalTime / 1000).toFixed(2)}s`)
