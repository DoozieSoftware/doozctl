# DoozCTL

AI coding tools lose context.

Repositories shouldn't.

DoozCTL turns repository knowledge into persistent, deterministic artifacts that every AI assistant can share.

## What it is

A **Repository Standards Engine** — a lightweight, vendor-neutral CLI that installs and maintains AI repository standards.

```text
Repository
    ↓
Analyze
    ↓
Resolve Context
    ↓
Load Standards
    ↓
Render Artifacts
    ↓
Merge
    ↓
Persist
```

It is not an AGENTS.md generator. `AGENTS.md` is simply one artifact. The engine does not know that file exists — or any artifact name, AI vendor, language, or company convention.

## The three products

DoozCTL is really three things:

### 1. DoozCTL — the engine

Open source. Responsible for analyze, render, merge, sync. Nothing else.

### 2. Standards Packages — the domain

Versioned, independent packages that define repository artifacts.

```text
@dooziesoft/standards
@dooziesoft/standards-laravel
@dooziesoft/standards-react
```

The engine renders whatever the package declares. All domain-specific behavior lives here, never in the engine.

### 3. Repository Memory — the `.ai` convention

```text
.ai/
    current-context.md
    repository-analysis.json
    sessions/
```

Portable repository memory. Cursor, Claude, Codex, Gemini, OpenCode, and future tools consume the same memory. The repository becomes the long-term memory; AI coding assistants become interchangeable execution engines.

## Design

- Minimal. Deterministic. Offline. Text-based. Vendor neutral. Artifact driven.
- Prefer preserving user-authored content over propagating generated content.
- Brownfield first — the engine merges into existing repositories, never destroys them.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the layered design and [spec.md](spec.md) for the frozen specification.

## Status

Core engine complete (v0.3.0-alpha.1). Orchestration in progress:

- ✅ Analyzer
- ✅ Variable Resolver
- ✅ Standards Loader
- ✅ Renderer
- ✅ Merge Engine
- ⏳ init
- ⏳ sync
- ⏳ summarize
- ⏳ doctor
- ⏳ status

## v1.0 definition

`npx doozctl init` creates a repository that can be worked on interchangeably by any AI assistant — Claude Code, Codex CLI, OpenCode, Gemini CLI, Cursor, and future tools — without losing project memory.

## License

MIT
