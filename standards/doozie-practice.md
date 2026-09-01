# Doozie Engineering Practice — distilled from GEMINI.md

This document is the private Doozie interpretation of `GEMINI.md` (global agent rules) filtered for DoozCTL. It is **reference only** — it is not installed into consumer repositories. `AGENTS.md` stays lean and points here for detail.

DoozCTL principle: the engine renders artifacts; standards define behavior. The repository owns knowledge. Keep hot context minimal.

---

## 1. Intent classification (GEMINI §1)

Before acting, classify: **Question / Analysis / Execution**. Do not convert analysis into implementation without authorization. For non-trivial execution, establish outcome, scope, constraints, acceptance, verification method as the completion contract. Maps to DoozCTL context separation: `Plan` = intent, `Required Evidence` = acceptance, `verify` = gate.

## 2. Investigate before editing (GEMINI §3)

Inspect repository evidence first: `spec.md`, `.ai/repository-analysis.json`, `.dooz/plans/active/*.md`, `.dooz/workflows/adopted/*.md`, callers, tests, config. Prefer evidence over assumption. Search for existing implementation before new abstraction. Stop when further exploration no longer reduces uncertainty.

## 3. Follow the repository (GEMINI §4)

Existing architecture is authoritative. Prefer simple over clever, existing patterns over invented frameworks, root-cause fix over patch, incremental over rewrite, explicit over magic. Smallest coherent change that solves the problem — aligns with DoozCTL philosophy: minimal context, brownfield first, deterministic over magical.

## 4. Explicit gates are hard gates (GEMINI §6)

Every gate in `PLAN-SPEC.md` / `WORKFLOW-SPEC.md` `## Required Evidence` is mandatory. Verify each with concrete evidence (`doozctl verify` for evidence, `doozctl doctor` for health). Never infer PASS from file existence, syntax passing, or adjacent checks. If any gate lacks evidence, report PARTIAL/BLOCKED — never DONE & VERIFIED.

## 5. Verification is part of implementation (GEMINI §7)

Progressive: `targeted check → fix failures → affected-area regression → final diff review`. Never claim a command passed without execution and observation. Never claim runtime correctness from reading code alone. Keep verification proportional to risk; avoid repeated expensive full suites without reason.

## 6. Review before done (GEMINI §8) & Failure recovery (GEMINI §9)

Before completion: implemented the actual request? Every gate has evidence? Happy path + relevant edge cases? No hidden regressions, stubs, TODOs, debug code? Final diff inspected? Brief red-team for correctness/security/race/performance/complexity. On failure: inspect actual failure, correct meaningfully, rerun relevant verification — never blindly retry.

## 7. Safety (GEMINI §10)

No hard-coded secrets; use env/secret manager. No unrelated repo changes. Require confirmation for destructive operations (data deletion, `rm -rf` outside cleanup, rewriting remote history, privileged config, non-disposable env). Routine reversible dev actions do not require confirmation.

## 8. Context / Output discipline (GEMINI §11–12)

Treat context, tokens, tool calls as resources. Prefer actions that reduce uncertainty. Avoid duplicate searches, rereading unchanged files, verbose narration, ceremonial docs. Prefer execution over narration; create task lists/plans only when governance requires or handoff materially improves.

## 9. Definition of Done (GEMINI)

DONE & VERIFIED only when: scope complete, acceptance satisfied, every explicit gate has direct evidence, appropriate verification ran and passed, final diff reviewed, no blocker. PARTIAL = work/verification remains. BLOCKED = genuinely needs external input/authorization/infrastructure/decision.

---

## What was NOT incorporated (and why)

- Subagent/parallelism tactics and quota micro-optimisation — DoozCTL prefers Markdown + existing `Storage`/pipeline primitives; no new coordination layer.
- Auto-generated task lists/walkthroughs — AGENTS.md is hot context; detailed guidance lives here, not in the managed blocks.
- Model-specific verbosity — vendor-neutral per DoozCTL constraint.

Related specs: `spec.md` (frozen v1), `docs/v2/V2-SPEC.md`, `PLAN-SPEC.md`, `WORKFLOW-SPEC.md`.
