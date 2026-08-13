# Changelog

All notable changes to DoozCTL are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-08-13

Stable release of the generic, vendor-neutral Repository Standards Engine.

### Summary

- Repository analysis — factual, deterministic metadata (languages, frameworks,
  build system, package manager, test framework, CI, statistics).
- Standards Package loading — format 2 manifests with artifact lifecycle
  (init / sync / summarize); external packages only; the engine knows no
  artifact names or meanings.
- Deterministic rendering — Mustache-subset templates, LF-normalized,
  byte-identical for identical inputs.
- Deterministic merge — four frozen strategies (managed-blocks,
  replace-generated, overwrite, append); text-only, no Git; fails safely on
  malformed input; never partially writes.
- Safe brownfield behavior — unmanaged files are never silently overwritten;
  `overwrite` requires destination-bound ownership (manifest record or
  generated marker); sandboxed storage rejects path traversal, symlink
  escapes, and dangling symlinks.
- Repository state — `.dooz/manifest.json` (destination-bound artifact
  records) and `.ai/repository-analysis.json` (machine-readable facts),
  written atomically and byte-stable on repeated runs.
- Session memory — immutable `doozctl summarize` sessions
  (`.ai/sessions/`) with a hard content budget, and a compact
  `.ai/current-context.md`.
- `doctor` / `status` — health checks (manifest coverage, artifact existence,
  managed-block integrity, live git state) and analysis reports; exit codes
  0 / 1 / 2.
- CLI — six workflows (init, sync, analyze, summarize, doctor, status) with
  per-command help, usage examples, and human-readable errors.

### Changed

- `overwrite` is now guarded by first-write ownership: it may only replace
  files the engine created (recorded in the manifest **bound to its
  destination**, or carrying the generated marker). A pre-existing user-owned
  destination fails safely and stays untouched — `init` can no longer destroy
  a user's `.gitignore`, and reusing a recorded artifact id at a different
  destination grants no ownership.
- Storage sandbox now enforces containment against real filesystem paths;
  symlinks inside a repository — including dangling symlinks — can no longer
  be used to read or write outside it.
- Removed AI-vendor file detection from the repository analyzer (`aiFiles`,
  AGENTS/CLAUDE/CODEX/GEMINI/CURSOR patterns). The engine knows no artifact or
  vendor names.
- `doctor` performs real health checks (manifest coverage, artifact existence,
  managed-block integrity) against live repository state, and returns exit
  code `1` when problems are found. Invalid arguments return exit code `2` for
  every command.
- Session summaries are budgeted: raw content over 12 KB is truncated with a
  notice, keeping repository memory compact.
- Removed dead scaffolding: `PluginManager`, the unused renderer seam, the
  session/context store stubs, and the unused `Session`/`Plugin` model types.
- SPEC, ARCHITECTURE, README, FAQ and the docs site now describe the actual
  product (pipeline order, doctor checks, exit codes, overwrite ownership,
  generated-state ownership).

## [1.0.0-rc.1] — 2026-08-09

### Added

- `doozctl doctor` — health report verifying initialization, Standards Package
  loading, artifact declaration, and manifest coverage.
- `doozctl status` — analysis report describing what DoozCTL understands about
  the repository.

### Fixed

- `doctor` no longer reports a false "Problems found" (and wrong "run init to
  repair" advice) on a healthy repository that declares `summarize`-lifecycle
  artifacts. Only artifacts that `init`/`sync` persist are expected in the
  manifest; `summarize`-only artifacts are recorded later by `summarize`.
- Bare `doozctl` (no arguments) now prints help and exits 0, matching the
  tested `runCli` behavior.

## [0.3.0-alpha.1] — 2026-08-09

### Added

- `doozctl summarize <repo> <package> <session>` — appends an immutable session
  summary to `.ai/sessions/YYYY-MM-DD_HHMMSS.md` and rewrites
  `.ai/current-context.md` with carry-forward of Objective and Open Questions.
- Session front-matter flags `--tool`, `--model`, `--user`; `date`, `commit`
  and `branch` are derived automatically.
- Same-second session id collisions fail instead of overwriting (sessions are
  immutable).
- `{{session.*}}` render variables, including capped current-context fields.

### Fixed

- The engine manifest now records the union of artifact ids from every
  workflow, so init-only artifacts survive later sync runs.

## [0.2.0] — earlier

### Added

- `doozctl init` and `doozctl sync` with the frozen merge engine
  (`managed-blocks`, `replace-generated`, `overwrite`, `append`).
- `doozctl analyze` — updates `.ai/repository-analysis.json` only.
- Repository memory layout: `.ai/current-context.md`,
  `.ai/repository-analysis.json`, `.ai/sessions/`.

## [0.1.0] — initial

### Added

- The repository standards engine core: analyzer, variable resolver, standards
  loader, renderer, merge engine, and command pipeline.
