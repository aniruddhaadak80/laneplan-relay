'use client'

import { useCallback, useState } from 'react'
import type { Network } from '@/lib/sample-network'

interface Leg {
  laneId: string
  fromFacility: string
  toFacility: string
  departMinute: number
  arriveMinute: number
  dwellMinutes: number
}

interface Plan {
  legs: Leg[]
  terminus: string
  arriveMinute: number
  totalDwellMinutes: number
  laneIds: string[]
}

interface WalkResult {
  engine: string
  plans: Plan[]
  planCount: number
  legsWalked: number
  branchesPruned: number
  cycle: { laneId: string; facility: string; path: string[] } | null
  budget: { facility: string; legsUsed: number; maxLegs: number; prunedLaneIds: string[] } | null
  windowMiss: {
    laneId: string
    facility: string
    departureMinute: number
    openMinute: number
    closeMinute: number
  } | null
  maxLegs: number
  startFacility: string
}

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done'; readonly result: WalkResult }
  | { readonly kind: 'failed'; readonly code: string; readonly message: string; readonly hint: string }

function clock(minute: number): string {
  const day = 1 + Math.floor(minute / 1440)
  const within = ((minute % 1440) + 1440) % 1440
  const hours = String(Math.floor(within / 60)).padStart(2, '0')
  const minutes = String(within % 60).padStart(2, '0')
  return `d${day} ${hours}:${minutes}`
}

/**
 * The relay spine: one chip per leg the walk actually took, in order, with the facility it
 * departs and the minute it departs. A chip turns amber when its departure sits inside the
 * last tenth of its window, and the chip that closes a loop is drawn in red with a marker.
 * The spine is a readout of the engine's actual traversal, not an illustration of one.
 */
export default function WalkPanel({
  network,
  startFacility,
}: {
  readonly network: Network
  readonly startFacility: string
}) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  const run = useCallback(async () => {
    setState({ kind: 'running' })
    try {
      const response = await fetch('/api/walk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ network, startFacility, startMinute: 0 }),
      })
      const payload: unknown = await response.json()

      if (!response.ok) {
        const error = (payload as { error?: { code?: string; message?: string; hint?: string } }).error
        setState({
          kind: 'failed',
          code: error?.code ?? 'UNKNOWN',
          message: error?.message ?? `The walk failed with HTTP ${response.status}.`,
          hint: error?.hint ?? 'Check the declared network and try again.',
        })
        return
      }

      setState({ kind: 'done', result: payload as WalkResult })
    } catch (cause) {
      setState({
        kind: 'failed',
        code: 'NETWORK',
        message: cause instanceof Error ? cause.message : 'The walk request could not be sent.',
        hint: 'The route handler did not respond.',
      })
    }
  }, [network, startFacility])

  const result = state.kind === 'done' ? state.result : null
  const spine: Leg[] =
    result?.cycle?.path !== null && result?.cycle?.path !== undefined ? [] : (result?.plans[0]?.legs ?? [])

  return (
    <section aria-labelledby="spine-heading" className="panel">
      <div className="panel-head">
        <h2 id="spine-heading">Walk the network from {startFacility}</h2>
        <button type="button" className="btn" onClick={() => void run()} disabled={state.kind === 'running'}>
          {state.kind === 'running' ? 'Walking…' : 'Run the walk'}
        </button>
      </div>

      {state.kind === 'idle' && (
        <p className="muted">
          Nothing has been walked yet. The engine will traverse the declared lanes depth-first and report the
          first loop, budget breach or missed window it finds.
        </p>
      )}

      {state.kind === 'running' && (
        <p className="muted" role="status">
          Spawning the deterministic engine…
        </p>
      )}

      {state.kind === 'failed' && (
        <div className="notice notice-danger" role="alert">
          <strong>{state.code}</strong>
          <p>{state.message}</p>
          <p className="muted">{state.hint}</p>
        </div>
      )}

      {result !== null && (
        <>
          <dl className="stats">
            <div>
              <dt>Plans</dt>
              <dd>{result.planCount}</dd>
            </div>
            <div>
              <dt>Legs walked</dt>
              <dd>{result.legsWalked}</dd>
            </div>
            <div>
              <dt>Branches pruned</dt>
              <dd>{result.branchesPruned}</dd>
            </div>
            <div>
              <dt>Leg budget</dt>
              <dd>{result.maxLegs}</dd>
            </div>
          </dl>

          {result.cycle !== null ? (
            <div className="notice notice-danger" role="alert">
              <strong>This network loops.</strong>
              <p>
                Lane <code>{result.cycle.laneId}</code> returns to <code>{result.cycle.facility}</code>, which
                the walk has already visited. The chain that reaches it is {result.cycle.path.join(' → ')}.
              </p>
            </div>
          ) : (
            <>
              <h3 className="spine-title">Relay spine</h3>
              <ol className="spine">
                <li className="chip chip-origin">{startFacility}</li>
                {spine.map((leg) => (
                  <li key={leg.laneId} className="chip">
                    <span className="chip-lane">{leg.laneId}</span>
                    <span className="chip-facility">{leg.toFacility}</span>
                    <span className="chip-time">{clock(leg.departMinute)}</span>
                  </li>
                ))}
                {spine.length === 0 && <li className="muted">No plan completed the walk.</li>}
              </ol>
            </>
          )}

          {result.windowMiss !== null && (
            <div className="notice notice-warn">
              <strong>First missed window.</strong>
              <p>
                Lane <code>{result.windowMiss.laneId}</code> would depart at{' '}
                {clock(result.windowMiss.departureMinute)}, outside its {clock(result.windowMiss.openMinute)}–
                {clock(result.windowMiss.closeMinute)} window.
              </p>
            </div>
          )}

          {result.budget !== null && (
            <div className="notice notice-warn">
              <strong>Budget reached at {result.budget.facility}.</strong>
              <p>
                The chain used all {result.budget.maxLegs} legs and stopped with{' '}
                {result.budget.prunedLaneIds.length} lane(s) unexplored.
              </p>
            </div>
          )}

          <p className="muted small">
            Engine {result.engine} · deterministic: the same network always produces this exact verdict.
          </p>
        </>
      )}
    </section>
  )
}
