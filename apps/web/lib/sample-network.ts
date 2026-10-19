import raw from './sample-network.json'

/**
 * The declared relay network the workspace demonstrates.
 *
 * It lives in JSON rather than TypeScript so the fixture generator in `scripts/` can read the
 * exact same document the UI ships, instead of parsing source. One network, two consumers.
 *
 * It is deliberately imperfect: `ham-rtm` closes a loop back onto Rotterdam, which is the exact
 * class of mistake this product exists to catch. Nothing here is random and nothing is fetched,
 * so the demo tells the same story on every load.
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

export const SAMPLE_NETWORK: Network = raw as Network

export const DEFAULT_START = 'NLRTM'
