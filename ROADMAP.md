# DoozCTL Roadmap

The goal: a first-time developer installs DoozCTL, runs `doozctl init`, and
gets a repository any AI assistant can work on interchangeably — without losing
project memory.

## v1.0 — The reliable release

Everything must answer: **does this make a first-time developer more likely to
trust and adopt DoozCTL?**

- [x] Core workflows: init, sync, analyze, summarize, doctor, status
- [x] Merge engine with all four strategies (`managed-blocks`,
      `replace-generated`, `overwrite`, `append`)
- [x] Repository memory (`.ai/`) with immutable sessions
- [x] CI on Linux/macOS/Windows × Node 20/22/24
- [x] Docs: README, spec, architecture, contributing, security, changelog
- [ ] Examples repository (hello-world, brownfield, generated)
- [ ] Release automation (tag → npm publish)
- [ ] Independent product review, then `v1.0.0`

## v1.1 — Understanding

- **`doozctl inspect`** — what `status` lacks: a deep view of what DoozCTL
  understands about a repository (artifacts, memory sessions, analysis
  freshness). Not a v1 blocker.

## v1.2 — Verification

- Schema validation wired into the validate step (`DefaultValidator` is a
  pass-through today).
- `doctor` deep-checks artifact sources and destination collisions.

## Later

- Standards Package registry (`doozctl install @dooziesoft/standards-laravel`).
- Plugin discovery for custom analyzers, loaders, and merge strategies (the
  seams already exist in `src/engine/contracts.ts`).
- Website: `ctl.dooziesoft.com` (documentation, not marketing).
