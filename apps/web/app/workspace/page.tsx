import { DEFAULT_START, SAMPLE_NETWORK } from '@/lib/sample-network'
import WalkPanel from './WalkPanel'

export const metadata = {
  title: 'Workspace — LanePlan Relay',
  description:
    'Walk a declared relay lane graph and see the first loop, budget breach or missed window the deterministic engine finds.',
}

/**
 * The facility tree on the left is the declared network, read straight from the sample. The walk
 * itself is not precomputed: pressing the button spawns the Python engine through /api/walk, so
 * what you read is the engine's real traversal.
 */
export default function WorkspacePage() {
  return (
    <div className="grid">
      <section aria-labelledby="network-heading" className="panel">
        <h2 id="network-heading">Declared network</h2>
        <p className="muted small">Four facilities, five lanes. One of them closes a loop on purpose.</p>
        <ul className="spine" style={{ flexDirection: 'column' }}>
          {SAMPLE_NETWORK.facilities.map((facility) => {
            const outbound = SAMPLE_NETWORK.lanes.filter((lane) => lane.fromFacility === facility.id)
            return (
              <li key={facility.id} className="chip">
                <span className="chip-lane">{facility.id}</span>
                <span className="chip-facility">{facility.name}</span>
                <span className="chip-time">
                  {facility.kind} · {outbound.length} outbound lane
                  {outbound.length === 1 ? '' : 's'}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      <WalkPanel network={SAMPLE_NETWORK} startFacility={DEFAULT_START} />
    </div>
  )
}
