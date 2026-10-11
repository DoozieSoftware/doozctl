# DoozCTL v3 Architecture

**Version:** 1.0.0-contract (v3 architecture)
**Status:** Frozen for v3 (intended structure; no implementation yet) — validated against the frozen v2.0.0 architecture at `b0b41fc` on `main`
**Input:** [CONTEXT-SPEC.md](./CONTEXT-SPEC.md) (v1.0.0) · [REALITY-AUDIT.md](./REALITY-AUDIT.md) · the v3 plan (V3-P03)
**Predecessor contracts:** [V2-SPEC.md](../v2/V2-SPEC.md) · [PLAN-SPEC.md](../v2/PLAN-SPEC.md) · [WORKFLOW-SPEC.md](../v2/WORKFLOW-SPEC.md) · [ARCHITECTURE.md](../v2/ARCHITECTURE.md) · [V2-CLOSE-OUT.md](../release/V2-CLOSE-OUT.md)

---

# 1. Purpose and Validation Verdict

V3-P03 must validate CONTEXT-SPEC (with decisions D1–D5) against the frozen v2
architecture and freeze the v3 contract. This document is that validation. It
determines the data model, storage boundaries, validation engine, dependency
graph, CLI boundaries, and v1/v2 compatibility — and it records the
architecture decisions (A-1…A-8) that pin the mechanical details CONTEXT-SPEC
left to P03/P04.

## The gate answer

The v3 plan gates implementation on P01–P03 establishing that the integrity
model can be implemented **without introducing a second memory/control
system**. The verdict of this validation:

> **Confirmed.** CONTEXT-SPEC implements cleanly on the frozen v2 architecture.
> Every v3 capability maps onto existing layers, existing primitives (`Storage`,
> `RepositoryStore`, `PlanStore`, `GitService`, the report builders, the
> dispatcher), and additive metadata — no new layer, no new file type, no new
> service, no new runtime dependency (`commander` remains the only one).

The v3 integrity engine is a **read-only concern layered over artifacts v2
already writes**, using exactly the two things the audit said were missing:
declared metadata (baselines) and comparison logic. The sections below show,
with code evidence, where each piece lands.

## Freeze statement

With this document, the v3 contract is frozen for implementation:

- [CONTEXT-SPEC.md](./CONTEXT-SPEC.md) is promoted from draft (0.1.0) to
  **v1.0.0 — frozen contract** (header updated at the same commit as this
  document). Its D1–D5 decisions are validated in §5; the A-1…A-8 decisions
  recorded here are part of the frozen contract.
- Implementation follows the CONTEXT-SPEC §20 phasing (P04 → P14), starting
  only after this freeze.

---

# 2. Architecture Principle

The v2 architecture principle carries over unchanged:

> **DoozCTL records and validates engineering intent and evidence; it does not
> perform the engineering work itself.**

v3 adds the integrity corollary:

> **DoozCTL records what repository state each context artifact was produced
> from, and validates — deterministically and read-only — whether that state
> still grounds in the current repository. It never repairs, regenerates, or
> rewrites context automatically.**

Two consequences for the architecture:

1. The integrity engine is **read-only by construction**. It is reached only
   through the read-only surfaces v2 already proves byte-identical (`status`,
   `verify`, `doctor`, and the new `context validate`). It shares the v2 write
   path never: no write step, no `atomicWrite`, no manifest mutation.
2. There is **no integrity daemon, cache, index, or registry**. Every check is
   computed on demand from the artifact files plus read-only git — consistent
   with v2's minimalism rule and its non-goals (no database, no vector store,
   no background process, no second control plane).

---

# 3. Layering and Dependency Graph

v2 extends v1 by adding plan/workflow use cases inside the existing downward
layering. v3 extends v2 the same way: **no new layer is introduced**; the
integrity engine is use cases and read-only logic inside the existing layers.

```text
CLI            — argument parsing, exit codes          (src/cli)        + nested `context validate` command
Dispatcher     — command routing                       (src/dispatcher) + "context validate" key
Application    — use cases per command                 (src/app)        + contextValidate use case
Steps          — pipeline step factories               (src/engine)     + baseline capture in sessionStep
Engine         — ordered step execution                (src/engine)     (unchanged)
Report         — read-only report builders             (src/engine)     + context integrity builder
Integrity      — read-only evaluation (new module)     (src/engine)     + signals S1–S5, trust derivation
Contracts      — analyzer/loader/merger/validator      (src/engine)     (unchanged)
Model          — frozen domain types, pure functions   (src/model)      + baseline/scope parsing (pure)
Workflows      — adoption + evidence vocabulary        (src/workflows)  (unchanged)
Infra          — git service                           (src/infra)      + read-only comparison commands
Store          — sandboxed storage + engine state      (src/store)      (unchanged, additive reads)
```

Dependency direction is downward, exactly as in v2. Rules that keep it that
way:

- **Model stays pure.** New baseline and scope parsing lives in the model layer
  as clock-free, git-free, filesystem-free functions (the `src/model/plan.ts`
  pattern). Baselines and scopes are captured at the app/step layer and passed
  in.
- **The engine holds no infra knowledge.** Integrity evaluation receives git
  facts and file contents as inputs (via injected `GitService` and the existing
  stores), mirroring how `buildStatusReport`/`buildVerifyReport` receive their
  dependencies today.
- **The app layer composes.** `context validate` is an app-level read-only use
  case like `status`/`verify` (`src/app/app.ts: status, verify`), which have
  no pipeline of their own (noted in `src/engine/pipelines.ts`). It never
  reaches the write steps.
- **The engine is only a step runner.** The pipeline machinery
  (`src/engine/engine.ts`) is untouched.

### Where each v3 capability lands

| v3 capability        | Layer / module                                                                  | Reuses                                                                                         |
| -------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Provenance capture   | app + steps (plan creation, analyze, sessionStep) + model (pure render helpers) | `AppDeps.git`, `GitService`, `PlanStore.create`, `RepositoryStore.saveAnalysis`, `sessionStep` |
| Baseline parsing     | model — new pure module (A-4)                                                   | `parsePlan`/`planSection` grammar (`src/model/plan.ts`)                                        |
| Scope validation     | model — new pure module (A-6)                                                   | `isSafeRelativePath` (`src/workflows/evidence.ts`), `isValidPlanId`                            |
| Integrity evaluation | engine — new read-only module (A-5)                                             | git read-only commands, `Storage`, `PlanStore.list`, `RepositoryStore.loadAnalysis`            |
| Report surfaces      | engine — `report.ts` builders (`buildStatusReport`, `buildVerifyReport`, new)   | `CommandReport {report, problems}` (`src/engine/report.ts`)                                    |
| CLI                  | dispatcher + cli builder                                                        | `Dispatcher.register`, commander nesting (A-7)                                                 |

---

# 4. Data Model

The data model changes are **additive metadata on existing artifacts** — the
CONTEXT-SPEC §5.3 placement table, with the exact shapes pinned here.

## 4.1 Git facts gain a commit (`GitFacts`)

`Analysis.git` (`src/model/model.ts`: `GitFacts {isRepository, branch, dirty}`)
gains `commit: string | null` — the short HEAD hash of the repository state the
analysis describes. This is the analysis artifact's baseline.

- **Capture:** the analyzer records it live at analyze time. The analyzer
  already calls `git.detect()` once (`src/engine/repository-analyzer.ts: analyze`);
  `GitService.detect` is extended to also return the commit (A-2), so analysis
  capture stays a single git round-trip.
- **Tolerance:** the JSON field is additive. A v2-era analysis file without
  `commit` parses with `commit: null` → the artifact evaluates as `UNKNOWN`
  (CONTEXT-SPEC §18.3). Never `INVALID`.
- **Write paths unchanged:** `RepositoryStore.saveAnalysis` and `writeStep`
  persist it with the existing byte-identical-skip rule
  (`src/store/repository-store.ts`).

## 4.2 Plan `## Baseline` section (PLAN-SPEC v3 amendment)

Plans gain an optional machine-parsed section immediately after `## Metadata`
and before `## Objective`, following the plan template's existing Markdown +
bullet precedent:

```markdown
## Metadata

- id: attendance-punch-sync
- method: bug-fix
- status: EXECUTING
- created: 2026-08-13

## Baseline

- commit: a1b2c3d
- branch: main
- dirty: no
- scope-path: src/PunchService.php
- source: none
- ownership: mixed

## Objective
```

- **Written by the engine at plan creation only** (A-3). `renderPlan`
  (`src/model/plan.ts`) gains an optional baseline input; `PlanStore.create`
  receives the baseline values from the app layer (which read live git facts).
  `PlanStore` stays pure — its dependency remains `{now}` only
  (`src/store/plan-store.ts`).
- **Outside a git repository**, no baseline is captured and the section is
  omitted (the artifact is `UNKNOWN`). A dirty tree at creation records
  `dirty: yes` as a qualifier, never a staleness signal (§9.3).
- **Never silently refreshed.** Refreshing an existing plan's baseline is a
  reconcile action (CONTEXT-SPEC §14), which v3.0 does not automate.
- **Parse surface stays small.** `parsePlan`'s four frozen fields
  (`src/model/plan.ts`) are untouched; the `## Baseline` section is parsed only
  by the new pure baseline parser (A-4), which shares the `## Section` +
  `- key: value` grammar. Existing plan code (`setPlanStatus`, `transitionPlan`,
  `planSection`) is byte-preserving and unaffected.

## 4.3 Session variables gain `dirty` and `source`

`sessionStep` (`src/engine/steps.ts`) builds the `session` render variables.
The engine contract is that variable set (D3) — the session _file layout_ is
package-template-owned. v3 adds:

- `session.dirty` — read live via `GitService.detect()` in the same call that
  fixes the stored-branch bug (D2, A-2). Today `sessionStep` pairs a live
  commit with a branch read from the **stored** analysis
  (`ctx.analysis?.git.branch`); v3 reads branch + dirty + commit live in one
  `detect()` call.
- `session.source` — `plan:<id>` when the session is written against an active
  plan, else empty (set from the app layer, which knows the active plan).
- The session date/commit/branch variables already exist and are unchanged.

The reference package template renders the new values additively (a
`## Baseline` block for machine provenance — see A-4), exactly as the existing
front-matter lines are rendered from `{{session.*}}`
(`tests/integration/summarize.test.ts`).

## 4.4 Current-context provenance

Per D3, the engine does not hard-code a current-context header. The current
context artifact is template-owned; the engine-side change is that the
provenance variables (A-4 block grammar) exist and the reference template
renders a top-of-file machine block (`- source: session:<ts>` + baseline
lines). Legacy current-context files without the block label carry-forward
sources as unknown (pre-v3) and evaluate `UNKNOWN`.

Carry-forward safety is preserved: `extractPreviousContext`
(`src/engine/session.ts`) collects content only under `# Current Objective` /
`# Open Questions` headings, so a `## Baseline` bullet block elsewhere in the
file is never misread as session content.

## 4.5 What is deliberately unchanged

| Item                                  | Why                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `.dooz/manifest.json` shape (v1)      | bookkeeping; not checkable (CONTEXT-SPEC §4 rule 2)                                      |
| Plan lifecycle + four metadata fields | drift is an observation, never a lifecycle state (§12); Metadata surface stays frozen    |
| Session six-section content contract  | `SESSION_SECTIONS` (`src/engine/session.ts`) is untouched                                |
| Workflow documents / AGENTS.md        | policy assets; never staleness-checked (§4 rule 1)                                       |
| Evidence vocabulary                   | `EVIDENCE_CATEGORIES` (`src/workflows/evidence.ts`) unchanged; only qualifiers are added |
| Write semantics                       | byte-identical-skip, ownership guards, immutable sessions — all inherited as-is          |

---

# 5. Validation of Decisions D1–D5

Each CONTEXT-SPEC decision is validated against the v2 architecture:

| Decision | Validation verdict                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**   | Exit codes follow the proven pattern: `status`/`verify`/`doctor` return `ExitCode.Error` when `problems.length > 0` and `ExitCode.OK` otherwise (`src/app/app.ts`; `ExitCode` in `src/dispatcher/dispatcher.ts`). `context validate` mirrors it with `STALE` + `INVALID` as problems. Confirmed implementable with zero new machinery — the `CommandReport {report, problems}` shape already exists.      |
| **D2**   | Session `dirty` ships in P04 via one `GitService.detect()` call. Confirmed: `detect()` (`src/infra/git/git.ts`) already runs `rev-parse --show-toplevel` → `rev-parse --abbrev-ref HEAD` → `status --porcelain` and returns `{root, branch, dirty}`; extending it to also return the commit (A-2) makes commit+branch+dirty one read-only call, fixing the stored-branch bug at the same time.            |
| **D3**   | Engine does not hard-code session/current-context headers. Confirmed against the code: the engine's session contract is the `session.*` variable set built by `sessionStep`; file layout is rendered by the package template (`tests/integration/summarize.test.ts`). The machine-provenance read contract is a shared `## Baseline` grammar (A-4) that templates render; placement stays template-owned. |
| **D4**   | S6 (workflow drift) is not a staleness signal. Confirmed: workflow methods are governance assets the engine treats as opaque (`src/workflows/adoption.ts`); a method change alters how remaining work proceeds, not the repository facts a plan recorded. Surfacing adoption/validity problems remains `status`'s job (`workflowProblemFor`, `src/engine/report.ts`).                                     |
| **D5**   | Scope is exact paths + directory prefixes (trailing `/`), no globs. Confirmed against the dependency posture: the only runtime dependency is `commander` (`package.json`); every declared scope maps 1:1 to a git pathspec, so S2/S3 are executed by git itself — no matcher, no new dependency. Validation reuses the existing relative-path rule (`isSafeRelativePath`, `src/workflows/evidence.ts`).   |

---

# 6. Architecture Decisions A-1…A-8

The following decisions are added by P03 to the frozen contract. They pin the
mechanical details CONTEXT-SPEC delegated to P03/P04 (§5.3, §21).

## A-1 — Placement: no new layer, no new service

The integrity engine is new read-only logic in the existing engine layer plus
pure model functions, composed by app-level use cases and existing report
builders. There is no integrity pipeline of its own and no daemon/cache/registry.

## A-2 — Live git facts: `detect()` returns the commit; session branch fix

- `GitService.detect()` (infra) additionally returns the short HEAD hash, so
  `RepositoryInfo` = `{root, branch, dirty, commit}` from one read-only round
  trip (`rev-parse --show-toplevel`, then in the root: `rev-parse --abbrev-ref HEAD`,
  `status --porcelain`, `rev-parse --short HEAD`).
- The analyzer maps `commit` into `GitFacts.commit` (A-2 data model).
- `sessionStep` uses one `detect()` call for live commit + branch + dirty,
  replacing the current live-commit/stored-branch pairing (the audit's §3.1
  latent bug) and implementing D2 in the same change.
- `GitService.commitHash` remains for any existing callers/tests.

## A-3 — Baseline capture points and timing

Baselines are captured **at creation, from live git facts, never silently
refreshed**:

| Artifact        | Capture point (P04)                                                         | Timing rule                                                                  |
| --------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Analysis        | analyzer → `GitFacts.commit`, persisted by existing save paths              | on `init` / `analyze` only (sync/summarize re-render stored state by design) |
| Plan            | app reads git facts → `PlanStore.create` → `renderPlan` emits `## Baseline` | at creation only; outside a git repo the section is omitted                  |
| Session         | `sessionStep` variables (`dirty`, `source`) → template renders              | at summarize (immutable file)                                                |
| Current context | provenance variables → reference template top block                         | at summarize (overwrite artifact, owned by the engine's write guard)         |

Refresh of an existing baseline is a **reconcile** action (CONTEXT-SPEC §14),
never automatic. This preserves determinism: the same repository state at
creation produces the same baseline bytes, and byte-identical writes are
skipped by the existing store rules.

## A-4 — Machine-provenance read contract: the `## Baseline` grammar

The engine reads provenance back from checkable artifacts through **one shared,
pure parser**: a `## Baseline` Markdown section containing `- key: value`
bullets with the CONTEXT-SPEC §5.2 field set (`commit`, `branch`, `dirty`,
`scope-path` ×N, `source`, `ownership`). The parser locates the section by
grammar (`^## Baseline` … next `^##`), not by file position, so package-owned
layout freedom (D3) is preserved:

- **Plans:** the section after `## Metadata` (rendered by the engine at
  creation — §4.2).
- **Sessions and current context:** the reference package template renders the
  same grammar; the engine finds it wherever the template placed it.
- **Legacy files without the section parse to "no baseline" → `UNKNOWN`**
  (CONTEXT-SPEC §18.3), never `INVALID`.

The parser lives in a new pure model module (e.g. `src/model/baseline.ts`) and
shares the existing `## Section` grammar helpers in `src/model/plan.ts`. It
returns the artifact's baseline or a deterministic `no-baseline` result.

### Artifact inventory (what `context validate` checks)

Checkable artifacts are discovered at **contract-fixed locations** — the v1/v2
memory and control-plane tree the engine already addresses by fixed paths
(`loadRepositoryStateStep` hard-codes `.dooz/manifest.json` and
`.ai/repository-analysis.json`; `sessionStep` reads `.ai/current-context.md`):

| Location                       | Class         | Baseline source               |
| ------------------------------ | ------------- | ----------------------------- |
| `.ai/repository-analysis.json` | facts         | `git.commit` + branch + dirty |
| `.ai/current-context.md`       | present state | `## Baseline` grammar         |
| `.ai/sessions/*.md`            | history       | `## Baseline` grammar         |
| `.dooz/plans/active/*.md`      | intent        | `## Baseline` grammar         |
| `.dooz/plans/completed/*.md`   | intent        | `## Baseline` grammar         |

Skipped by class (never staleness-checked): `.dooz/workflows/*`, `AGENTS.md` /
`DEVELOPERS.md`, `.dooz/manifest.json`. `.dooz/plans/archive/` is out of scope
in v3.0 (ABANDONED has no defined engine semantics in Phase 2.2 — `PlanStore`
manages `active` and `completed` only). Enumeration uses `PlanStore.list` and
`Storage.list` (sorted, sandboxed, read-only); a missing session dir lists
empty (`Storage.list` semantics).

## A-5 — Integrity evaluation: signals, trust, evidence

Evaluation is a deterministic function of three inputs — the artifact's
baseline, its declared scope, and current git facts — computed in the engine
layer (new read-only module, e.g. `src/engine/integrity.ts`) and rendered by
the report builders. No evaluation ever writes.

### Signal execution order (CONTEXT-SPEC §9.2)

| Order | Signal            | Read-only git operation (git runs the check; no matcher)                                |
| ----- | ----------------- | --------------------------------------------------------------------------------------- |
| 0     | metadata validity | pure: baseline present / malformed / self-contradictory (model layer)                   |
| 1     | S1 commit moved   | baseline `commit` vs live HEAD (`detect().commit`)                                      |
| 2     | reachability      | `git merge-base --is-ancestor <hash> HEAD` (S4 probe; distinguishes STALE from INVALID) |
| 3     | S2 scoped paths   | `git diff --name-only <baseline>..HEAD -- <scope-path>…`                                |
| 4     | S3 scope missing  | `git ls-tree HEAD -- <scope-path>` empty for a declared scope path                      |
| 5     | S5 evidence order | evidence baseline vs plan baseline (verify rows only)                                   |

### Commit-reachability classification (pins CONTEXT-SPEC §10)

For an artifact baseline hash `h` and live HEAD `H`:

| Condition                                                | Outcome          | Meaning                                                   |
| -------------------------------------------------------- | ---------------- | --------------------------------------------------------- |
| no baseline present                                      | `UNKNOWN`        | pre-v3 artifact — no claim made                           |
| baseline malformed / self-contradictory                  | `INVALID`        | metadata present but impossible                           |
| `h` not reachable from `H` (not ancestor, not `H`)       | `INVALID`        | history rewritten or hash absent — grounding unverifiable |
| `h` reachable from `H`, `h ≠ H`, no scope                | `STALE`          | repository moved (conservative, §6.3)                     |
| `h` reachable, `h ≠ H`, scope declared, no scoped change | `CURRENT` + note | grounded; "repository moved outside described scope"      |
| `h` reachable, `h ≠ H`, scope declared, scoped change    | `STALE`          | described area moved (S2/S3)                              |
| `h == H`                                                 | `CURRENT`        | grounded at the current tip                               |

### Trust-state derivation (CONTEXT-SPEC §10.2)

`CURRENT → TRUSTED`; `STALE → STALE`; no baseline → `UNKNOWN`; malformed or
unreachable → `INVALID`; policy/bookkeeping classes → not scored. `TRUSTED`
means "grounded per deterministic checks", never "correct".

### Evidence grounding (V3-11/P10)

`evaluateRequirement` (`src/engine/report.ts`) gains a qualifier per row,
without changing any check:

- `LIVE` rows (`git-state`, `release`, `changelog:<path>`, `version:<path>`)
  are evaluated against the current tree/git as today — no change.
- `RECORDED` rows (`acceptance-criteria`, `tests`, `verification`) keep their
  presence checks and carry the plan's trust state: a `STALE` plan demotes its
  recorded rows to `STALE-BASELINE` (CONTEXT-SPEC §11.2 rule 2).
- `BASELINE` rows (`commit`) evaluate hashes in the plan's `## Commit` section
  with the same reachability probe (S4): unreachable → `STALE-BASELINE`;
  reachable but older than HEAD → recorded-with-qualifier; == HEAD → current.

### Plan drift (V3-10/P09)

Drift is a **read-only observation** produced by the same evaluation and
rendered in `status`/`verify`/`context validate` reports: "plan baseline `X` →
HEAD `H`; `<paths>` changed since baseline". It never writes to the plan file
and never touches the frozen lifecycle.

## A-6 — Scope semantics (P05)

- **Declarations** are authored (plans are user-facing repository state; the
  engine renders the initial `## Baseline` and agents/engineers may add
  `scope-path` lines, which the engine validates — mirroring how workflow
  documents declare evidence paths). Validation: reuse `isSafeRelativePath`
  (`src/workflows/evidence.ts`) plus D5 rules — no glob characters, no `..`, no
  absolute/backslash forms; a trailing `/` means directory subtree, otherwise
  exact path.
- **Inheritance** (`source: plan:<id>`): sessions/current-context inherit the
  referenced plan's scope; a plan with no scope yields an unscoped artifact
  (conservative evaluation). Scope cycles (A scopes to B scopes to A) are
  invalid — detected by a pure reachability walk over `source` links before
  evaluation.
- **No scope → repository granularity** (CONTEXT-SPEC §6.1): commit moved ⇒
  `STALE`. This is conservative by contract; P13 dogfood measures false
  positives and may motivate wider scope declaration, not a change to the rule.

## A-7 — CLI surface and exit codes

- **`doozctl context validate`** is a new read-only app use case
  (`App.contextValidate([repo])`), registered on the dispatcher under the key
  `"context validate"` and rendered by the CLI as a nested command. The CLI
  builder (`src/cli/cli.ts: buildProgram`), which today registers flat command
  names, gains a small grouping step: a registered name containing a space
  becomes a parent command (e.g. `context`) with leaf commands (`validate`).
  The dispatcher itself is unchanged.
- Output uses the existing `CommandReport` shape; problems are `STALE` +
  `INVALID` artifacts (D1) and gate the exit code (`ExitCode.Error`), while
  `CURRENT`/`UNKNOWN` rows are informational. Uninitialized repositories print
  the existing guidance and exit `ExitCode.Error`, matching `status`/`verify`.
- **`status`** gains a `Context` block (counts per trust state) produced by the
  same evaluation inside `buildStatusReport` — which stays read-only and
  deterministic. Optionally (P08) a `Commit:` line in the Repository section so
  an agent can see the current tip — report-only, additive.
- **`verify`** gains the evidence grounding qualifiers (A-5) as one column in
  the existing table — an extension, not a new command.
- Deferred commands (`context status`, `context inspect`, `evidence validate`,
  `plan validate`) stay deferred per CONTEXT-SPEC §16.

## A-8 — Determinism and compatibility invariants

1. **Stored state stays git-fact-only.** Baselines store commit/branch/dirty +
   declarations; no wall-clock fields enter stored state (CONTEXT-SPEC §17.1).
   Capture uses existing injected-clock boundaries (`AppDeps.now`) only where
   v2 already does; git facts come from read-only git.
2. **Writes stay byte-identical-or-skipped** via the existing store rules;
   idempotency proofs are inherited.
3. **Reports stay deterministic.** Same repository state → byte-identical
   output, including the new `context validate` report and the `status` Context
   block (the read-only byte-identity proofs in the suite extend to them).
4. **Template-owned layouts are honored** (D3): the engine defines the
   `## Baseline` grammar and variable set; packages own placement for
   session/current-context files.
5. **v2-created artifacts evaluate `UNKNOWN`**, never `INVALID`, and no v2
   command changes behavior for them until a v3 command evaluates them
   (CONTEXT-SPEC §18).
6. **The test gate never weakens.** Each v3 work package updates the affected
   unit/integration/deterministic-output/idempotency/safety tests and adds new
   ones (CONTEXT-SPEC §18.1); the existing suite's byte-identity and
   malformed-input expectations extend to the new surfaces.
7. **Single-operator assumption stays** (L-8): v3 adds no locking or merge
   machinery; git remains the coordination substrate (CONTEXT-SPEC §15.5).
8. **No new dependencies.** All new git operations are read-only subprocess
   calls through the existing `GitService`; `commander` remains the only
   runtime dependency.

---

# 7. Compatibility with v1 and v2

| Concern                         | v3 position                                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1 `.ai/` memory tree           | untouched in shape; `git.commit` on the analysis JSON is an additive key; session/current-context changes are variable + template additions (D3), parse-safe     |
| v1 behavior                     | frozen; any change requiring v1 semantics change is a `V1 CONFLICT` report, per V2-SPEC                                                                          |
| v2 command behavior             | unchanged for v2-created artifacts until a v3 command evaluates them; `status` gains a Context block, `verify` gains qualifier columns (additive report surface) |
| v2 plan/evidence/workflow files | plan `## Baseline` is an optional section rendered only for newly created plans (PLAN-SPEC v3 amendment); old plans parse identically and evaluate `UNKNOWN`     |
| Backward-compatible evaluation  | pre-v3 artifacts → `UNKNOWN`, never `INVALID` (CONTEXT-SPEC §18.3)                                                                                               |
| Read-only guarantees            | proven byte-identity of read-only commands extends to the new surfaces; evaluation never writes, never runs non-read-only git                                    |
| Test gate                       | all existing tests stay green; per-package updates/additions never weaken the gate                                                                               |

---

# 8. Implementation Map (P04 → P14)

Each row names the modules a work package touches, so implementation starts
from this freeze without re-deriving placement.

| Package | Deliverable          | Modules / surfaces touched (per this architecture)                                                                                                                                                                                                                                                                                                                                              |
| ------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P04     | Provenance           | `src/infra/git/git.ts` (detect → commit), `src/model/model.ts` (`GitFacts.commit`), `src/engine/repository-analyzer.ts`, `src/model/plan.ts` + `src/store/plan-store.ts` + `src/app/app.ts` (plan baseline), `src/engine/steps.ts` (sessionStep: one detect() + `dirty`/`source` variables), new pure `src/model/baseline.ts` (grammar + render), PLAN-SPEC amendment, reference template lines |
| P05     | Scope                | `src/model/baseline.ts` (scope validation, D5), plan-scope inheritance + cycle walk, tests (Scenario B readiness)                                                                                                                                                                                                                                                                               |
| P06     | Integrity engine     | new `src/engine/integrity.ts` (S1–S5, reachability, trust derivation), `GitService` comparison methods (`merge-base --is-ancestor`, `diff --name-only`, `ls-tree`)                                                                                                                                                                                                                              |
| P07     | `context validate`   | `src/app/app.ts` (use case), `src/dispatcher` + `src/cli/cli.ts` (nested command grouping, A-7), `src/engine/report.ts` (builder), exit-code policy (D1)                                                                                                                                                                                                                                        |
| P08     | Status integration   | `buildStatusReport` Context block (+ optional Commit line)                                                                                                                                                                                                                                                                                                                                      |
| P09     | Plan drift           | status/verify drift observation from integrity evaluation                                                                                                                                                                                                                                                                                                                                       |
| P10     | Evidence freshness   | `evaluateRequirement` qualifiers (LIVE/RECORDED/BASELINE), S4 on `## Commit` rows                                                                                                                                                                                                                                                                                                               |
| P11     | Handover v3          | reference templates render `## Baseline` (sessions/current-context), carry-forward labeling                                                                                                                                                                                                                                                                                                     |
| P12     | Multi-agent gauntlet | integration tests per [GAUNTLET-SPEC.md](./GAUNTLET-SPEC.md) for CONTEXT-SPEC §19 Scenarios A/B/C                                                                                                                                                                                                                                                                                               |
| P13     | Dogfood              | measure false positives + handover fidelity (no contract change without a versioned amendment)                                                                                                                                                                                                                                                                                                  |
| P14     | Release gate         | tests, typecheck, lint, build, security, deterministic-output, docs alignment, backward compat, changelog                                                                                                                                                                                                                                                                                       |

---

# 9. Open Questions Carried to Implementation

These are deliberately not frozen here (they are P04/P06 implementation
details, not contract):

1. Whether the baseline parser lives in `src/model/baseline.ts` or
   `src/model/provenance.ts` — placement only, contract unchanged.
2. Short-hash vs full-hash comparison edge cases in reachability probing —
   the stored form stays the existing `rev-parse --short HEAD` convention;
   P06 confirms short-hash `merge-base --is-ancestor` behavior on ambiguous
   input and fails safe to `INVALID` when git errors.
3. Exact wording of the `context validate` report rows and the `status`
   Context block — determined at P07/P08 against snapshot-test expectations,
   following the CONTEXT-SPEC §16 examples.

---

# Appendix — Evidence Index

| Claim                                           | Evidence                                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Layer structure, no new layer                   | `docs/v2/ARCHITECTURE.md` (Layering); `src/` module layout                                                                               |
| Read-only app-level use cases, no pipeline      | `src/app/app.ts` (`status`, `verify`); `src/engine/pipelines.ts` closing comment                                                         |
| `CommandReport {report, problems}`              | `src/engine/report.ts`                                                                                                                   |
| Exit-code pattern                               | `src/app/app.ts` (`doctor`, `status`, `verify` return by `problems.length`); `src/dispatcher/dispatcher.ts` (`ExitCode`)                 |
| `GitService` today (read-only commands)         | `src/infra/git/git.ts` (`detect`, `commitHash`, `headTagged`)                                                                            |
| `GitFacts` has no commit                        | `src/model/model.ts` (`GitFacts`); `src/engine/repository-analyzer.ts: analyze`                                                          |
| Session stored-branch pairing                   | `src/engine/steps.ts: sessionStep` (live `commitHash` + stored `ctx.analysis.git.branch`)                                                |
| Plan metadata surface + template + pure model   | `src/model/plan.ts` (`parsePlan` four fields, `renderPlan`, `setPlanStatus`, `transitionPlan`)                                           |
| Plan store dependency is clock-only             | `src/store/plan-store.ts` (`PlanStoreDeps {now}`)                                                                                        |
| Analysis/plan/session write rules               | `src/store/repository-store.ts` (byte-identical skip), `src/engine/steps.ts` (`writeStep`, ownership guard, immutable session error)     |
| Fixed memory paths hard-coded by the engine     | `src/engine/steps.ts` (`loadRepositoryStateStep`, `sessionStep` reads `.ai/current-context.md`); summarize prints `.ai/sessions/<id>.md` |
| Session layout is template-owned                | `tests/integration/summarize.test.ts` (package declares session/context artifacts; template renders `{{session.*}}` bullets)             |
| Carry-forward parse safety                      | `src/engine/session.ts` (`extractPreviousContext` collects `# Current Objective`/`# Open Questions` only)                                |
| Evidence presence checks, vocabulary, path rule | `src/engine/report.ts` (`evaluateRequirement`), `src/workflows/evidence.ts` (`EVIDENCE_CATEGORIES`, `isSafeRelativePath`), WORKFLOW-SPEC |
| Override hierarchy, extension-not-inheritance   | `docs/v2/WORKFLOW-SPEC.md` (Override Hierarchy)                                                                                          |
| Determinism / idempotency proofs                | `src/store/repository-store.ts`, `writeStep` skip rule, V2-CLOSE-OUT (read-only byte-identity)                                           |
| Single-operator / concurrency assumption (L-8)  | `docs/v2/V2-MANUAL-TESTING.md` §7                                                                                                        |
| Only runtime dependency                         | `package.json` (`commander`)                                                                                                             |
| Audited baseline state                          | `b0b41fc` on `main` (v2.0.0 + D-01)                                                                                                      |
