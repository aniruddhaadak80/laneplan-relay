/**
 * The web app falls back to apps/web/lib/precomputed-walk.json when the host has no Python
 * interpreter. That is only acceptable if the fixture is genuinely what the engine produces, so
 * this test runs the real engine and demands an exact match.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

const network = JSON.parse(readFileSync(join(repoRoot, 'apps/web/lib/sample-network.json'), 'utf8'))
const fixture = JSON.parse(readFileSync(join(repoRoot, 'apps/web/lib/precomputed-walk.json'), 'utf8'))

function runEngine() {
  const child = spawnSync('python', ['-m', 'laneplan_relay'], {
    cwd: join(repoRoot, 'services/engine/src'),
    input: JSON.stringify({
      op: 'walk_relay_graph',
      input: { network, startFacility: 'NLRTM', startMinute: 0, maxLegs: 8 },
    }),
    encoding: 'utf8',
  })
  assert.equal(child.status, 0, child.stderr)
  return JSON.parse(child.stdout.trim())
}

test('the fixture records which engine produced it', () => {
  assert.match(fixture.generatedBy, /^laneplan_relay \d+\.\d+\.\d+$/)
})

test('the fixture matches a live engine run exactly', () => {
  const live = runEngine()
  assert.equal(live.ok, true)
  assert.deepEqual(fixture.value, live.value)
})

test('the fixture still finds the loop it claims to find', () => {
  // A fixture that quietly stopped detecting the cycle would be a silent regression, so assert
  // the specific closing lane rather than just "something is not null".
  assert.notEqual(fixture.value.cycle, null)
  assert.equal(fixture.value.cycle.laneId, 'ham-rtm')
  assert.equal(fixture.value.cycle.facility, 'NLRTM')
  assert.deepEqual(fixture.value.cycle.path, ['NLRTM', 'DEHAM', 'NLRTM'])
})

test('the walk is deterministic across separate engine processes', () => {
  const first = JSON.stringify(runEngine().value)
  const second = JSON.stringify(runEngine().value)
  assert.equal(first, second)
})
