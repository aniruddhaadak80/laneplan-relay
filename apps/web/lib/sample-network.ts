/**
 * A declared relay network used to demonstrate the engine.
 *
 * It is deliberately imperfect: `rtm-ham-back` closes a loop between Rotterdam and Hamburg,
 * which is the exact class of mistake this product exists to catch. Nothing here is random and
 * nothing is fetched, so the demo tells the same story on every load.
 */
export interface Facility {
  readonly id: string
  readonly name: string
  readonly kind: string
}

export interface Lane {
  readonly id: string
  readonly fromFacility: string
  readonly toFacility: string
  readonly dwellMinutes: number
  readonly transitMinutes: number
  readonly openMinute: number
  readonly closeMinute: number
}

export interface Network {
  readonly facilities: readonly Facility[]
  readonly lanes: readonly Lane[]
}

const DAY = 10_080

export const SAMPLE_NETWORK: Network = {
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
      closeMinute: DAY,
    },
    {
      id: 'rtm-fra',
      fromFacility: 'NLRTM',
      toFacility: 'FRAXF',
      dwellMinutes: 60,
      transitMinutes: 500,
      openMinute: 0,
      closeMinute: DAY,
    },
    {
      id: 'ham-fra',
      fromFacility: 'DEHAM',
      toFacility: 'FRAXF',
      dwellMinutes: 90,
      transitMinutes: 300,
      openMinute: 0,
      closeMinute: DAY,
    },
    {
      id: 'fra-str',
      fromFacility: 'FRAXF',
      toFacility: 'STRIG',
      dwellMinutes: 60,
      transitMinutes: 180,
      openMinute: 0,
      closeMinute: DAY,
    },
    // The loop. A planner that walks without a visited set will happily follow this forever.
    {
      id: 'ham-rtm',
      fromFacility: 'DEHAM',
      toFacility: 'NLRTM',
      dwellMinutes: 30,
      transitMinutes: 420,
      openMinute: 0,
      closeMinute: DAY,
    },
  ],
}

export const DEFAULT_START = 'NLRTM'
