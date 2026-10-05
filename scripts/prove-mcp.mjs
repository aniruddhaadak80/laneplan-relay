#!/usr/bin/env node
/**
 * Proves the MCP surface end to end, over a real stdio transport, with the real SDK client.
 *
 * This is not a unit test and not a mock: it launches `laneplan mcp serve` as a child process,
 * performs the MCP handshake, lists tools, and calls two of them — one of which reaches the
 * Python engine. It is the proof that a fresh install can be driven by another agent.
 *
 *   node scripts/prove-mcp.mjs
 *
 * Exits non-zero on any failure so CI can depend on it.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

const NETWORK = {
  facilities: [
    { id: 'NLRTM', name: 'Rotterdam terminal', kind: 'port' },
    { id: 'DEHAM', name: 'Hamburg cross-dock', kind: 'crossdock' },
    { id: 'FRAXF', name: 'Frankfurt hub', kind: 'hub' },
    { id: 'STRIG', name: 'Stuttgart last-mile', kind: 'lastmile' },
  ],
  lanes: [
    {
      id: 'rtm-ham',
      fromFacility: 'NLRTM',
      toFacility: 'DEHAM',
      dwellMinutes: 45,
      transitMinutes: 420,
      openMinute: 0,
      closeMinute: 10080,
    },
    {
      id: 'ham-fra',
      fromFacility: 'DEHAM',
      toFacility: 'FRAXF',
      dwellMinutes: 90,
      transitMinutes: 300,
      openMinute: 0,
      closeMinute: 10080,
    },
    {
      id: 'fra-str',
      fromFacility: 'FRAXF',
      toFacility: 'STRIG',
      dwellMinutes: 60,
      transitMinutes: 180,
      openMinute: 0,
      closeMinute: 10080,
    },
    // The mistake this product exists to catch: a lane that returns to an origin already
    // visited, which a naive planner will happily walk forever.
    {
      id: 'str-ham',
      fromFacility: 'STRIG',
      toFacility: 'DEHAM',
      dwellMinutes: 30,
      transitMinutes: 240,
      openMinute: 0,
      closeMinute: 10080,
    },
  ],
}

const checks = []
function check(name, passed, detail) {
  checks.push({ name, passed, detail })
  const mark = passed ? 'PASS' : 'FAIL'
  process.stdout.write(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}\n`)
}

async function main() {
  process.stdout.write('MCP proof: stdio transport, real SDK client\n\n')

  const client = new Client({ name: 'laneplan-relay-proof', version: '0.1.0' }, { capabilities: {} })

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(repoRoot, 'packages', 'cli', 'dist', 'bin.js'), 'mcp', 'serve'],
    cwd: repoRoot,
    stderr: 'pipe',
  })

  await client.connect(transport)
  const serverInfo = client.getServerVersion() ?? { name: 'unknown', version: 'unknown' }
  check('initialize', true, `server ${serverInfo.name} v${serverInfo.version}`)

  const listed = await client.listTools()
  const names = listed.tools.map((tool) => tool.name).sort()
  check(
    'tools/list returns the relay tools',
    ['walk_relay_graph', 'find_cycles', 'score_handoff'].every((name) => names.includes(name)),
    `${names.length} tools: ${names.join(', ')}`,
  )

  const walkSchema = listed.tools.find((tool) => tool.name === 'walk_relay_graph')
  check(
    'walk_relay_graph publishes a structured input schema',
    walkSchema !== undefined &&
      walkSchema.inputSchema.type === 'object' &&
      Array.isArray(walkSchema.inputSchema.required) &&
      walkSchema.inputSchema.required.includes('network'),
    walkSchema === undefined ? 'tool missing' : `required: ${walkSchema.inputSchema.required.join(', ')}`,
  )

  // Reaches the Python engine as a subprocess.
  const cycles = await client.callTool({
    name: 'find_cycles',
    arguments: { network: NETWORK },
  })
  const cyclePayload = JSON.parse(cycles.content[0].text)
  check(
    'tools/call find_cycles reaches the Python engine',
    cyclePayload.cycles.length === 1 && cyclePayload.cycles[0].laneId === 'str-ham',
    `found ${cyclePayload.count} loop, closing lane ${cyclePayload.cycles[0]?.laneId}`,
  )

  const walk = await client.callTool({
    name: 'walk_relay_graph',
    arguments: { network: NETWORK, startFacility: 'NLRTM', startMinute: 0, maxLegs: 8 },
  })
  const walkPayload = JSON.parse(walk.content[0].text)
  check(
    'tools/call walk_relay_graph reports the closing edge',
    walkPayload.cycle !== null && walkPayload.cycle.laneId === 'str-ham',
    walkPayload.cycle === null
      ? 'no cycle reported'
      : `${walkPayload.cycle.path.join(' -> ')} closed by ${walkPayload.cycle.laneId}`,
  )

  // Determinism across the process boundary: same input, same bytes out.
  const again = await client.callTool({
    name: 'walk_relay_graph',
    arguments: { network: NETWORK, startFacility: 'NLRTM', startMinute: 0, maxLegs: 8 },
  })
  check(
    'the same call is byte-identical across calls',
    again.content[0].text === walk.content[0].text,
    'deterministic',
  )

  const score = await client.callTool({
    name: 'score_handoff',
    arguments: { network: NETWORK, facility: 'DEHAM', arrivalMinute: 600 },
  })
  const scorePayload = JSON.parse(score.content[0].text)
  check(
    'tools/call score_handoff returns itemised factors',
    Array.isArray(scorePayload.factors) && scorePayload.factors.length >= 4,
    `score ${scorePayload.score} (${scorePayload.band}) from ${scorePayload.factors.length} factors`,
  )

  // A malformed call must fail loudly rather than return a plausible-looking empty result.
  // The raw SDK client surfaces failures as `isError` rather than by throwing, so assert on it.
  const rejected = await client.callTool({
    name: 'walk_relay_graph',
    arguments: { network: NETWORK, startFacility: 'NOWHERE' },
  })
  check(
    'an unknown facility is rejected, with the engine code preserved',
    rejected.isError === true &&
      rejected.content[0].text.includes('UNKNOWN_FACILITY') &&
      rejected.content[0].text.includes('NOT_FOUND'),
    rejected.isError === true ? rejected.content[0].text.trim() : 'returned a success payload',
  )

  // The same must hold for a structurally invalid payload.
  const malformed = await client.callTool({
    name: 'walk_relay_graph',
    arguments: { startFacility: 'NLRTM' },
  })
  check(
    'a missing network is rejected at the boundary',
    malformed.isError === true,
    malformed.isError === true ? malformed.content[0].text.trim() : 'returned a success payload',
  )

  await client.close()

  const failed = checks.filter((entry) => !entry.passed)
  process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`)
  if (failed.length > 0) process.exit(1)
}

main().catch((error) => {
  process.stderr.write(`proof failed: ${error?.stack ?? error}\n`)
  process.exit(1)
})
