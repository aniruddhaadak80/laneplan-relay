# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `walk_relay_graph`, `find_cycles` and `score_handoff` registered in the shared registry, so
  the relay engine is reachable identically from the CLI, the web workspace and the MCP server.
- Deterministic engine operations for the relay domain: a depth-first lane walk with visited-set
  cycle detection, a hard visit budget, per-lane departure-window feasibility, and deterministic
  ranking and tie-breaking. Fifty tests including property tests for determinism and for the
  budget invariant.
- Engine error codes translated onto the closed product taxonomy while preserving the original
  engine code in the message, so an MCP client can tell a malformed network from a missing
  facility.
- `/workspace` route and `/api/walk` handler in the web app, with the relay spine rendering the
  engine's actual traversal and explicit idle, running, error and result states.
- `laneplan skills` and `laneplan plugins` commands, which the previous README claimed but which
  did not exist.
- `scripts/prove-mcp.mjs`, which drives `mcp serve` with the real MCP SDK client over stdio and
  asserts nine properties including determinism across the process boundary.
- Public Sans + Roboto Mono pairing and the slate/amber token palette.

### Fixed

- `window_headroom` was scored with the wrong sign, so a *slack* lane window raised the handoff
  risk score. It is now `window_tightness`, scoring tightness rather than slack.
- A chain reaching a facility with no outbound lane was never recorded as a plan, so a valid
  origin-to-destination route reported zero plans.
- License declarations disagreed with the `LICENSE` file across six packages; all now MIT.

## [0.1.0] - 2026-01-01

### Added

- The narrow waist: one `Tool` interface and one `ToolRegistry`, reachable from the CLI,
  the web app, the MCP server, and every channel.
- `laneplan doctor` — subsystem probes with a fix hint per failing row.
- The deterministic Python engine, called as a pure function over stdin/stdout.
- The skills catalog with frontmatter validation and a CI version gate.
- The plugin registry with schema validation and priority-based conflict resolution.
- SQLite storage with WAL, numbered migrations, and FTS5 search.
- An MCP server exposing the registry over stdio, plus an MCP client.
- The web workspace, deployed to Vercel, with a real `/api/health` endpoint.

[Unreleased]: https://github.com/aniruddhaadak80/laneplan-relay/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aniruddhaadak80/laneplan-relay/releases/tag/v0.1.0
