# DoozCTL v1.0.0 — Freeze Report

**Date:** 2026-08-13 · **Status:** FROZEN (local)

## Release facts

| Item | Value |
|---|---|
| Version | **1.0.0** |
| Tag | `v1.0.0` (annotated, local) |
| Commit | `a871f88` (`release: freeze DoozCTL v1.0.0`) |
| Release branch | `release/v1` (v1 maintenance/hotfixes) |
| Engine | Node.js >= 20 (built and verified on Node 25; CI matrix 20/22/24) |
| Tests | **267 passed** (25 files) |
| Coverage | **94.39%** statements/lines, 91.5% branches, 98.66% functions |
| Typecheck / lint / format | green |
| Build | tsup ESM bundle — green |
| Package | `npm pack` = 5 files (package.json, README, LICENSE, dist/index.js, dist/index.js.map); 57.3 kB tarball |

## Commands (six workflows)

`init` · `sync` · `analyze` · `summarize` · `doctor` · `status` — each with
`--help`, usage examples, human-readable errors, exit codes 0 / 1 / 2.

## Safety verification (verified live + test suite)

- Path traversal: blocked (sandbox root escape rejected) ✅
- Symlink escape: blocked (realpath containment) ✅
- Dangling symlink: rejected ✅
- Unmanaged existing files: never silently overwritten; init refuses with
  actionable guidance ✅
- `overwrite` ownership: requires destination-bound manifest record or the
  generated marker; id-reuse at a different destination grants nothing ✅
- Atomic writes: manifest/analysis via temp+rename; merge failures
  short-circuit before any write ✅
- Managed markers: frozen v1 format only; malformed blocks fail safely ✅
- Determinism: repeated init/sync byte-stable; no timestamp churn on
  unchanged state (verified live: md5-identical across runs) ✅

## Package verification

`npm pack --dry-run` + isolated install of the tarball in a clean directory:
`--version` → 1.0.0, `--help` OK, init/sync/doctor/status all passed against
a temporary repository; generated files (AGENTS.md, `.dooz/manifest.json`,
`.ai/repository-analysis.json`) verified. No secrets, no dev-only files, no
test corpus in the package.

## Known limitations (v1)

- Whole-workflow crash atomicity: artifacts are written per-file; a hard
  failure mid-write can leave earlier artifacts written (SPEC does not
  require rollback).
- Ownership forgery via a locally edited manifest is possible by anyone with
  repo write access (unsigned local state by design).
- Managed-blocks does not propagate surrounding boilerplate on sync;
  boilerplate updates require replace-generated or manual edits.
- Session immutability collision: two summarizes in the same second fail
  (wait one second) by design.
- `.ai/current-context.md` and sessions are declared artifacts; a package
  that omits summarize-lifecycle artifacts produces no memory (documented).

## Explicitly deferred v2 scope (NOT in v1)

Workflow methods, plan management, workflow adoption/enforcement, an
`execute` command, workflow state machines, project workflow overrides,
engineering evidence tracking, agent integrations, coding-agent
orchestration, and any `.dooz` control-plane redesign.

## Maintenance policy

`release/v1` receives only: security fixes, correctness fixes, release/build
fixes, regressions against the frozen SPEC, and critical compatibility fixes.
No new product capabilities enter v1. v2 development proceeds separately
from the frozen v1 maintenance line.
