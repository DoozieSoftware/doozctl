# DoozCTL v2.0.0-rc.1 — Close-Out Report

**Date:** 2026-08-21 · **Status:** CLOSED for development (release candidate)

v2 development is closed at the end of Phase 2.10. The remaining roadmap
items (2.11–2.15) are **deferred, not forgotten** — they are gated on manual
testing of what shipped (see `docs/v2/V2-MANUAL-TESTING.md`). Promotion to
final **2.0.0** happens when the manual-testing exit criteria pass.

---

## Release facts

| Item                     | Value                                                                |
| ------------------------ | -------------------------------------------------------------------- |
| Version                  | **2.0.0-rc.1**                                                       |
| Base                     | frozen v1.0.0 engine (untouched semantics)                           |
| Close commit             | this commit (`docs(release): add v2 close-out report`)               |
| Tests                    | **483 passed** (30 files)                                            |
| Coverage                 | 96.19% statements / 93.36% branches                                  |
| Typecheck / lint / build | green                                                                |
| Format                   | green except pre-existing `docs/release/V1-FREEZE.md` (out of scope) |

## What v2 delivered (phases 2.1–2.10)

| Capability                                                                   | Where     |
| ---------------------------------------------------------------------------- | --------- |
| Frozen control-plane contracts (V2/PLAN/WORKFLOW/ARCHITECTURE specs)         | `5a37d03` |
| Plan domain: 4-field metadata + opaque Markdown body, forward-only lifecycle | `d281ece` |
| `doozctl plan` — adoption-resolved methods, collision-safe creation          | `786b8db` |
| Workflow adoption — file presence in `adopted/` or `project/`, no registry   | `0f2c95f` |
| `doozctl status` — repository + control-plane view, read-only proven         | `041e8aa` |
| Evidence contract — canonical checklist vocabulary (WORKFLOW-SPEC v1.1.0)    | `a8a42c8` |
| Evidence-declaration validation — invalid requirements fail loudly           | `fd8f37d` |
| `doozctl verify` — READY/NOT READY against recorded evidence + git facts     | `3f6501f` |
| Test-fact visibility beside recorded test evidence                           | `f8dfd1f` |
| Path-bound `changelog:<path>` / `version:<path>` categories (v1.2.0)         | `abc8f89` |

Contract state at closure: WORKFLOW-SPEC **v1.2.0**, PLAN-SPEC v1.0.0
(unchanged), V2-SPEC v2.0.0-contract (closure note added), ARCHITECTURE
unchanged.

## The product sentence this closes

> V1 preserves and transfers repository context. V2 adds an optional,
> repository-local engineering control plane: intent (plans), method
> (adopted workflows), state (status), and proof (verify) — durable,
> inspectable, and transferable between humans and AI agents.

DoozCTL records and validates; it never executes engineering work.

## Safety posture carried into rc.1

- Read-only commands (`status`, `verify`, `doctor`) proven byte-identical
  across repeated runs, including `.git`.
- Storage sandbox: no read/write escapes the repository root through
  symlinks; hostile ids and traversal paths rejected before filesystem use.
- Plans are never overwritten; workflow declarations that cannot be
  understood fail clearly instead of being guessed.
- All eight categories of evidence check presence only — the engine never
  runs commands, judges quality, or fabricates state.

## Deferred (was 2.11–2.15)

| Item                                   | Reason deferred                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Execution handoff guidance (AGENTS.md) | Should be written against manually-validated output, not spec assumptions        |
| Workflow-aware doctor                  | Complements status/verify; not required for the control-plane loop to function   |
| Dedicated end-to-end integration pass  | Per-phase integration tests exist; a single scripted E2E belongs with dogfooding |
| Independent red-team review            | Gated on manual testing findings first                                           |
| Final 2.0.0                            | Gate: manual-testing exit criteria in `docs/v2/V2-MANUAL-TESTING.md`             |

## Known limitations at closure

Full register in `docs/v2/V2-MANUAL-TESTING.md` §7. Headlines: verify checks
presence, never truthfulness; `changelog` is presence-based (not "updated");
commands expect to run from the repository root; only macOS is CI-proven;
adoption is manual file copying (no `workflow adopt` command by design);
method-defined lifecycle states unsupported (canonical seven only).

## Path to final 2.0.0

1. Execute `docs/v2/V2-MANUAL-TESTING.md` scenarios M-01–M-32.
2. Triage deviations → blocker fix / post-freeze improvement / documented
   limitation.
3. Tag `v2.0.0` and flip the version when exit criteria pass.
