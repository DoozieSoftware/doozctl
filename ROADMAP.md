# DoozCTL Roadmap

The goal: a first-time developer installs DoozCTL, runs `doozctl init`, and
gets a repository any AI assistant can work on interchangeably — without losing
project memory.

## v1.0 — Frozen (branch `release/v1`, tag `v1.0.0` — 2026-08-13)

*The reliable release* — everything must answer: does this make a first-time developer more likely to trust and adopt DoozCTL?

- [x] Core workflows: init, sync, analyze, summarize, doctor, status
- [x] Merge engine with all four strategies (`managed-blocks`,
       `replace-generated`, `overwrite`, `append`)
- [x] Repository memory (`.ai/`) with immutable sessions
- [x] CI on Linux/macOS/Windows × Node 20/22/24
- [x] Docs: README, spec, architecture, contributing, security, changelog
- [x] Examples (hello-world, brownfield, generated) in `examples/`
- [x] Release automation (tag → npm publish + draft GitHub release)
- [x] Independent product review (see CHANGELOG `1.0.0-rc.1`)

Maintenance only: security/correctness fixes on `release/v1`.

## v2.0 — Engineering Control Plane — Shipped as `2.0.0-rc.1` + D-01 (2026-08-21 → 2026-09-02)

v1 is the generic, vendor-neutral engine (frozen). v2 adds an **optional** control plane: intent (plans), method (adopted workflows), state (status), proof (verify).

- [x] **2.1** Control-plane contracts frozen — `docs/v2/{V2,PLAN,WORKFLOW,ARCHITECTURE}.md` (`5a37d03`)
- [x] **2.2** Plan domain: 4-field metadata + opaque Markdown, forward-only lifecycle, `PLAN-SPEC v1.0.0` (`d281ece`)
- [x] **2.3** `doozctl plan` — adoption-resolved, collision-safe (`786b8db`)
- [x] **2.4** Workflow adoption — file presence `adopted/`/`project/`, no registry, 5 base methods (`0f2c95f`)
- [x] **2.5** `doozctl status` control-plane view, read-only proven (`041e8aa`)
- [x] **2.6** Evidence contract — 8 cats `acceptance-criteria, changelog:<path>, commit, git-state, release, tests, verification, version:<path>` `WORKFLOW-SPEC v1.2.0` (`a8a42c8` + `abc8f89`)
- [x] **2.7–2.10** Validation + `verify` `READY/NOT READY` + test-fact visibility + path-bound `changelog`/`version` (`fd8f37d`→`abc8f89`)
- [x] **D-01** Workflows optional for `plan` — `plan` succeeds without adopted workflow, `status`/`verify` surface adoption problem (P1 fix, `dac0fa7`, `M-01..M-12` 26/26 passed, 484 tests 96.21%)
- [x] **Dogfood prep** — 3 repos initialized: `vehicle_management` (Daiichi), `tiei_hub` (TIEI), `fims_erp` (FEPL) — each `5 base + client-release` (`changelog:CHANGELOG.md` + `version:package.json`), single `PLANNED` plan, committed

**Next gate before `2.0.0` final:**
- [ ] Manual gate `M-13..M-32` on real repos + at least Linux or Windows (`V2-MANUAL-TESTING.md:268`)
- [ ] Triage findings → blocker / post-freeze / limitation
- [ ] Tag `v2.0.0`

## v2.1 — Dogfood & Discipline Pilot (5 developers, 2–4 weeks)

*After `2.0.0` final* — enforce only `plan→execute→verify→test→commit→merge` via private `@dooziesoft/standards 0.1.0` (`docs/GETTING_STARTED.md`), measure handover≥80%, traceability≥90%, 0 overwrites/secret/silent bypass, friction “saves time”.

- Workflow-aware `doctor` (`.dooz/` health) and E2E script — gated on pilot signal
- Private `client-release` changelog/version + human-approval for merge/release

## Later (deferred)

- `doozctl inspect` deep view — deferred from `v1.1` (not a blocker)
- Schema validation wiring (`DefaultValidator` pass-through) — deferred from `v1.2`
- Standards Package registry (`doozctl install @dooziesoft/standards-laravel`) — only if concrete consumer needs it
- Plugin discovery for custom analyzers/loaders/mergers — only if needed; engine ships none today
- Website `ctl.dooziesoft.com` (documentation, not marketing)
- `plan list/show/validate`, `workflow adopt/list` — only if pilot proves need (no registry/DSL/DB/execute by design)
