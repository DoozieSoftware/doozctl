# DoozCTL v3 — Reality & Gap Audit (V3-P01)

**Status:** Audit complete — input for V3-P02 (CONTEXT-SPEC) and V3-P03 (ARCHITECTURE)
**Audited state:** `b0b41fc` on `main` (release: `v2.0.0` — D-01 + dogfood prep)
**Evidence base:** `src/` implementation, `docs/v2/*` frozen contracts, test suites (484 tests / 30 files per README + V2-CLOSE-OUT), `standards/` sample package
**Audit question (from the v3 plan):** does the v2 implementation, as shipped, let an agent determine whether repository context is still trustworthy before relying on it?

---

# 1. Summary Verdict

**No.** v2 stores context, versioned in Git and durable on disk, but nothing records
_what repository state a context artifact describes_, so nothing can tell whether
that context is still current. The engine cannot currently pass the v3 acceptance
scenario (Agent C must detect that Agent A's context is stale after Agent B's
change) — and, importantly, it also cannot yet _avoid_ false staleness, because no
staleness signal exists at all, not even a noisy one.

The audit's second-order finding is more useful to the v3 design than the list of
missing features:

> **v2 already contains every primitive the integrity engine needs** — deterministic
> read-only commands, sandboxed storage, pure model functions, a git service with
> live facts, immutable session records, forward-only plan state, and a strict
> ownership model for writes. The v3 gap is **missing metadata and missing
> comparison logic**, not missing infrastructure. No second memory/control system
> is required to implement V3-P01…P-14; several v2 invariants (byte-identical
> determinism, store purity, "never overwrite human-owned content") are exactly the
> constraints the integrity engine should inherit.

---

# 2. What v2 Produces — The Context Inventory

Every managed context artifact, its producer, and the provenance metadata it
records _today_ (audited from code, not docs):

| Artifact                                          | Producer (command)                                                 | Machine-parsed metadata it records                                                                                                     | Can it answer "from which commit/branch?"                                        |
| ------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `.dooz/manifest.json`                             | init / sync / summarize (`writeStep`)                              | `version: 1`, artifact `{id, destination}` records                                                                                     | No — no timestamp, no package identity, no git state                             |
| `.ai/repository-analysis.json`                    | init / analyze / sync / summarize (`saveAnalysisStep`/`writeStep`) | `git: {isRepository, branch, dirty}` + languages/frameworks/build/test/CI/statistics                                                   | **Partial** — branch + dirty _at last write_, no commit hash, no written-at time |
| `.ai/current-context.md`                          | summarize (overwrite artifact)                                     | Nothing machine-parsed; sections authored, capped 400 chars/field, objective+open-questions carry forward                              | No                                                                               |
| `.ai/sessions/YYYY-MM-DD_HHMMSS.md`               | summarize (append artifact, immutable)                             | Front-matter via `session` variables: date (ISO), tool, model, user, **commit (live)**, branch (see §3.1 caveat); content capped 12 KB | **Yes — closest thing to provenance in v2**                                      |
| `.dooz/plans/<state>/YYYY-MM-DD-<id>.md`          | `doozctl plan` (+ agent edits)                                     | `id, method, status, created` (date only, no time)                                                                                     | No — creation records no repo state                                              |
| `.dooz/workflows/{adopted,project}/<id>.md`       | manual file copy                                                   | `id` only                                                                                                                              | No (and does not need it — it is policy)                                         |
| `AGENTS.md` / `DEVELOPERS.md` (managed artifacts) | init / sync                                                        | Managed-block markers only                                                                                                             | No                                                                               |
| Source tree + Git                                 | external executors                                                 | —                                                                                                                                      | Git is the only layer that _is_ its own truth                                    |

Evidence sources: `src/model/model.ts` (`Analysis`, `GitFacts`, `Manifest`, `SessionInput`),
`src/model/plan.ts` (4-field metadata), `src/engine/steps.ts` (`writeStep`,
`sessionStep`, `saveAnalysisStep`), `src/store/repository-store.ts`,
`src/store/plan-store.ts`, `tests/integration/summarize.test.ts` (session format).

The v2 category map (V2-SPEC "Context Separation") translates directly to the v3
vocabulary: Rules → Standards, Facts → analysis, Present state → current-context,
History → sessions, Intent → plans, Methods → workflows. **The v3 audit confirms the
boundaries exist on disk but none of the artifacts carries enough state to be
_checked_ against the repository.**

---

# 3. Findings by v3 Capability

## V3-01 — Provenance: ABSENT (one partial exception)

- **Plans are minted with no repository context.** `PlanStore.create`
  (`src/store/plan-store.ts`) writes the template using only `id`, `method`, and a
  clock-derived `YYYY-MM-DD` date (`formatPlanDate`). No commit, no branch, no
  dirty flag, no session id, no baseline of any kind. `doozctl plan` performs no
  git read (`src/app/app.ts: plan`).
- **The facts file cannot state which commit it describes.** `Analysis.git`
  (`src/model/model.ts`) has `isRepository`, `branch`, `dirty` — no `commit`. The
  analyzer never calls `commitHash`:

  - `src/engine/repository-analyzer.ts` (`analyze`)
  - `GitService.commitHash` exists but is only used by the summarize path
    (`src/engine/steps.ts: sessionStep`)

- **Sessions are the one provenance-carrying artifact**: front-matter records
  tool/model/user, live commit, branch, date (`tests/integration/summarize.test.ts`
  asserts `- Commit: <hash>` / `- Branch: <branch>`).
- **Manifest records no generation time and no standards-package identity.**
  `Manifest = {version, artifacts[]}` only; nothing ties a rendered artifact to the
  package version that produced it or the repository state it was rendered from.
- **`current-context.md` carries forward the previous session's Objective/Open
  Questions** (`resolveContextFields`, `src/engine/session.ts`) — by design a
  blend of sessions, so its provenance is _mixed_ with no marker of which session
  each field came from.

**Gap for P02/P03:** provenance must be a _declared, small_ metadata set on the
artifacts that describe repository state (plans, analysis, sessions, current
context) — captured at creation from the live repository — plus a definition of
"mixed" for derived artifacts like current-context.

## V3-02 — Freshness/staleness detection: ABSENT

- No `CURRENT/STALE/UNKNOWN/UNTRACKED` states exist anywhere. The words
  "stale" and "freshness" appear in `src/` only in comments
  (`src/store/repository-store.ts`, a test fixture string) and never as
  behavior.
- The engine's only freshness-adjacent signals are read at _command time_, never
  compared against a baseline:
  - `status` and `verify` re-analyze live (`src/app/app.ts: status/verify` →
    `buildStatusReport`/`buildVerifyReport`) and show branch + clean/dirty, but
    nothing is compared to what the plan or analysis _assumed_.
  - `doctor` re-analyzes live and flags an uncommitted working tree
    (`buildDoctorReport`), but that is a hygiene check, not a staleness check.
- **`sync` deliberately renders from the _stored_ analysis, never re-analyzing**
  (`syncPipeline`, `src/engine/pipelines.ts`) for run-to-run determinism. The
  tension the v3 plan must resolve is visible here already: deterministic
  re-render from stored state vs. stored state going stale. Today the stale case
  is silent.

**Gap for P02/P03:** staleness requires a _baseline to compare against_. v2 never
records baselines (V3-01 gap), so V3-02 has nothing to compute on. The natural
first deterministic signals per the v3 plan (source commit changed, referenced
files changed, plan scope changed, paths disappeared) all reduce to "compare a
recorded baseline to current git facts" — all read-only git operations.

## V3-03 — Context scope: ABSENT as machine data

- Plans have `## Scope` / `### In Scope` / `### Out of Scope` sections
  (PLAN-SPEC template), but they are opaque prose — never parsed, never compared
  to repository changes (`src/model/plan.ts: planSection` reads any heading as
  text; no path extraction or validation exists).
- No context artifact declares paths it describes. Nothing distinguishes "the
  repository changed" from "the repository changed in the area this context
  describes".

**Gap:** scope must become a small _machine-checkable_ declaration (paths, or a
plan reference) so staleness can be scoped — the plan's own requirement for the
second acceptance test (don't mark unrelated context stale).

## V3-04 — Authoritative boundaries: DOCUMENTED ONLY, never enforced at read time

- V2-SPEC's ownership model table and WORKFLOW-SPEC's override hierarchy are
  documentation. The engine checks file _ownership_ for writes (managed-block
  markers, manifest records, `overwrite` ownership guard — see
  `mergeStep`/`assertOverwriteOwned` in `src/engine/steps.ts` and
  `src/engine/merge.ts`) but has no notion of _authority_ when _reading_ content.
- **The one place v2 silently promotes a category is evidence.** An agent-authored
  `## Test Evidence` / `## Verification` / `## Commit` section is treated by
  `verify` as machine-level evidence (✓) on the basis of non-emptiness
  (`evaluateRequirement`, `src/engine/report.ts`). WORKFLOW-SPEC says the engine
  checks "presence, never quality or truthfulness" and the manual-testing risk
  register records it as L-1 ("By contract; executor integrity is the model").
  This is precisely the v3 failure the plan names — _recorded_ is presented as
  _authoritative_, with no freshness qualifier.
- "Generated context can inform but cannot silently override authoritative
  sources" has no runtime counterpart today; e.g. a stale
  `.ai/repository-analysis.json` `branch` value is silently consumed by
  summarize (see next finding).

**Gap for P02/P03:** authority must be _declared_ on artifacts (generated /
human-owned / mixed) and the read paths must refuse to present stale or derived
content as facts — starting with the two current silent promotions: stored
analysis consumed without a freshness qualifier, and presence-based evidence
reported without a "recorded, not verified-against-HEAD" qualifier.

## V3-05/V3-13 — Context validation & CLI surface: no `context`/`plan`/`evidence` subcommands

Registered commands (`src/index.ts: registerCommands`): `init · analyze · sync ·
doctor · summarize · status · plan · verify`. None of the candidate v3 commands
exist (`context status/validate/inspect`, `plan validate`, `evidence validate`);
`plan list/show/validate` are deferred on the roadmap by design. The plan's
instruction to "first establish contracts and determine which commands materially
improve dogfood" matches the v2 pattern of freezing contracts before commands.

## V3-06 — Status integration: no context-integrity surface

`buildStatusReport` (`src/engine/report.ts`) shows repository facts (path,
branch, clean/dirty), initialization, artifact count, active plan (id/method/
status/next), lifecycle progress checklist, and next action. There is no context
summary block, no staleness counts, nothing about the analysis file's freshness.
`status` reads only `active/` plans (multi-active is a problem, not a view), and
requires an initialized repository.

## V3-07 — Handoff integrity: STRONG FOUNDATION, missing staleness exposure

What v2 already gives a handoff:

- Sessions are immutable, budgeted (12 KB), and carry tool/model/user/date/commit/
  branch (§3.1).
- The session format is a frozen six-section contract: Objective, Summary,
  Decisions, Files Changed, Next Steps, Open Questions
  (`SESSION_SECTIONS` in `src/engine/session.ts`), and objective/open
  questions carry forward across sessions.
- `doctor` warns "Working tree has uncommitted changes. Commit before
  summarizing" — an intent to keep handoffs honest, though it is advisory (only a
  doctor problem; summarize itself will record a dirty tree against the previous
  commit without comment).

What is missing per the v3 plan's handover requirements: no session links to the
active plan; no "evidence state" section; no "known stale context / unresolved
assumptions" exposure; no statement of what the session's commit does _not_
cover. The v3 "one next work package" rule is currently only a convention in the
session template's Next Steps, not a contract.

## V3-08 — Multi-agent branch safety: UNMODELED

- Nothing identifies participants or the repository state each participant acted
  on. Two agents summarizing on one branch produce ordered but unlinked session
  files; `current-context.md` is last-writer-wins with no conflict detection.
- The manual-testing register already names the risk: L-8 "Concurrent
  modifications to `.dooz/` untested — two agents racing" with a single-operator
  assumption.
- Git _is_ the coordination substrate today (all context is committed like source,
  per docs/v2/ARCHITECTURE), which matches the v3 plan — the missing piece is
  detection of "state changed between sessions", which again reduces to baseline
  capture (V3-01) + comparison (V3-02).

## V3-09 — Reconciliation, not blind regeneration: the _write_ model already agrees

The v2 merge engine already embodies the v3 constraint on the file level:

- Managed blocks and developer content coexist; `sync` never destroys
  user-authored content (`managed-blocks` merge, `src/engine/merge.ts`).
- `overwrite` refuses to replace files the engine did not create
  (`assertOverwriteOwned`); `replace-generated` refuses non-generated files.
- Plans are never overwritten or deleted (`plan-store` collision errors,
  forward-only transitions, CLI humanization "DoozCTL never overwrites a plan").
- Sessions are immutable (same-second collision fails).

There is no delete → regenerate path in the engine at all. The v3 design can adopt
these rules as-is for the _content_ level: generated artifacts refreshable,
human-owned material must be reconciled explicitly, mixed artifacts need explicit
handling. `doctor`'s repair guidance ("re-run init or sync") is regeneration;
v3's VALIDATE → STALE → RECONCILE replaces the blind half of that advice for
context artifacts.

## V3-10 — Plan ↔ repository drift: ABSENT

- Plan statuses describe the _execution_ lifecycle only (PLANNED → … → COMPLETED,
  forward-only). There is no plan-level "Context: STALE" indicator and no signal
  that the repository moved after the plan was written.
- Nothing records the plan's baseline (V3-01), so nothing can observe
  "`src/PunchService.php` changed since plan creation".
- The `## Commit` section is free prose; nothing validates that its hash still
  exists on the branch or matches HEAD.

## V3-11 — Evidence freshness: the sharpest, most concrete gap

`verify`'s checks (`src/engine/report.ts: evaluateRequirement`):

| Category              | Check today                          | Freshness blind spot                                                                      |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `acceptance-criteria` | section non-empty                    | prose; nothing ties it to repo state                                                      |
| `changelog:<path>`    | file exists, non-empty               | a changelog written for an older release satisfies the _current_ plan (L-2, acknowledged) |
| `commit`              | `## Commit` section non-empty        | **a hash recorded at an earlier HEAD still ✓ after the branch moved on**                  |
| `git-state`           | live: in a git repo                  | ✓ live — no blind spot                                                                    |
| `release`             | live: HEAD tagged                    | ✓ live                                                                                    |
| `tests`               | `## Test Evidence` section non-empty | recorded text is never compared to the current tree or the recorded commit                |
| `verification`        | `## Verification` section non-empty  | same                                                                                      |
| `version:<path>`      | file exists + semver                 | file presence at _current_ tree, fine; but "matches this release" is out of contract      |

The `git-state` and `release` categories prove the engine _can_ check live
read-only git facts; the recorded-evidence categories are where staleness is
silent. The plan's own deterministic handle for V3-11 is already available:
compare the hash recorded in the plan's `## Commit` section (and the session's
front-matter) against `HEAD`/`git log` — read-only, no semantics needed. This is
the natural first integrity check to implement.

## V3-12 — Explicit trust states: ABSENT

The CLI vocabulary is ✓/✗ presence and READY/NOT READY. Nothing distinguishes
TRUSTED (grounded in current repo state) from STALE/UNKNOWN/INVALID. Note that
`verify`'s READY already over-claims relative to the v3 trust definition: it
asserts evidence presence, not grounding in the current repository state.

---

# 4. Design Constraints the Audit Surfaces (for V3-P03)

1. **Byte-identical determinism is a tested invariant.** Read-only commands are
   proven byte-identical across repeated runs (V2-CLOSE-OUT; integration suite),
   and state writes are skipped when byte-identical (`RepositoryStore.saveAnalysis`,
   `writeStep`). Any provenance field that injects wall-clock time into _stored_
   state would break idempotency tests and cause timestamp churn. **Design rule:
   store comparisons and baselines; put timestamps only in human-facing reports,
   or record them only when a baseline actually changes.**
2. **Store/model purity is a pattern, not an accident.** Plan and session parsing
   are pure and clock/git-free (`src/model/plan.ts`, `src/engine/session.ts`);
   clock and git are injected at the app/step layer (`AppDeps.now`,
   `sessionStep`). Provenance capture must follow the same split: capture at the
   command layer, keep model functions pure and deterministic.
3. **Read-only git is already engine behavior.** `GitService` runs `rev-parse`,
   `status --porcelain`, `tag --points-at` (`src/infra/git/git.ts`). Adding
   read-only comparisons (`log`, `diff`, path checks) is consistent with the
   existing posture and with v2's "records and validates; never executes".
4. **No new infrastructure.** The v3 non-goals (no DB, no vector store, no daemon,
   no cache, no registry) align with the v2 minimalism rule ("prefer Markdown +
   existing Storage + existing JSON + pipeline patterns"). All integrity signals
   are derivable from existing files plus read-only git.
5. **Category promotion is the enemy, and v2 already does it twice.** (a) stored
   `analysis.git.branch` is consumed by summarize without a freshness check
   (`sessionStep` reads `ctx.analysis` loaded from disk); (b) presence-based
   evidence is presented without a "recorded, not verified" qualifier. v3's
   first deliverables should make both silent promotions visible.
6. **Session `branch` provenance has a latent bug worth fixing in P04.** The
   session front-matter records a _live_ commit but a branch read from the
   _stored_ analysis — after a branch switch without a re-`analyze`, a session
   can pair a new commit with the old branch. (Doctor/status/verify re-analyze
   live and are unaffected; summarize does not.)
7. **The 484-test gate and 96%+ coverage are part of the contract.** Any v3 work
   package inherits the v2 testing requirements: unit + integration +
   deterministic-output + malformed-input + idempotency + safety tests, and must
   not weaken the gate.
8. **Storage sandboxing and hostile-input rules carry over.** Provenance and
   scope declarations are authored content (plans, workflows, session templates);
   any path or id parsed from them must go through the existing validation
   (`isValidPlanId`, `isSafeRelativePath`, `Storage` confinement) before
   filesystem or git use.

---

# 5. What v3 Can Build On (assets, not gaps)

- Immutable, git-fact-carrying **sessions** → the handoff-integrity base (V3-07).
- **Live re-analysis in status/verify/doctor** → precedent for read-only current-
  state views; V3-06's context block can hang off `buildStatusReport` without
  changing its read-only proof.
- **Presence-based verify with a closed evidence vocabulary** → V3-11 extends the
  vocabulary (one table row + one deterministic check per WORKFLOW-SPEC rule),
  not invents a new one.
- **Forward-only plan lifecycle + never-overwrite rules** → V3-10 "Context: STALE"
  can be added as an _observation about_ a plan (read-only report) without
  touching the frozen metadata contract.
- **Ownership-aware merge engine** → V3-09's reconcile-not-regenerate rule is
  already the file-level default.
- **Deterministic, read-only command reports** — the `CommandReport` shape
  (`{report, problems}`) is exactly what a read-only `context validate` should
  emit.
- **The override hierarchy in WORKFLOW-SPEC** (mandatory policy → overlay →
  method → project extension) → a working precedent for the v3 authority model
  (V3-04), which must be validated in P03 against the v3 proposal rather than
  hard-coded from it.

---

# 6. Pre-Check of the v3 Acceptance Scenario Against v2

**Scenario:** Agent A creates context at commit X (plan + session). Agent B
changes the relevant feature at commit Y. Agent C consumes Agent A's context.

| Step in the scenario                              | Does v2 detect it? | Why                                                                                                           |
| ------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| C learns the context was made at X                | No                 | No baseline on plans/analysis; sessions do record X                                                           |
| C learns the repository is now at Y ≠ X           | Partially          | `status` shows branch + clean/dirty only — **not the commit**, so C cannot even see Y                         |
| C learns _relevant_ files changed between X and Y | No                 | No scope declaration, no diff                                                                                 |
| C is warned the context may be stale              | No                 | No staleness path in any command                                                                              |
| C can still tell what is authoritative/current    | Partially          | `verify` juxtaposes live git-state/release/test-facts, but recorded evidence sections are trusted on presence |

**Inverse scenario:** Agent B changes an _unrelated_ part of the repository.

| Step                                       | Does v2 pass it?               | Why                                                                                                                                                                |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C's unrelated context is not flagged stale | N/A today — nothing is flagged | The noise risk the v3 plan warns about cannot be measured yet; v3 must build scope in from day one or the first release _will_ be an "everything changed" detector |

---

# 7. Verdict for the V3-P01 → P02/P03 Gate

The v3 plan's own gate question — _can the model be implemented without
introducing a second memory/control system?_ — is answerable from this audit:

**Yes.** The integrity model is implementable as (a) a small amount of _new
declared state_ (baseline/scope/ownership metadata on plans, and a commit+written-
state field on the analysis file), captured at creation using the existing
app-layer pattern, plus (b) read-only comparison logic over existing artifacts
and git facts, exposed through the existing report/command machinery. All
constraints that make this hard (determinism, purity, safety, no new
infrastructure) are _already enforced v2 invariants_ the design can inherit.

**Recommendations for P02/P03:**

1. **Record baselines first, everywhere context is created**: plan creation
   (commit + branch + dirty + optional scope paths), analysis writes (commit +
   state-at-write), sessions (already mostly done — fix the stored-branch bug).
2. **Start V3-06/07 (status block + handover exposure) before V3-09/10** — the
   read-only reporting surfaces are the cheapest way to expose silent promotions
   and validate the vocabulary against real dogfood repos.
3. **Make the first integrity check the commit comparison** (plan `## Commit`
   hash and session front-matter vs. current `HEAD`/log): fully deterministic,
   zero semantics, and it directly kills the worst silent-promotion case today.
4. **Do not add wall-clock fields to stored state**; store baselines and let
   reports derive age. This preserves the byte-identity and idempotency proofs.
5. **Require scope before staleness** (V3-03 into the spec, not deferred), or the
   second acceptance test — the guard against a noisy "everything changed"
   detector — cannot be met.
6. **Validate the V3-04 authority hierarchy against WORKFLOW-SPEC's override
   hierarchy** during P03; the v2 hierarchy is extension-not-inheritance and the
   v3 proposal must not reintroduce inheritance semantics.

---

# Appendix — Evidence Index

| Claim                                    | Evidence                                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command surface                          | `src/index.ts: registerCommands` (8 commands)                                                                                                      |
| Manifest shape                           | `src/model/model.ts` (`Manifest`), `src/engine/steps.ts: writeStep`                                                                                |
| Analysis shape / no commit               | `src/model/model.ts` (`Analysis`, `GitFacts`), `src/engine/repository-analyzer.ts: analyze`                                                        |
| Plan metadata surface                    | `src/model/plan.ts` (4 fields, template, lifecycle), `src/store/plan-store.ts: create`                                                             |
| Plan creation git-free                   | `src/app/app.ts: plan` (no git dep; `PlanStoreDeps` has only `now`)                                                                                |
| Session provenance                       | `src/engine/session.ts`, `src/engine/steps.ts: sessionStep`, `tests/integration/summarize.test.ts`                                                 |
| Session branch from stored analysis      | `src/engine/pipelines.ts: summarizePipeline` (loads stored state) + `steps.ts: sessionStep` (`ctx.analysis.git.branch`)                            |
| Live re-analysis in status/verify/doctor | `src/app/app.ts: status/verify`; `src/engine/pipelines.ts: doctorPipeline`                                                                         |
| sync uses stored analysis                | `src/engine/pipelines.ts: syncPipeline` (no analyze step)                                                                                          |
| Evidence presence-only checks            | `src/engine/report.ts: evaluateRequirement`, `docs/v2/WORKFLOW-SPEC.md` (Canonical Evidence Categories), L-1/L-2 in `docs/v2/V2-MANUAL-TESTING.md` |
| Ownership / never-overwrite              | `src/engine/steps.ts: mergeStep/assertOverwriteOwned`, `src/engine/merge.ts`, plan-store collision + transition rules                              |
| Determinism / idempotency                | `src/store/repository-store.ts`, `steps.ts: writeStep` (skip byte-identical), V2-CLOSE-OUT (read-only byte-identity)                               |
| Single-operator / concurrency risk       | L-8 in `docs/v2/V2-MANUAL-TESTING.md`                                                                                                              |
| Version / test count                     | `package.json` (2.0.0), README + V2-CLOSE-OUT (484 tests, 96.21% st / 93.38% br)                                                                   |
