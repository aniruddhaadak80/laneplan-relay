#!/usr/bin/env node
/**
 * Regenerates apps/web/lib/precomputed-walk.json by running the real Python engine.
 *
 * The web workspace calls the engine live whenever the host has a Python interpreter. On a
 * serverless Node runtime there is none, and rather than invent an answer the route falls back
 * to this fixture — which is why the fixture has to be genuinely engine-produced, and why a
 * test asserts it still matches a live engine run.
 *
 *   node scripts/generate-walk-fixture.mjs
 *
 * Refuses to run if the engine output does not match the sample network the web app ships.
 */

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const target = join(repoRoot, 'apps', 'web', 'lib', 'precomputed-walk.json')

// Read the sample network straight out of the web app, so the fixture can never describe a
// network the UI does not actually ship.
const network = JSON.parse(readFileSync(join(repoRoot, 'apps', 'web', 'lib', 'sample-network.json'), 'utf8'))
const startFacility = 'NLRTM'

const child = spawn('python', ['-m', 'laneplan_relay'], {
  cwd: join(repoRoot, 'services', 'engine', 'src'),
  stdio: ['pipe', 'pipe', 'inherit'],
})

let out = ''
child.stdout.on('data', (chunk) => (out += chunk.toString('utf8')))

child.on('close', (code) => {
  if (code !== 0) {
    process.stderr.write(`engine exited ${code}\n`)
    process.exit(1)
  }
  const response = JSON.parse(out.trim())
  if (response.ok !== true) {
    process.stderr.write(`engine refused the sample network: ${JSON.stringify(response.error)}\n`)
    process.exit(1)
  }

  const fixture = {
    generatedBy: `laneplan_relay ${response.value.engine}`,
    note: 'Produced by the deterministic engine, not by hand. Regenerate with scripts/generate-walk-fixture.mjs',
    startFacility,
    value: response.value,
  }
  writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`)
  process.stdout.write(
    `wrote ${target}\n  engine ${response.value.engine} · cycle ${response.value.cycle?.laneId ?? 'none'} · plans ${response.value.planCount}\n`,
  )
})

child.stdin.end(
  JSON.stringify({
    op: 'walk_relay_graph',
    input: { network, startFacility, startMinute: 0, maxLegs: 8 },
  }),
)
