# DoozCTL

[![Site](https://img.shields.io/badge/site-ctl.dooziesoft.com-4A5ABA)](https://ctl.dooziesoft.com)

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

## Quick start

Install and initialize the current directory against a local standards package:

```sh
npm install -g @dooziesoft/doozctl
doozctl init . ./standards
```

`init` analyzes the repository, renders each init-lifecycle artifact the package declares (for example `AGENTS.md`), merges it into existing files without touching unmanaged content, and writes the engine state:

```text
Repository initialized: .
Generated artifacts:
  - AGENTS.md

Engine state:      .dooz/manifest.json
Repository memory: .ai/repository-analysis.json
```

A Standards Package is just a directory containing a `package.json` manifest that declares artifacts. See [spec.md](https://github.com/dooziesoft/doozctl/blob/main/spec.md) for the contract. Ready-to-run packages live in [examples/](https://github.com/dooziesoft/doozctl/tree/main/examples).

See [FAQ.md](https://github.com/dooziesoft/doozctl/blob/main/FAQ.md) for common questions.

## Commands

```sh
doozctl init <repo> <package>                 # analyze, render, install artifacts
doozctl sync <repo> <package>                 # re-render managed artifacts, keep your edits
doozctl analyze [repo]                        # update repository analysis only
doozctl summarize <repo> <package> <session>  # append an immutable session summary
doozctl doctor <repo> <package>               # verify repository health
doozctl status [repo]                         # show what DoozCTL understands
```

Every command supports `--help` with usage and an example.

## Exit codes

| Code | Meaning                                                                    |
| ---- | -------------------------------------------------------------------------- |
| `0`  | Success                                                                    |
| `1`  | Error (missing arguments, uninitialized repository, malformed state, etc.) |

## Design

- Minimal. Deterministic. Offline. Text-based. Vendor neutral. Artifact driven.
- Prefer preserving user-authored content over propagating generated content.
- Brownfield first — the engine merges into existing repositories, never destroys them.

See [ARCHITECTURE.md](https://github.com/dooziesoft/doozctl/blob/main/ARCHITECTURE.md) for the layered design and [spec.md](https://github.com/dooziesoft/doozctl/blob/main/spec.md) for the frozen specification.

## Status

All six workflows are implemented and tested (247 tests, 94.6% coverage):

- ✅ init
- ✅ sync
- ✅ analyze
- ✅ summarize
- ✅ doctor
- ✅ status

See [ROADMAP.md](https://github.com/dooziesoft/doozctl/blob/main/ROADMAP.md) for what is planned next and
[RELEASE_CHECKLIST.md](https://github.com/dooziesoft/doozctl/blob/main/RELEASE_CHECKLIST.md) for the v1.0 release gate.

## v1.0 definition

`npx doozctl init` creates a repository that can be worked on interchangeably by any AI assistant — Claude Code, Codex CLI, OpenCode, Gemini CLI, Cursor, and future tools — without losing project memory.

## License

MIT
