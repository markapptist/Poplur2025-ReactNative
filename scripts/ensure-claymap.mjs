#!/usr/bin/env node
// The clay map bundle is a build artifact, not source (see .gitignore). Metro
// require()s it at build time, so a build that starts without it fails deep
// inside the bundler with nothing that names the real problem. This says the
// real problem, before the build starts.
//
// It deliberately does NOT fetch anything. The zip carries the built web app
// with the VITE_ keys inlined, and the only bucket we publish to is
// world-readable — so the way to get this file is to build it from the web
// repo next door, which is the same command that publishes iOS and Android.

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const zip = resolve(here, '../src/assets/claymap/claymap.zip')
const manifestPath = resolve(here, '../src/assets/claymap/bundle.json')

const HOW = `
  Build it from the web repo (this also republishes iOS and Android):

      poplur-clay-map/scripts/sync-mobile.sh

  That writes ${'src/assets/claymap/claymap.zip'} here.
`

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

let stat
try {
  stat = statSync(zip)
} catch {
  console.error(`\nThe clay map bundle is missing.\n${HOW}`)
  process.exit(1)
}

// Size first: it is free, and a truncated or half-copied zip is the common
// failure. Only hash when the size already matches, since hashing 105MB on
// every build start is a real cost for a check that would usually pass.
if (stat.size !== manifest.bytes) {
  console.error(
    `\nThe clay map bundle is not the one this app expects.\n`
    + `  on disk:  ${stat.size} bytes\n`
    + `  expected: ${manifest.bytes} bytes (bundle v${manifest.bundleVersion})\n`
    + `\nIf you meant to ship a newer bundle, re-run the sync and commit the`
    + ` updated bundle.json.\n${HOW}`,
  )
  process.exit(1)
}

if (process.argv.includes('--verify-hash')) {
  const sha256 = createHash('sha256').update(readFileSync(zip)).digest('hex')
  if (sha256 !== manifest.sha256) {
    console.error(
      `\nThe clay map bundle has the right size but different contents.\n`
      + `  on disk:  ${sha256}\n`
      + `  expected: ${manifest.sha256}\n${HOW}`,
    )
    process.exit(1)
  }
  console.log(`clay map bundle v${manifest.bundleVersion} verified (sha256 ok)`)
} else {
  console.log(`clay map bundle v${manifest.bundleVersion} present (${stat.size} bytes)`)
}
