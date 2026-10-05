import { join } from 'node:path'
import { ToolRegistry, ValidationError, type Tool, type ToolContext } from '@laneplanrelay/core'
import { buildRegistry } from '@laneplanrelay/plugins'
import { loadCatalog } from '@laneplanrelay/skills'

export const ENGINE_MODULE = 'laneplan_relay'

/**
 * Builds the one registry every surface shares.
 *
 * The first five are generic plumbing and are real and working out of the box. The last three
 * — walk_relay_graph, find_cycles and score_handoff — are this product's actual capability, and
 * they are what makes the MCP server useful on a fresh install instead of exposing an empty tool
 * list. All of them are also the intended shape for your own tools: a name a model can type, an
 * inputSchema it can fill, declared permissions, and a handler that returns JSON-serialisable data.
 *
 * Every name matches ^[a-z][a-z0-9_]*$ so it is directly exposable over MCP.
 */
export function buildToolRegistry(cwd = process.cwd()): ToolRegistry {
  const registry = new ToolRegistry()

  registry.register(
    {
      name: 'list_skills',
      description:
        'List the skill catalog with each skill name, version and description. Use this to discover what the agent can do before guessing a command.',
      inputSchema: {
        type: 'object',
        properties: {
          includeBodies: { type: 'boolean', description: 'Include each skill body.' },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          issues: { type: 'array', items: { type: 'string' } },
          skills: { type: 'array', items: { type: 'object' } },
        },
        required: ['count', 'issues', 'skills'],
      },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async (input: { includeBodies?: boolean }) => {
        const { skills, issues } = loadCatalog(join(cwd, 'skills'))
        return {
          count: skills.length,
          issues: [...issues],
          skills: skills.map((skill) => ({
            name: skill.name,
            version: skill.version,
            description: skill.description,
            ...(input.includeBodies === true ? { body: skill.body } : {}),
          })),
        }
      },
    } satisfies Tool<{ includeBodies?: boolean }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'list_plugins',
      description:
        'List the resolved plugin registry, including plugins that were shadowed, disabled or rejected and why. Use this to explain why an expected capability is missing.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: { type: 'object' },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async () => {
        const result = buildRegistry(join(cwd, 'plugins'))
        return {
          active: result.active.map((p) => ({
            name: p.manifest.name,
            version: p.manifest.version,
            capabilities: p.manifest.capabilities,
            shadowed: p.shadowed,
          })),
          disabled: result.disabled.map((p) => p.manifest.name),
          rejected: result.rejected.map((p) => ({ path: p.path, issues: p.issues })),
        }
      },
    } satisfies Tool<Record<string, never>, unknown>,
    { source: 'core' },
  )

  const runEngine = async (op: string, input: unknown): Promise<unknown> => {
    const { EngineBridge } = await import('@laneplanrelay/engine-client')
    const bridge = new EngineBridge({
      module: ENGINE_MODULE,
      cwd: join(cwd, 'services', 'engine', 'src'),
    })
    return await bridge.call({ op, input })
  }

  const engineSchema = (properties: Record<string, unknown>, required: string[]) =>
    ({
      type: 'object',
      properties: { records: { type: 'array', items: { type: 'object' } }, ...properties },
      required: ['records', ...required],
      additionalProperties: false,
    }) as const

  const validateRecords = (input: unknown): unknown[] => {
    const records = (input as { records?: unknown }).records
    if (!Array.isArray(records)) {
      throw new ValidationError('"records" must be an array', { field: 'records' })
    }
    return records
  }

  registry.register(
    {
      name: 'engine_summarize',
      description:
        'Aggregate a set of records by kind and report the total and the newest/oldest timestamps. Deterministic: same records always give the same answer.',
      inputSchema: engineSchema({}, []),
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        validateRecords(input)
        return await runEngine('summarize', input)
      },
    } satisfies Tool<{ records: unknown[] }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'engine_diff',
      description:
        'Compute a minimal structural diff between two record sets, reporting added, removed, changed and unchanged identifiers. Use this instead of comparing JSON by eye.',
      inputSchema: {
        type: 'object',
        properties: {
          before: { type: 'array', items: { type: 'object' } },
          after: { type: 'array', items: { type: 'object' } },
        },
        required: ['before', 'after'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        if (!Array.isArray((input as { before?: unknown }).before)) {
          throw new ValidationError('"before" must be an array', { field: 'before' })
        }
        if (!Array.isArray((input as { after?: unknown }).after)) {
          throw new ValidationError('"after" must be an array', { field: 'after' })
        }
        return await runEngine('diff', input)
      },
    } satisfies Tool<{ before: unknown[]; after: unknown[] }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'engine_normalize',
      description:
        'Flatten records into a stable, sorted, comparable shape. Use this before diffing or storing so ordering never changes the result.',
      inputSchema: engineSchema({}, []),
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        validateRecords(input)
        return await runEngine('normalize', input)
      },
    } satisfies Tool<{ records: unknown[] }, unknown>,
    { source: 'core' },
  )

  const facilitySchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Stable facility identifier, e.g. "NLRTM".' },
      name: { type: 'string', description: 'Human label shown in the facility tree.' },
      kind: {
        type: 'string',
        description: 'port, depot, crossdock, hub or lastmile. Informational only.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  } as const

  const laneSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Stable lane identifier, e.g. "NLRTM-DEHAM".' },
      fromFacility: { type: 'string', description: 'Originating facility id.' },
      toFacility: { type: 'string', description: 'Receiving facility id.' },
      dwellMinutes: { type: 'number', description: 'Planned dwell at the origin before departure.' },
      transitMinutes: { type: 'number', description: 'Line-haul time once departed.' },
      openMinute: { type: 'number', description: 'Earliest departure, minutes on the plan clock.' },
      closeMinute: { type: 'number', description: 'Latest departure, minutes on the plan clock.' },
    },
    required: [
      'id',
      'fromFacility',
      'toFacility',
      'dwellMinutes',
      'transitMinutes',
      'openMinute',
      'closeMinute',
    ],
    additionalProperties: false,
  } as const

  const networkProperty = {
    type: 'object',
    properties: {
      facilities: { type: 'array', items: facilitySchema },
      lanes: { type: 'array', items: laneSchema },
    },
    required: ['facilities', 'lanes'],
    additionalProperties: false,
  } as const

  const validateNetwork = (input: unknown): void => {
    const network = (input as { network?: unknown }).network
    if (typeof network !== 'object' || network === null) {
      throw new ValidationError('"network" must be an object', { field: 'network' })
    }
    const candidate = network as { facilities?: unknown; lanes?: unknown }
    if (!Array.isArray(candidate.facilities) || !Array.isArray(candidate.lanes)) {
      throw new ValidationError('"network" needs "facilities" and "lanes" arrays', {
        field: 'network',
      })
    }
  }

  registry.register(
    {
      name: 'walk_relay_graph',
      description:
        'Walk a declared relay lane graph from a start facility and report what the walk found: ranked plans, plus the first cycle (the lane that closes a loop), the first visit-budget breach, and the first departure that misses its window. Deterministic and reproducible — the same network always yields the same verdict, which is why this is code and not a model call.',
      inputSchema: {
        type: 'object',
        properties: {
          network: networkProperty,
          startFacility: { type: 'string', description: 'Facility id the shipment departs from.' },
          startMinute: {
            type: 'number',
            description: 'Departure-ready minute on the plan clock. Defaults to 0.',
          },
          maxLegs: {
            type: 'number',
            description: 'Hard visit budget for one chain. Defaults to 8, maximum 64.',
          },
          maxPlans: { type: 'number', description: 'Cap on returned plans. Defaults to 25.' },
        },
        required: ['network', 'startFacility'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        validateNetwork(input)
        if (typeof (input as { startFacility?: unknown }).startFacility !== 'string') {
          throw new ValidationError('"startFacility" must be a string', {
            field: 'startFacility',
          })
        }
        return await runEngine('walk_relay_graph', input)
      },
    } satisfies Tool<{ network: unknown; startFacility: string }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'find_cycles',
      description:
        'Enumerate every distinct loop in a declared lane graph, ignoring timing entirely, each rotated to a canonical starting facility. Use this as a regression check on a network before planning against it.',
      inputSchema: {
        type: 'object',
        properties: { network: networkProperty },
        required: ['network'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        validateNetwork(input)
        return await runEngine('find_cycles', input)
      },
    } satisfies Tool<{ network: unknown }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'score_handoff',
      description:
        'Score one facility handoff from 0-100 with itemised weighted factors (dwell pressure, window tightness, fanout, inbound criticality) and an actionable recommendation. Read the factors, not just the score.',
      inputSchema: {
        type: 'object',
        properties: {
          network: networkProperty,
          facility: { type: 'string', description: 'Facility id being scored.' },
          arrivalMinute: {
            type: 'number',
            description: 'When the load reaches the facility, on the plan clock. Defaults to 0.',
          },
        },
        required: ['network', 'facility'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        validateNetwork(input)
        if (typeof (input as { facility?: unknown }).facility !== 'string') {
          throw new ValidationError('"facility" must be a string', { field: 'facility' })
        }
        return await runEngine('score_handoff', input)
      },
    } satisfies Tool<{ network: unknown; facility: string }, unknown>,
    { source: 'core' },
  )

  return registry
}

/** A minimal, dependency-free logger for the tool context. */
export function createContext(requestId = 'cli'): ToolContext {
  return {
    requestId,
    now: () => Date.now(),
    log: (level, message, fields) => {
      process.stderr.write(`${JSON.stringify({ level, message, requestId, ...fields })}\n`)
    },
    dataDir: process.env.PRODUCT_DATA_DIR ?? '.data',
  }
}
