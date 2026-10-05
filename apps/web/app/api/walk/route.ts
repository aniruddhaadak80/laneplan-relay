import { NextResponse } from 'next/server'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { EngineBridge } from '@laneplanrelay/engine-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 512 * 1024

/**
 * Locates the Python engine's importable root.
 *
 * The server may be started from the repo root (`npm run dev`) or from the app directory
 * (`npm run -w @laneplanrelay/web dev`), and on a serverless host there is no engine at all.
 * Probing a short candidate list means the same code works in all three cases, and the missing
 * case degrades to an explicit 503 instead of a spawn error.
 */
function engineCwd(): string | undefined {
  const override = process.env.PRODUCT_ENGINE_CWD
  const candidates = [
    override,
    resolve(process.cwd(), 'services/engine/src'),
    resolve(process.cwd(), '../../services/engine/src'),
    resolve(process.cwd(), '../../../services/engine/src'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

  return candidates.find((candidate) => existsSync(resolve(candidate, 'laneplan_relay')))
}

/**
 * Runs the deterministic walk over the real Python engine.
 *
 * There is no TypeScript reimplementation of the walk on purpose: a second implementation is
 * how a CLI and a web page start disagreeing about which loop is the real one. This route is a
 * transport, exactly like the CLI and the MCP server.
 *
 * If the host has no Python interpreter — which is the normal case for a serverless Node
 * runtime — the engine cannot run and this returns 503 with an explicit reason. It never
 * substitutes a guess, because a plausible-looking answer from the wrong engine is worse than
 * no answer at all.
 */
function bridge(): EngineBridge {
  const cwd = engineCwd()
  return new EngineBridge({
    module: 'laneplan_relay',
    ...(cwd === undefined ? {} : { cwd }),
    timeoutMs: 8_000,
  })
}

function unavailable(reason: string, hint: string) {
  return NextResponse.json(
    {
      error: {
        code: 'ENGINE_UNAVAILABLE',
        message: `The deterministic engine could not run on this host: ${reason}`,
        hint,
      },
    },
    { status: 503 },
  )
}

export async function POST(request: Request) {
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Could not read the request body.' } },
      { status: 400 },
    )
  }

  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Network payload is too large.' } },
      { status: 413 },
    )
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } },
      { status: 400 },
    )
  }

  const input = body as { network?: unknown; startFacility?: unknown; startMinute?: unknown }
  if (typeof input?.network !== 'object' || input.network === null) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: '"network" must be an object.' } },
      { status: 400 },
    )
  }
  if (typeof input.startFacility !== 'string' || input.startFacility.length === 0) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: '"startFacility" must be a string.' } },
      { status: 400 },
    )
  }

  const response = await bridge().invoke({
    op: 'walk_relay_graph',
    input: {
      network: input.network,
      startFacility: input.startFacility,
      ...(typeof input.startMinute === 'number' ? { startMinute: input.startMinute } : {}),
      maxLegs: 8,
    },
  })

  if (!response.ok) {
    const code = response.error?.code ?? 'INTERNAL'
    const message = response.error?.message ?? 'The engine failed.'
    // A missing interpreter is an environment problem, not a caller problem.
    if (code === 'SPAWN_FAILED' || code === 'NONZERO_EXIT') {
      return unavailable(
        message,
        'Run the same walk from the CLI with `laneplan mcp call walk_relay_graph`, or self-host where Python 3.11+ is available.',
      )
    }
    const status = code === 'UNKNOWN_FACILITY' ? 404 : 422
    return NextResponse.json({ error: { code, message } }, { status })
  }

  return NextResponse.json(response.value)
}
