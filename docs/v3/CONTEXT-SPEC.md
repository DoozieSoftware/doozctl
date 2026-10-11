# DoozCTL v3 — Context Integrity Specification (V3-P02)

**Version:** 1.0.0 (v3 Context Integrity contract)
**Status:** Frozen — validated against the frozen v2 architecture by V3-P03 ([ARCHITECTURE.md](./ARCHITECTURE.md), decisions A-1…A-8); implementation starts at V3-P04
**Input:** [REALITY-AUDIT.md](./REALITY-AUDIT.md) (audited state `b0b41fc`, v2.0.0)
**Predecessor contracts:** [V2-SPEC.md](../v2/V2-SPEC.md) · [PLAN-SPEC.md](../v2/PLAN-SPEC.md) · [WORKFLOW-SPEC.md](../v2/WORKFLOW-SPEC.md) · [ARCHITECTURE.md](../v2/ARCHITECTURE.md)

---

# 1. Purpose

The v3 problem, restated from the plan:

> Context exists, is versioned, and is available — but has become stale relative
> to the repository.

The goal of v3 is **context integrity, not more context**: an agent must be able
to determine whether repository context is still trustworthy before relying on
it. This specification defines the model that makes that determination possible
— the context artifact, its provenance, its scope, the authority boundaries, the
freshness/staleness signals, the trust states, ownership, and the
reconciliation rules — as a contract that V3-P03 must validate against the
frozen v2 architecture before any implementation begins.

The audit (V3-P01) established the central constraint this spec is written
against:

> v2 already contains every primitive the integrity engine needs. The v3 gap is
> missing metadata and missing comparison logic, not missing infrastructure.

This spec therefore introduces **no new storage, no new services, no new file
types in the first cut**. It extends existing artifacts with small declared
metadata and defines read-only comparison logic over existing artifacts and git
facts.

---

# 2. Scope and Non-Goals

## In scope

- The integrity model: what an artifact must declare and what the engine may
  deterministically conclude from it.
- The authority model and its promotion rules (V3-04).
- The freshness/staleness signals and the trust-state vocabulary (V3-02, V3-12).
- Evidence freshness (V3-11) and plan drift (V3-10) as applications of the same
  model.
- Handoff integrity (V3-07), multi-agent safety rules (V3-08), and the
  reconciliation model (V3-09) as contracts, not implementations.
- Compatibility rules that keep v2 behavior and the 484-test gate intact.

## Non-goals (reaffirmed from the v3 plan)

v3 does **not** build: an AI coding agent, an agent/model abstraction layer, a
vector database, repository-wide semantic memory, automatic commit/merge
machinery, a plugin marketplace, a cloud control plane, a background daemon, an
autonomous workflow engine, mandatory workflow adoption, a Git replacement, or
another collection of AI-generated context files.

The engine **reports and validates integrity; it never repairs, regenerates,
or rewrites context automatically** (see [§14 Reconciliation](#14-reconciliation-not-blind-regeneration)).

---

# 3. Definitions

| Term                 | Definition                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Context artifact** | A durable, managed document in the control plane (`.ai/` or `.dooz/`) that describes repository state, records intent, or records history — as opposed to policy assets, which govern (see [§4](#4-integrity-checkable-artifacts)) |
| **Provenance**       | The declared metadata that ties an artifact to the repository state and source it was produced from ([§5](#5-provenance-v3-01))                                                                                                    |
| **Baseline**         | The repository state an artifact was produced against, expressed as deterministic git facts: commit, branch, dirty flag. The comparison anchor for staleness                                                                       |
| **Scope**            | The machine-checkable declaration of what an artifact describes: repository paths, or a plan reference ([§6](#6-scope-v3-03))                                                                                                      |
| **Ownership**        | Whether an artifact is generated, human-owned, or mixed — determines what reconciliation may do ([§14](#14-reconciliation-not-blind-regeneration))                                                                                 |
| **Authority**        | Which source wins when content conflicts, within each of the three axes defined in [§7](#7-authority-model-v3-04)                                                                                                                  |
| **Freshness**        | The evaluation outcome of comparing an artifact's baseline to current repository facts                                                                                                                                             |
| **Staleness**        | A freshness outcome: the artifact is grounded in a repository state that is demonstrably superseded in the area it describes                                                                                                       |
| **Trust state**      | The reported per-artifact category derived from freshness plus metadata validity ([§10](#10-trust-states-v3-12))                                                                                                                   |
| **Reconciliation**   | The rule-governed handling of a stale artifact: VALIDATE → STALE → RECONCILE, never DELETE → REGENERATE for anything human-owned ([§14](#14-reconciliation-not-blind-regeneration))                                                |

## The core invariant

> **The engine must never silently promote one category into another.**

Concretely: derived content must not be presented as repository facts, recorded
evidence must not be presented as verified-against-HEAD, history must not be
presented as present state, and generated output must not override
authoritative sources. Every category boundary crossed at read time must be
visible ([§8](#8-category-promotion-rules)).

---

# 4. Integrity-Checkable Artifacts

The audit's inventory ([REALITY-AUDIT §2](./REALITY-AUDIT.md)) maps the v2
context-separation categories onto the v3 vocabulary:

| v2 category   | Artifact                       | v3 class      | Ownership       | Describes repo state? | Integrity-checkable |
| ------------- | ------------------------------ | ------------- | --------------- | --------------------- | ------------------- |
| Rules         | `AGENTS.md`, `DEVELOPERS.md`   | policy        | human / package | no                    | no                  |
| Facts         | `.ai/repository-analysis.json` | facts         | generated       | **yes**               | yes                 |
| Present state | `.ai/current-context.md`       | present state | mixed           | **yes**               | yes                 |
| History       | `.ai/sessions/*.md`            | history       | mixed           | **yes**               | yes                 |
| Intent        | `.dooz/plans/*`                | intent        | mixed           | **yes** (assumptions) | yes                 |
| Methods       | `.dooz/workflows/*`            | methods       | human / package | no                    | no                  |
| Engine state  | `.dooz/manifest.json`          | bookkeeping   | generated       | no                    | no                  |

Rules:

1. **Policy assets** (AGENTS.md, workflows, overlays) are never staleness-checked.
   They do not describe repository state; they govern. Their versioning is a
   standards-package concern, out of scope for the integrity engine.
2. **Bookkeeping** (manifest) is not checked; it records engine writes, not
   repository descriptions.
3. Every **checkable artifact** must carry provenance before the engine can
   evaluate it. Artifacts without provenance are `UNKNOWN`, never `INVALID`
   (backward compatibility, [§18](#18-compatibility-and-versioning)).
4. Checkability is **read-only**. Evaluation never modifies an artifact.

---

# 5. Provenance (V3-01)

## 5.1 Design rules (from the audit, §4)

1. **Baselines, not timestamps.** Wall-clock fields in stored state would break
   v2's tested byte-identical determinism. Provenance stores _deterministic git
   facts_ (commit, branch, dirty) captured at creation; human-facing reports may
   derive age from git commit dates, never from stored clocks.
2. **Capture at the command layer, keep models pure.** Provenance is captured
   where v2 already injects clock/git (`AppDeps.now`, `sessionStep`); model
   parsing stays pure, clock-free and git-free (`src/model/plan.ts` pattern).
3. **Read-only git capture.** All baseline facts come from commands the engine
   already runs (`rev-parse`, `status --porcelain`) plus, later, `log` /
   `diff --name-only` for comparisons.

## 5.2 The provenance block

Provenance is declared as a small, machine-parsed Markdown block, following the
v2 precedent of plan `Metadata` (`- key: value` bullets) — Markdown, not YAML,
per the v2 minimalism rule and PLAN-SPEC's "Markdown is canonical".

```text
## Baseline

- commit: <full or short hash>
- branch: <branch-name>
- dirty: yes|no
- scope-path: <repo-relative path or directory prefix>
- source: <plan:<id> | session:<timestamp> | none>
- ownership: <generated|human|mixed>
```

Field contract:

| Field        | Required? | Rules                                                                                                                                                              |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `commit`     | yes       | hash of the repository state the artifact describes; captured live at creation                                                                                     |
| `branch`     | yes       | branch name at capture; must be read live, from the same source as `commit` (fixes the audit's §3.1 latent bug — stored-analysis branch)                           |
| `dirty`      | yes       | `yes` if the working tree had uncommitted changes at capture; a qualifier, never a staleness signal by itself                                                      |
| `scope-path` | no        | zero or more repo-relative exact paths or directory prefixes (trailing `/`); no glob syntax in v3.0 (D5, [§6](#6-scope-v3-03)); validated with existing path rules |
| `source`     | no        | the plan/session an artifact is derived from, when it is derived (current-context → source session; session → source plan)                                         |
| `ownership`  | no        | declared for mixed artifacts; generated/human are engine-known from the artifact class ([§14](#14-reconciliation-not-blind-regeneration))                          |

## 5.3 Per-artifact placement (first cut)

| Artifact                       | Provenance today (v2)                            | v3 addition                                                                                                                                       |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dooz/plans/*`                | none (id/method/status/created only)             | new optional `## Baseline` section after `## Metadata` (PLAN-SPEC amendment, [§18](#18-compatibility-and-versioning))                             |
| `.ai/sessions/*.md`            | front-matter: tool/model/user/date/commit/branch | fix branch to be read live; add `dirty`; add optional `source: plan:<id>`                                                                         |
| `.ai/current-context.md`       | none (authored sections, carry-forward)          | engine exposes provenance variables; reference template renders a top-of-file block with `source: session:<ts>` and baseline (template-owned, D3) |
| `.ai/repository-analysis.json` | `git: {isRepository, branch, dirty}`             | add `"commit"` to the `git` object; the file states which commit it describes                                                                     |
| `.dooz/manifest.json`          | none                                             | none (bookkeeping; not checkable)                                                                                                                 |

The exact file mechanics (section placement, JSON shape) are decided in
V3-P03 ([ARCHITECTURE.md §4](./ARCHITECTURE.md)) and implemented in P04; the
field contract above is what P04 must implement.

---

# 6. Scope (V3-03)

## 6.1 Why scope is mandatory for precision

The audit's second acceptance test is the guard against a noisy "everything
changed" detector:

> Agent B changes an _unrelated_ part of the repository. Agent C consumes the
> context. DoozCTL should **not** flag the context stale.

Without a scope declaration, any commit change between baseline and HEAD forces
`STALE` — the noise case. **Scope is therefore required before path-precision
staleness is computed.** An artifact without scope can still be evaluated, but
only at repository granularity (conservative).

## 6.2 Scope forms

1. **Path scope** — zero or more repo-relative exact paths or directory
   prefixes (a trailing `/` means the whole subtree): `src/engine/report.ts`,
   `tests/engine/`. **No glob syntax (`*`, `**`) in the first cut (D5).** Each
   declaration maps 1:1 to a git pathspec, so the diff and existence checks
   (S2/S3) are performed by git itself — no matcher, no dependency. Validation
   reuses the WORKFLOW-SPEC path-bound evidence rule: relative, forward
   slashes, no `..` segments, and existing Storage confinement before any
   filesystem or git use.
2. **Plan scope** — a `source: plan:<id>` reference. The artifact inherits the
   referenced plan's path scope; if the plan has none, the artifact is
   unscoped. Cycles (A scopes to B scopes to A) are invalid.

## 6.3 Evaluation semantics

| Baseline vs HEAD | Scope declared? | Scoped paths changed?      | Outcome                                                                    |
| ---------------- | --------------- | -------------------------- | -------------------------------------------------------------------------- |
| same commit      | either          | n/a                        | `CURRENT`                                                                  |
| commit moved     | no              | n/a                        | `STALE` (conservative)                                                     |
| commit moved     | yes             | no                         | `CURRENT` (with a report line: "repository moved outside described scope") |
| commit moved     | yes             | yes                        | `STALE`                                                                    |
| commit moved     | yes             | scope path missing at HEAD | `STALE`                                                                    |

The "CURRENT with a commit-delta note" row is deliberate: it answers the two
questions separately — _is what this artifact describes still grounded?_ (yes)
and _did the repository move?_ (yes, outside the described area). Both facts
are reported; they never collapse into one.

---

# 7. Authority Model (V3-04)

## 7.1 The plan's proposal vs. the audit

The v3 plan proposed a single linear chain:

```text
POLICY → HUMAN DECISION → REPOSITORY → PLAN → GENERATED STATE → SESSION SUMMARY
```

The audit's constraint #6 requires validating this against WORKFLOW-SPEC's
override hierarchy (mandatory policy → technology overlay → workflow method →
project extension, which is **extension, not inheritance**). Validation result
adopted by this spec:

**A single linear chain conflates three independent axes.** "REPOSITORY above
PLAN" is true on the facts axis (a plan's factual assumptions yield to the
repository) but false on the intent axis (the repository does not decide what
to do next). The spec replaces the chain with three axes; P03 must validate
that this composition implements cleanly on the v2 architecture and does not
reintroduce inheritance semantics.

## 7.2 The three axes

### Axis 1 — Governance: what must be followed

```text
DoozieSoft mandatory policy
        ↓
Technology overlay
        ↓
Workflow method
        ↓
Project workflow extension
```

Adopted verbatim from WORKFLOW-SPEC: extension, not inheritance; lower levels
may add but never weaken. Not staleness-checkable.

### Axis 2 — Facts: what is true about the repository

```text
Repository (git + files)      — sole ground truth
        ↓
Generated state               — derived from the repository
        ↓
Session records               — facts-at-a-time, i.e. history
```

- The repository is the only authority for facts. Generated state
  (`.ai/repository-analysis.json`, current-context carry-forward) is derived
  and must carry a freshness qualifier whenever presented.
- Sessions record what was believed at a commit; they are history, never
  current facts.

### Axis 3 — Intent: what is intended

```text
Human decision
        ↓
Plan
        ↓
Generated state / agent output
```

- A plan is never "wrong" because the repository moved. Its _assumptions about
  the repository_ (its baseline/scope) can be shown stale — that is drift
  reporting (V3-10), not authority resolution.
- Generated output may inform a decision but never overrides a human decision
  or an adopted plan.

## 7.3 Cross-axis conflicts

Conflicts are only resolvable **within** an axis. Cross-axis conflicts (e.g.,
"the plan's assumption contradicts the current repository") are **reported as
drift, never resolved by the engine**. The engine has no resolution authority
on any axis — it records and validates ([§8](#8-category-promotion-rules)).

---

# 8. Category Promotion Rules

The "never silently promote" contract, made checkable:

| #   | Promotion the engine must never make silently                | Where v2 does it today (audit §3.4)                                       | v3 rule                                                                                                                        |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Stored (derived) analysis presented as live repository facts | `summarize` consumes stored `analysis.git.branch` with no freshness check | Any consumer of stored analysis must qualify output as derived-from-stored unless live git facts are re-read                   |
| 2   | Recorded evidence presented as verified-against-HEAD         | `verify` presence checks report ✓ without a grounding qualifier           | Every evidence row carries a grounding qualifier: `LIVE` / `RECORDED` / `STALE-BASELINE` ([§11](#11-evidence-freshness-v3-11)) |
| 3   | History presented as present state                           | `current-context.md` carries forward session fields with no source marker | Carry-forward fields are labeled with their source session (`source: session:<ts>`)                                            |
| 4   | Generated content overriding an authoritative source         | (no runtime counterpart today)                                            | Read paths refuse to present derived content as facts (Axis 2); drift is reported, never resolved (Axis 3)                     |
| 5   | Trust presented as correctness                               | `verify` READY over-claims (audit §3.12)                                  | `TRUSTED` means "grounded per deterministic checks", never "semantically correct" ([§10](#10-trust-states-v3-12))              |

---

# 9. Freshness and Staleness (V3-02)

## 9.1 The four states

| State       | Meaning                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `CURRENT`   | baseline exists and matches current repository state in the described area (or repo-wide for unscoped artifacts) |
| `STALE`     | baseline exists; comparison shows the described state has demonstrably moved                                     |
| `UNKNOWN`   | artifact exists but has no baseline (pre-v3 artifacts) — cannot be determined                                    |
| `UNTRACKED` | artifact class is not subject to integrity checks (policy, bookkeeping)                                          |

## 9.2 Deterministic signals

Signals are evaluated in order; the first to fire decides the outcome. All are
read-only git operations consistent with the engine's existing posture
(`rev-parse`, `status --porcelain`, `tag --points-at` today; `log`,
`diff --name-only`, `rev-list` added for comparisons).

| #   | Signal                                                    | Detection (read-only)                                                   | Outcome when fired                  |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------- |
| S1  | Baseline commit ≠ HEAD                                    | compare baseline `commit` to live `rev-parse HEAD`                      | drives §6.3 evaluation              |
| S2  | Scoped paths changed between baseline and HEAD            | `git diff --name-only <baseline>..HEAD -- <scope-paths>`                | `STALE` (scoped)                    |
| S3  | Referenced/scope path disappeared at HEAD                 | `git ls-tree HEAD -- <path>` empty for a declared scope path            | `STALE`                             |
| S4  | Plan `## Commit` hash not current (evidence baseline)     | recorded hash ∉ ancestors of HEAD and ≠ HEAD (`rev-list --is-ancestor`) | evidence row `STALE-BASELINE`       |
| S5  | Evidence recorded under an older baseline than the plan's | compare evidence baseline to plan baseline                              | evidence row `STALE-BASELINE`       |
| S6  | workflow method referenced by plan changed                | — not a staleness signal (D4)                                           | excluded — governance axis (§21 D4) |

## 9.3 Explicit non-signals

- **Wall-clock age.** Git commit age alone does not prove semantic staleness
  (v3 plan, §4). Age may appear in human-facing reports, derived from git
  commit dates — never stored, never an outcome driver.
- **Branch name changes alone.** A renamed branch with unchanged content is not
  staleness; the commit comparison is the signal.
- **Dirty-at-baseline.** `dirty: yes` at capture is a qualifier shown in
  reports; it is not itself a staleness signal.
- **Workflow/policy changes (D4).** Methods are governance (Axis 1), not facts
  (Axis 2); a workflow change alters how remaining work should proceed, it does
  not stale the repository facts a plan recorded. Surfaced by `status`, never
  by the staleness engine.

---

# 10. Trust States (V3-12)

## 10.1 The vocabulary

| State     | Definition                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUSTED` | sufficiently grounded in the current repository state according to deterministic checks                                                         |
| `STALE`   | grounded in a superseded repository state in the area it describes                                                                              |
| `UNKNOWN` | insufficient metadata (no baseline)                                                                                                             |
| `INVALID` | metadata present but malformed, self-contradictory, or referencing an impossible state (e.g. baseline commit unreachable in repository history) |

> **Trusted ≠ correct.** `TRUSTED` certifies grounding, not truth. Semantic
> correctness remains a human/agent responsibility. A `TRUSTED` artifact may be
> wrong; a `STALE` artifact may still be factually accurate — the engine reports
> grounding, never truth.

## 10.2 Derivation

| Freshness outcome / metadata condition                           | Trust state  |
| ---------------------------------------------------------------- | ------------ |
| `CURRENT` (freshness)                                            | `TRUSTED`    |
| `STALE` (freshness)                                              | `STALE`      |
| no baseline                                                      | `UNKNOWN`    |
| malformed/contradictory metadata, or baseline commit unreachable | `INVALID`    |
| `UNTRACKED` class                                                | (not scored) |

`INVALID` requires care: a baseline commit that no longer exists in history
usually means history was rewritten — the artifact's grounding is
unverifiable, which is stronger than `UNKNOWN` (metadata exists but is
impossible) and weaker than `STALE` (no comparison possible). It is reported,
never repaired.

---

# 11. Evidence Freshness (V3-11)

## 11.1 Grounding classes

Every `verify` evidence row (WORKFLOW-SPEC canonical vocabulary) is classified
by how it grounds:

| Class      | Meaning                                                                           | Categories today                                             |
| ---------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `LIVE`     | checked against the current repository tree / git facts                           | `git-state`, `release`, `changelog:<path>`, `version:<path>` |
| `RECORDED` | presence of recorded prose; grounded in the tree only by absence of contradiction | `acceptance-criteria`, `tests`, `verification`               |
| `BASELINE` | a recorded reference to a repository state                                        | `commit` (plan `## Commit` hash)                             |

## 11.2 Reporting rules

1. Every evidence row is reported with its grounding qualifier. `LIVE` rows may
   show ✓ as before; `RECORDED` rows show ✓ **with** a "recorded, not
   verified-against-HEAD" qualifier; `BASELINE` rows show the freshness of the
   hash itself (S4).
2. **Recorded evidence inherits its plan's trust state.** A plan whose baseline
   is `STALE` demotes its recorded evidence rows to `STALE-BASELINE`: the record
   may still be true, but it cannot be presented as grounding for the current
   repository state.
3. The vocabulary extension rule from WORKFLOW-SPEC stays: extending a category
   is one table row plus one deterministic check — never a language.

The audit's sharpest case is `commit`: a hash recorded at an earlier HEAD still
reports ✓ after the branch moved on. S4 is the natural first integrity check to
implement (deterministic, zero semantics).

---

# 12. Plan ↔ Repository Drift (V3-10)

A plan gains a drift observation, derived from its baseline (§5) and scope (§6):

```text
Plan: attendance-punch-sync

Status: EXECUTING        (unchanged — execution lifecycle is untouched)
Context: STALE
Baseline: a1b2c3d → HEAD 9f8e7d6 (branch: main, clean)

Reason:
- src/PunchService.php changed since plan creation
- tests/PunchServiceTest.php changed
```

Rules:

1. Drift is an **observation about** the plan, produced read-only by
   `context validate` / `status` / `verify`. It does not modify the plan file
   and does not touch the frozen lifecycle contract (`PLANNED → … → COMPLETED`
   stays execution-only).
2. A `STALE` plan yields the immediate instruction to an agent: **re-understand
   before continuing** — surfaced in reports, never enforced.
3. The plan's `## Commit` section, when it contains a hash, is treated as the
   plan's evidence baseline (S4) — the plan declares what it believes satisfied
   it, and the engine reports whether that belief still grounds in HEAD.

---

# 13. Handoff Integrity (V3-07)

The v2 session contract is the handoff base. v3 strengthens it without breaking
the frozen six-section format:

1. **Sessions link to the active plan** (`source: plan:<id>` in front-matter).
   A session whose plan is `STALE` reports so at handover time.
2. **Sessions expose evidence state.** The handover communicates: repository
   state (commit/branch/dirty), work performed (Summary), decisions, evidence,
   known stale context (from §9 signals), unresolved assumptions, and the next
   safe action.
3. **The one-next-work-package rule becomes a contract statement**, not a
   template convention: a session's `Next Steps` names exactly one next safe
   action; `current-context.md` mirrors it.
4. **Handover honesty is checked, not enforced.** `doctor`'s existing
   "commit before summarizing" advisory stays advisory; v3 adds the stale-
   context qualifiers to the session record so the _reader_ can see what the
   session does and does not cover.

Session front-matter gains `dirty` and `source: plan:<id>`; the latent
stored-branch bug (audit §3.1, §4.6) is fixed in P04 by reading branch and
`dirty` live in one `GitService.detect()` call (D2).

---

# 14. Reconciliation, Not Blind Regeneration (V3-09)

The v2 write model already agrees with the v3 constraint on the file level
(audit §3.9): never overwrite human-owned content, never delete → regenerate.
This spec extends it to the integrity level:

## 14.1 Ownership classes and allowed handling

| Ownership | Artifacts                                    | When `STALE`                                                                                                                                              |
| --------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| generated | `.ai/repository-analysis.json`               | refreshable by an explicit regenerate that re-captures baseline; never silent                                                                             |
| human     | workflows, AGENTS.md, plan authored sections | report + human action only; the engine never rewrites                                                                                                     |
| mixed     | plans, sessions, current-context             | engine may update only its machine-owned portion (front-matter, baseline) at the next legitimate touch; authored sections require explicit reconciliation |

## 14.2 The reconciliation ladder

```text
VALIDATE
   ↓
STALE
   ↓
RECONCILE
```

Reconciliation is always **explicit**: the engine reports the staleness, names
what changed (S1–S5), and records that a baseline was refreshed when it is. It
never performs:

```text
STALE → DELETE → REGENERATE
```

for anything containing human-owned content. `doctor`'s current repair advice
("re-run init or sync") is regeneration; for context artifacts it is replaced
by VALIDATE → STALE → RECONCILE, with the refresh path reserved for generated
artifacts.

## 14.3 Ordering rule

Before any generated artifact is refreshed, the engine checks which other
artifacts reference it (`source:` links, scope inheritance). A refresh that
would invalidate a dependent's grounding is reported first; dependents are
never silently re-anchored.

---

# 15. Multi-Agent Branch Safety (V3-08)

Git remains the coordination substrate; v3 adds detection, not coordination.

1. **State-change detection between sessions.** Any artifact's baseline vs.
   current git facts is checkable at any time; a session starting from a branch
   state where prior context is `STALE` is told so (handoff integrity, §13).
2. **No stale handovers.** `current-context.md` is last-writer-wins today
   (audit §3.8); v3 keeps that behavior but the writer's session records the
   state it overwrote, and the reader sees the source session marker.
3. **Conflicting assumptions are visible, not resolved.** Two agents whose
   baselines disagree with the same HEAD both see their own staleness; the
   engine never picks a winner.
4. **Human decisions are preserved** — Axis 3; generated output cannot override
   them.
5. **Concurrency stays out of scope.** The manual-testing L-8 risk
   ("concurrent `.dooz/` modifications untested") remains a documented
   single-operator assumption; v3 adds no locking or merge machinery. Git
   remains the coordination substrate.

---

# 16. CLI Surface (V3-13)

Per the plan's instruction — "establish contracts and determine which commands
materially improve dogfood" — this spec commits to a minimal surface and defers
the rest:

| Command                       | Status in first cut | Rationale                                                                                                |
| ----------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------- |
| `doozctl context validate`    | **ship**            | the natural read-only integrity surface; emits the existing `CommandReport` shape (`{report, problems}`) |
| `status` context block        | **ship**            | hangs off `buildStatusReport` without changing its read-only proof (audit §5)                            |
| `verify` grounding qualifiers | **ship**            | extends the existing evidence table (one column), not a new command                                      |
| `context status`              | defer               | redundant with the status block                                                                          |
| `context inspect`             | defer               | only if dogfood shows a need to inspect raw provenance                                                   |
| `evidence validate`           | defer               | redundant with `verify` qualifiers                                                                       |
| `plan validate`               | defer               | roadmap-deferred by design; plan drift is a report observation (§12)                                     |

`context validate` output shape:

```text
Context Integrity

✓ repository-analysis.json — TRUSTED (commit a1b2c3d)
✓ sessions/2026-08-13_1015.md — TRUSTED
⚠ plans/2026-08-10-attendance-punch-sync.md — STALE
    src/PunchService.php changed since baseline a1b2c3d
⚠ current-context.md — STALE (source session stale)
? plans/2026-08-01-legacy-plan.md — UNKNOWN (no baseline)
✗ plans/2026-08-02-orphan.md — INVALID (baseline commit unreachable)

Result: 2 stale, 1 unknown, 1 invalid
```

Machine-readable output is considered where useful but remains secondary to
the human-readable CLI (v3 plan §7).

**Exit-code policy (D1):** `context validate` follows the v2 precedent set by
`status`/`verify`/`doctor` — `problems.length > 0` returns `ExitCode.Error`
(`src/app/app.ts`). Problems are `STALE` and `INVALID` artifacts; `CURRENT` and
`UNKNOWN` findings are reported but never fail the command. Rationale:
`UNKNOWN` (pre-v3 artifacts) is "no claim made", not "known untrustworthy" —
failing on it would make every v2-era repository permanently red until plans
are re-baselined. Deterministic by construction: trust states are
deterministic.

---

# 17. Determinism and Data Model Rules

1. **No wall-clock in stored state.** Baselines store git facts only. Reports
   may derive age from git commit dates (deterministic given the same
   repository state).
2. **Stored writes stay byte-identical-or-skipped.** Provenance capture follows
   the v2 `writeStep`/`RepositoryStore.saveAnalysis` rule: a write that would
   produce an identical byte stream is skipped, preserving the idempotency
   proofs.
3. **Model purity preserved.** Provenance parsing is pure and clock/git-free;
   capture happens at the app/step layer (`AppDeps` pattern).
4. **Read-only git only.** All signals (§9.2) are read-only commands. The
   engine never writes to git.
5. **Sandboxing carries over.** Scope paths and `source:` ids parsed from
   authored content go through existing validation (`isValidPlanId`,
   `isSafeRelativePath`, Storage confinement) before any use (audit §4.8).
6. **Reports are deterministic.** Same repository state → byte-identical
   `context validate` / status / verify output.

---

# 18. Compatibility and Versioning

1. **v2 behavior is unchanged.** No v2 command changes output for v2-created
   artifacts until a v3 command explicitly evaluates them. All 484 tests and
   the 96%+ coverage gate stay green; v3 work packages inherit the v2 testing
   requirements (unit + integration + deterministic-output + malformed-input +
   idempotency + safety).
2. **Additive metadata only.** v3 adds: optional `## Baseline` section to plans,
   session front-matter variables (`dirty`, `source`), current-context
   provenance variables, a `commit` field to analysis. Session and
   current-context _files_ are package-template-owned — the engine contract is
   the `session.*` variable set, so additions are new variables plus additive
   template lines, never engine-hard-coded headers (D3). No new file types in
   the first cut.
3. **Backward compatibility of evaluation.** Pre-v3 artifacts have no baseline
   → `UNKNOWN`, never `INVALID`. `INVALID` is reserved for present-but-
   impossible metadata.
4. **PLAN-SPEC amendment.** The new optional `## Baseline` section is a
   versioned v3 amendment to the frozen v2 template (following the
   WORKFLOW-SPEC amendment precedent: one section added, order of existing
   sections untouched, old plans parse identically). It lands only when P04
   implements it, not before.
5. **V1 protection.** `.ai/` artifacts keep v1 behavior; additions are
   backward-compatible extensions (the analysis `commit` field is additive to
   the JSON shape).

---

# 19. Acceptance Criteria

The spec is accepted when the following can be demonstrated (deterministic,
read-only, byte-identical on repeat):

## Scenario A — relevant change (must detect)

> Agent A creates context (plan + session) at commit X for feature F. Agent B
> changes F at commit Y. Agent C starts from the same branch and consumes A's
> context.

Expected: `context validate` reports A's plan, session, and current-context as
`STALE` with the scoped-path reason (`src/...` changed since baseline X), and
`verify` demotes the plan's recorded evidence to `STALE-BASELINE`.

## Scenario B — unrelated change (must NOT over-flag)

> Agent B changes an unrelated part of the repository at commit Y. Agent C
> consumes A's context for feature F (scoped).

Expected: A's context is `CURRENT`/`TRUSTED` with a report line "repository
moved outside described scope". **This scenario is the acceptance gate for
scope (V3-03); without it, v3 is a noisy "everything changed" detector.**

## Scenario C — determinism and safety

Repeated runs on the same repository state produce byte-identical output; no
command writes to git or to human-owned content; pre-v3 artifacts report
`UNKNOWN`, never `INVALID`; the full v2 suite stays green.

---

# 20. Phasing

| Work package | Contract elements implemented                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V3-P03       | validate this spec against the v2 architecture; freeze the contract (decisions D1–D5 recorded in §21; architecture decisions A-1…A-8 recorded in ARCHITECTURE.md)                      |
| V3-P04       | §5 provenance: baseline capture (plan `## Baseline`, analysis `commit`, session branch + `dirty` via one `detect()` call — D2); current-context provenance variables (D3, engine side) |
| V3-P05       | §6 scope: exact-path + directory-prefix declarations (D5), validation, plan-scope inheritance                                                                                          |
| V3-P06       | §9 integrity engine: signals S1–S5 (S6 excluded per D4), evaluation order, trust derivation (§10)                                                                                      |
| V3-P07       | §16 `context validate` command, `CommandReport` output, exit-code policy (D1)                                                                                                          |
| V3-P08       | §16 status context block                                                                                                                                                               |
| V3-P09       | §12 plan drift observation in status/verify                                                                                                                                            |
| V3-P10       | §11 evidence grounding qualifiers in verify (S4 first)                                                                                                                                 |
| V3-P11       | §13 handover v3: reference-template provenance block + carry-forward labeling (D3, template side), stale exposure                                                                      |
| V3-P12       | §19 multi-agent gauntlet — check spec in [GAUNTLET-SPEC.md](./GAUNTLET-SPEC.md); automated checks for Scenarios A + B                                                                  |
| V3-P13       | dogfood; measure false positives and handover fidelity                                                                                                                                 |
| V3-P14       | release gate (tests, typecheck, lint, build, security, deterministic-output, docs, backward compat, manual multi-agent scenarios, changelog)                                           |

---

# 21. Resolved Decisions (D1–D5)

The five decisions this spec previously left open are resolved here, each
grounded in v2 implementation evidence. Mechanical details (exact command
wiring, template edits) remain with P03/P04.

## D1 — `context validate` exit codes

**Decision:** follow the v2 precedent (`status`/`verify`/`doctor` return
`ExitCode.Error` when `problems.length > 0`, `ExitCode.OK` otherwise —
`src/app/app.ts:228,252`). Problems = `STALE` + `INVALID` artifacts.
`CURRENT` and `UNKNOWN` are reported but never fail the command.

**Rationale:** `UNKNOWN` means "no claim made" (pre-v3 artifacts), not "known
untrustworthy". Failing on `UNKNOWN` would keep every v2-era repository red
until plans are re-baselined. Deterministic either way, since trust states
are deterministic.

**Consequence:** scripts can gate on `context validate`; `UNKNOWN` rows are
informational.

## D2 — `dirty` in session front-matter

**Decision:** ship in **P04**, bundled with the stored-branch fix, using one
`GitService.detect()` call.

**Rationale:** `GitService.detect()` already returns `{root, branch, dirty}`
from a single read-only `rev-parse` + `status --porcelain` pair
(`src/infra/git/git.ts`) — the branch fix and the `dirty` field are the same
code path P04 touches anyway. The session _file_ is package-template-owned;
adding `- Dirty: {{session.dirty}}` is an additive template line (tests use
`toContain` assertions), and `ctx.variables.session` grows one field.

**Consequence:** sessions complete their provenance in P04; P11 only surfaces
it in handover text.

## D3 — current-context provenance placement and timing

**Decision:** the engine does **not** hard-code a header. Session and
current-context files are package-template-owned; the engine contract is the
`session.*` variable set (`sessionStep`, `src/engine/steps.ts`). The engine
adds provenance variables in **P04**; the reference package template renders a
**top-of-file** machine-parseable block (`- source: session:<ts>`, baseline
lines); carry-forward labeling surfaces in **P11**.

**Rationale:** `extractPreviousContext` (`src/engine/session.ts`) only collects
content after `#` headings, so a top-of-file bullet block is parse-safe; plan
`## Metadata` sets the "machine block at top" precedent; a package-owned block
keeps v1 `.ai/` shape changes additive and backward-compatible.

**Consequence:** legacy current-context files (no block) label carry-forward
sources as "unknown (pre-v3)" — deterministic, consistent with `UNKNOWN`.

## D4 — S6 (workflow-method drift)

**Decision:** **not a staleness signal** in v3. Removed from the signal set;
recorded as an explicit non-signal (§9.3).

**Rationale:** workflow methods are policy on the **governance axis** (§4 rule
1, §7.1) — the spec's own boundary says policy is never staleness-checked. A
method change alters _how remaining work should proceed_; it does not stale the
_repository facts_ a plan recorded. Treating it as staleness would cross the
axis boundary the authority model draws. (`status` already surfaces
adopted-workflow state for governance.)

**Consequence:** if dogfood (P13) shows a method change making a plan's
stage-based evidence genuinely unreadable, that becomes a versioned contract
extension introducing a _governance-drift_ surface — never a staleness signal.

## D5 — scope-path syntax

**Decision:** first cut = **exact paths + directory prefixes** (trailing `/`);
**no glob syntax** (`*`, `**`).

**Rationale:** each declaration maps 1:1 to a git pathspec, so S2/S3 are
performed by git itself (`git diff --name-only <base>..HEAD -- <paths>`,
`git ls-tree HEAD -- <path>`) — no matcher, no dependency (the project's only
runtime dependency is `commander`). Validation stays the existing
`isSafeRelativePath` rule. Globs would add a matcher for no precision gain in
Scenarios A/B, whose feature scopes are exact files or directories.

**Consequence:** scope declarations are trivially safe to validate; glob
support, if dogfood ever demands it, maps to git pathspec `:(glob)` — still no
dependency.

---

# Appendix — Terminology Map (v2 → v3)

| v2 term                                                                          | v3 term                   | Notes                                                  |
| -------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------ |
| Context Separation categories (Rules/Facts/Present state/History/Intent/Methods) | artifact classes (§4)     | same boundaries, now checkable                         |
| Ownership model (V2-SPEC)                                                        | ownership (§14)           | engine-known for generated; declared for mixed         |
| Override hierarchy (WORKFLOW-SPEC)                                               | Governance axis (§7.2)    | extension-not-inheritance, adopted verbatim            |
| Evidence categories (WORKFLOW-SPEC)                                              | grounding classes (§11)   | LIVE / RECORDED / BASELINE                             |
| Plan lifecycle states                                                            | unchanged                 | drift is an observation (§12), never a lifecycle state |
| `verify` READY/NOT READY                                                         | trust states (§10)        | READY over-claims; trust states correct the vocabulary |
| Session six sections                                                             | unchanged                 | handoff gains stale exposure (§13)                     |
| `CommandReport`                                                                  | `context validate` output | same shape                                             |
