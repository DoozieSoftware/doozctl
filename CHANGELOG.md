# Changelog

All notable changes to DoozCTL are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
