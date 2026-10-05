import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The product's identity and static manifest, in one typed place. Both the web UI and the
 * health endpoint read from here so a value is never stated twice.
 */
export interface Surface {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly status: 'shipped' | 'planned'
}

export const PRODUCT = {
  name: 'LanePlan Relay',
  slug: 'laneplan-relay',
  version: '0.1.0',
  tagline:
    'Declare your relay lanes, walk the graph, and get the first handoff that loops, blows the visit budget, or misses its window — deterministically, from every surface.',
  repoUrl: 'https://github.com/aniruddhaadak80/laneplan-relay',
} as const

export const SURFACES: readonly Surface[] = [
  {
    id: 'cli',
    title: 'CLI',
    summary:
      'The load-bearing entry point. doctor, tools, mcp serve and mcp call reach every capability without a browser.',
    status: 'shipped',
  },
  {
    id: 'web',
    title: 'Web workspace',
    summary:
      'This app. The facility tree and the relay spine, server-rendered, with the walk run by the real engine over /api/walk.',
    status: 'shipped',
  },
  {
    id: 'mcp',
    title: 'MCP server',
    summary:
      'Eight tools over stdio, so the product is a provider for other agents. Proven by scripts/prove-mcp.mjs against a real client.',
    status: 'shipped',
  },
  {
    id: 'engine',
    title: 'Deterministic engine',
    summary:
      'Python. A bounded graph walk with cycle detection, a hard visit budget and window feasibility. No clock, no network, no model.',
    status: 'shipped',
  },
  {
    id: 'skills',
    title: 'Skills catalog',
    summary: 'Markdown skills loaded from disk with frontmatter validation and version gating.',
    status: 'shipped',
  },
  {
    id: 'plugins',
    title: 'Plugin registry',
    summary:
      'Manifest-driven extensions with priority-based conflict resolution and honest rejection reasons.',
    status: 'shipped',
  },
]

function packageVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export function resolveVersion(): string {
  return packageVersion()
}
