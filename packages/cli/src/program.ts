import { Command } from 'commander'
import { join } from 'node:path'
import { buildToolRegistry, createContext } from './bootstrap.js'
import { doctor, renderReport } from './doctor.js'
import { loadCatalog } from '@laneplanrelay/skills'
import { buildRegistry } from '@laneplanrelay/plugins'

const VERSION = '0.1.0'

/** Exit codes are part of the contract: 0 ok, 1 runtime failure, 2 usage error. */
export function buildProgram(): Command {
  const program = new Command()

  program
    .name('laneplan')
    .description(
      'Walk a declared relay lane graph and find the first handoff that loops, over-extends its chain, or misses its window.',
    )
    .version(VERSION, '-v, --version', 'print the version')
    .exitOverride((error) => {
      process.exitCode = error.exitCode === 0 ? 0 : 2
      throw error
    })

  program
    .command('doctor')
    .description('diagnose every subsystem and print an actionable report')
    .option('--json', 'machine-readable output')
    .action(async () => {
      const report = await doctor()
      process.stdout.write(
        process.argv.includes('--json')
          ? `${JSON.stringify(report, null, 2)}\n`
          : `${renderReport(report)}\n`,
      )
      if (!report.ok) process.exitCode = 1
    })

  program
    .command('tools')
    .description('list the registered tools — the authoritative capability list')
    .option('--json', 'machine-readable output')
    .action(() => {
      const registry = buildToolRegistry()
      const tools = registry.list().map((tool) => ({
        name: tool.name,
        description: tool.description,
        surface: registry.surfaceOf(tool.name),
        source: registry.sourceOf(tool.name),
        permissions: tool.permissions,
        inputSchema: tool.inputSchema,
      }))
      if (process.argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify(tools, null, 2)}\n`)
        return
      }
      const width = Math.max(...tools.map((t) => t.name.length), 4)
      for (const tool of tools) {
        process.stdout.write(`  ${tool.name.padEnd(width)}  [${tool.surface}]  ${tool.description}\n`)
      }
    })

  const mcp = program.command('mcp').description('Model Context Protocol commands')

  mcp
    .command('serve')
    .description('run the MCP server over stdio')
    .action(async () => {
      const { serveStdio } = await import('@laneplanrelay/mcp')
      const registry = buildToolRegistry()
      // stdout belongs to the protocol from here on; diagnostics must go to stderr.
      await serveStdio(registry, createContext('mcp'))
    })

  mcp
    .command('call')
    .description('invoke one tool directly, without MCP')
    .argument('<tool>', 'tool name')
    .argument('<input>', 'JSON input document')
    .action(async (tool: string, raw: string) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (cause) {
        process.stderr.write(`error: input is not valid JSON — ${String(cause)}\n`)
        process.exitCode = 2
        return
      }
      const registry = buildToolRegistry()
      try {
        const value = await registry.invoke(tool, parsed, createContext('cli'), [
          'fs:read',
          'net:fetch',
          'proc:spawn',
        ])
        process.stdout.write(`${JSON.stringify(value ?? null, null, 2)}\n`)
      } catch (cause) {
        const code = (cause as { code?: string }).code ?? 'INTERNAL'
        process.stderr.write(`${code}: ${cause instanceof Error ? cause.message : String(cause)}\n`)
        process.exitCode = 1
      }
    })

  program
    .command('skills')
    .description('list the skill catalog loaded from disk, with validation issues')
    .option('--json', 'machine-readable output')
    .option('--bodies', 'include each skill body')
    .action(() => {
      const { skills, issues } = loadCatalog(join(process.cwd(), 'skills'))
      const payload = {
        count: skills.length,
        issues: [...issues],
        skills: skills.map((skill) => ({
          name: skill.name,
          version: skill.version,
          description: skill.description,
          ...(process.argv.includes('--bodies') ? { body: skill.body } : {}),
        })),
      }
      if (process.argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
        return
      }
      for (const skill of payload.skills) {
        process.stdout.write(`  ${skill.name}  v${skill.version}  ${skill.description}\n`)
      }
      for (const issue of payload.issues) {
        process.stdout.write(`  [invalid] ${issue}\n`)
      }
    })

  program
    .command('plugins')
    .description('list resolved plugins, including shadowed, disabled and rejected ones')
    .option('--json', 'machine-readable output')
    .action(() => {
      const result = buildRegistry(join(process.cwd(), 'plugins'))
      const payload = {
        active: result.active.map((entry) => ({
          name: entry.manifest.name,
          version: entry.manifest.version,
          capabilities: entry.manifest.capabilities,
          shadowed: entry.shadowed,
        })),
        disabled: result.disabled.map((entry) => entry.manifest.name),
        rejected: result.rejected.map((entry) => ({ path: entry.path, issues: entry.issues })),
      }
      if (process.argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
        return
      }
      for (const plugin of payload.active) {
        process.stdout.write(`  ${plugin.name}  v${plugin.version}  ${plugin.capabilities}\n`)
      }
      for (const name of payload.disabled) process.stdout.write(`  [disabled] ${name}\n`)
      for (const entry of payload.rejected) {
        process.stdout.write(`  [rejected] ${entry.path}: ${entry.issues.join(', ')}\n`)
      }
    })

  program
    .command('version')
    .description('print version and runtime information as JSON')
    .action(() => {
      process.stdout.write(
        `${JSON.stringify(
          {
            name: 'laneplan-relay',
            version: VERSION,
            node: process.versions.node,
            platform: process.platform,
            tools: buildToolRegistry().size,
          },
          null,
          2,
        )}\n`,
      )
    })

  return program
}
