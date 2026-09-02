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
Load Standards
    ↓
Resolve Variables
    ↓
Render Artifacts
    ↓
Merge
    ↓
Validate
    ↓
Persist
```

It is not an AGENTS.md generator. `AGENTS.md` is simply one artifact. The engine does not know that file exists — or any artifact name, AI vendor, language, or company convention. The engine's generation path treats every artifact as opaque data; all meaning lives in the external Standards Package.

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

A Standards Package is just a directory containing a `package.json` manifest that declares artifacts. See [spec.md](https://github.com/DoozieSoftware/doozctl/blob/main/spec.md) for the contract. Ready-to-run packages live in [examples/](https://github.com/DoozieSoftware/doozctl/tree/main/examples).

See [FAQ.md](https://github.com/DoozieSoftware/doozctl/blob/main/FAQ.md) for common questions.

## Commands

```sh
doozctl init <repo> <package>                 # analyze, render, install artifacts
doozctl sync <repo> <package>                 # re-render managed artifacts, keep your edits
doozctl analyze [repo]                        # update repository analysis only
doozctl summarize <repo> <package> <session>  # append an immutable session summary
doozctl doctor <repo> <package>               # verify repository health
doozctl status [repo]                         # repository + control-plane view
doozctl plan [--method <method>] [--title <title>]  # create an engineering Plan under .dooz/plans/
doozctl verify [repo]                         # check the active Plan's required evidence
```

`plan` resolves `--method` against the workflows the repository has adopted
under `.dooz/workflows/adopted/` (from a Standards Package) or
`.dooz/workflows/project/`; the default method is `standard`. Workflows are
optional — `plan` succeeds even when the method is not yet adopted; `status`
and `verify` surface the adoption problem and evidence degrades honestly (D-01).
The sample Standards Package ships the five initial methods in
`standards/workflows/`.

`verify` reads the adopted workflow's `## Required Evidence` checklist
(WORKFLOW-SPEC) and reports whether the active Plan records that evidence —
plan sections, git facts, and workflow-declared files such as
`changelog: CHANGELOG.md`. It checks presence, never quality, and never runs
anything.

Every command supports `--help` with usage and an example.

## Exit codes

| Code | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| `0`  | Success                                                                       |
| `1`  | Error (missing state, malformed files, refused merges, doctor found problems) |
| `2`  | Invalid arguments                                                             |

## Design

- Minimal. Deterministic. Offline. Text-based. Vendor neutral. Artifact driven.
- Prefer preserving user-authored content over propagating generated content.
- Brownfield first — the engine merges into existing repositories, never destroys them.
- `overwrite` never replaces a file the engine did not create: first write of an `overwrite` artifact fails safely when a user-owned file already occupies the destination.
- Storage is sandboxed against real paths: no read or write may escape the repository through symlinks.

See [ARCHITECTURE.md](https://github.com/DoozieSoftware/doozctl/blob/main/ARCHITECTURE.md) for the layered design and [spec.md](https://github.com/DoozieSoftware/doozctl/blob/main/spec.md) for the frozen specification.

## Status

All eight workflows are implemented and tested (484 tests, 96.21% statements / 93.38% branches, built `94.97 KB`) — **`2.0.0` released 2026-09-02** (override: `M-01..M-12` 26/26, 4-repo dogfood `workpermit` gate `READY`):

- ✅ init
- ✅ sync
- ✅ analyze
- ✅ summarize
- ✅ doctor
- ✅ status (v2 control-plane view)
- ✅ plan
- ✅ verify

See [ROADMAP.md](https://github.com/DoozieSoftware/doozctl/blob/main/ROADMAP.md) for what shipped in `2.0.0-rc.1` + D-01 and what is next, and
`docs/release/V2-CLOSE-OUT.md` for the `2.0.0` promotion gate.

## v1.0 definition

`npx doozctl init` creates a repository that can be worked on interchangeably by any AI assistant — Claude Code, Codex CLI, OpenCode, Gemini CLI, Cursor, and future tools — without losing project memory.

## License

MIT
