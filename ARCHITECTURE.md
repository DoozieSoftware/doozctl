# DoozCTL Architecture

A lightweight, vendor-neutral CLI that installs and maintains AI repository standards.

DoozCTL does not define engineering practices. It provides the engine that renders, installs, updates and validates repository artifacts supplied by an external Standards Package. The repository becomes the long-term memory; AI coding assistants become interchangeable execution engines.

---

## Philosophy

- Minimal context. Minimal configuration.
- Repository over conversation. Behavior over documentation.
- Facts over prose. Deterministic over magical.
- Brownfield first. Offline first. Vendor neutral.
- Prefer preserving user-authored content over propagating generated content.

## Pipeline

Every command runs the same pipeline as a sequence of independent steps, in order, short-circuiting on the first failure.

```text
Repository
    ↓
Analyze            — produce factual repository metadata (language, framework, statistics)
    ↓
Load               — read the Standards Package manifest
    ↓
Resolve Variables  — derive render variables from the analysis
    ↓
Render             — convert each Artifact template into RenderedArtifact
    ↓
Merge              — combine rendered content with existing files per strategy
    ↓
Validate           — check content against optional schemas
    ↓
Write              — persist merged artifacts and update the manifest
```

The `Engine` is only a step runner. It holds no standards-specific behavior. Each command selects its own steps — read-only commands cannot reach write.

## Layers

```text
CLI            — argument parsing, exit codes            (src/cli)
Dispatcher     — command routing                         (src/dispatcher)
Application    — use cases per command, own pipeline     (src/app)
Steps          — pipeline step factories                 (src/engine/steps)
Engine         — ordered step execution                  (src/engine/engine)
Contracts      — extension seams (analyzer, loader,
                 renderer, merger, validator)            (src/engine/contracts)
Model          — frozen domain types                     (src/model)
Infra          — git service                             (src/infra)
Store          — sandboxed storage, json, repository state (src/store)
```

Dependencies point downward. The app layer holds no infrastructure knowledge and never depends on a CLI framework. Step factories receive infrastructure via constructor injection — no DI container.

## Repository Layout

```text
src/
  app/        application services (one method per command)
  cli/        commander-based CLI, exit codes
  dispatcher/ command registry
  engine/     engine, steps, pipelines, contracts,
              analyzer, variable-resolver, loader, renderer, merge
  infra/      git
  model/      canonical domain types
  plugin/     extension scaffolding
  store/      storage abstraction, json, repository state
tests/
  fixtures/   representative repositories (laravel, node, react, empty)
  integration/ end-to-end tests
```

## Standards Package Contract

A Standards Package is a plain directory. No packaging format, registry or plugin system.

```text
standards/
    package.json
    artifacts/
    schemas/
```

The manifest is the only entry point:

```json
{
  "format": 1,
  "name": "@dooziesoft/standards",
  "version": "1.0.0",
  "engine": ">=1.0.0",
  "artifacts": [
    {
      "id": "agents",
      "source": "artifacts/AGENTS.md",
      "destination": "AGENTS.md",
      "merge": "managed-blocks"
    }
  ]
}
```

The loader validates only: package exists, JSON valid, artifact source exists, merge strategy valid. Nothing else.

Package format features deliberately absent: inheritance, includes, imports, conditions, loops, plugin hooks, code, YAML/TOML/custom template syntax.

## Merge Semantics

The merge engine knows only text. It never reads or writes files, never runs Git, never touches repositories. Input is existing content + rendered artifact + strategy; output is merged content or an explicit error.

Four strategies, frozen:

| Strategy            | Behavior                                                         | Use                                             |
| ------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| `overwrite`         | Replace entirely                                                 | generated machine state (`.dooz/manifest.json`) |
| `append`            | Add after, never modify                                          | immutable session files                         |
| `replace-generated` | Replace only if the file carries the generated marker, else fail | wrapper files                                   |
| `managed-blocks`    | Replace only inside marked regions, preserve everything else     | developer-facing files                          |

Managed block markers, frozen forever:

```text
<!-- DOOZCTL:BEGIN:v1 section-name -->

<!-- DOOZCTL:END:v1 section-name -->
```

The engine fails (writes nothing) on missing markers, unmatched BEGIN/END, duplicate sections, nesting, malformed markers, or unknown versions. No repair, no guessing, no partial merges, no conflict resolution. Whitespace outside blocks is preserved exactly; whitespace inside is replaced exactly. Identical input always produces identical output.

A missing destination is written directly; merge applies only to files that already exist. `replace-generated` is guarded by the generated marker `<!-- DOOZCTL:GENERATED:v1 -->` on the first line.

## Generated State

```text
.dooz/  manifest.json        engine state (which artifacts were generated)
.ai/    current-context.md   AI-readable memory
        repository-analysis.json
        sessions/            immutable session summaries
```

These files belong to the engine and are regenerated as required.

## Guiding Principles

> DoozCTL is a rendering engine for repository standards, not the author of those standards.

> Persist only the minimum knowledge required for the next engineer or AI agent to continue successfully.

> Prefer preserving user-authored content over propagating generated content.

The engine manages artifacts. The Standards Package defines behavior. The repository owns the knowledge.
