# DoozCTL v3 — Multi-Agent Gauntlet Specification (V3-P12)

**Version:** 1.0.0 (V3-P12 gauntlet contract — automated-check specification)
**Status:** Adopted — the checks below are specified first, implemented at V3-P12 once P04–P11 land, and form a gate input to V3-P14
**Input:** [CONTEXT-SPEC.md](./CONTEXT-SPEC.md) (v1.0.0, §15 and §19) · [ARCHITECTURE.md](./ARCHITECTURE.md) (1.0.0-contract, §8 P12) · the v3 plan (V3-P12)
**Predecessor contracts:** [CONTEXT-SPEC.md](./CONTEXT-SPEC.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [REALITY-AUDIT.md](./REALITY-AUDIT.md) · [V2-MANUAL-TESTING.md](../v2/V2-MANUAL-TESTING.md)

---

# 1. Purpose and Gate

CONTEXT-SPEC §19 freezes three acceptance scenarios and assigns them to V3-P12
("§19 multi-agent gauntlet (Scenarios A + B as automated checks)"), but does
not enumerate the checks. This document is that enumeration: every automated
check the gauntlet suite must contain, each traced to the contract, with its
setup, its command sequence, and its expected results. It is written **before**
the tests so the checks themselves are reviewable — P12 then implements this
spec verbatim as integration tests.

The gauntlet's job, restated from the v3 plan and CONTEXT-SPEC §19:

> **Scenario A (must detect):** Agent A creates context (plan + session +
> current-context) at commit X for feature F. Agent B changes F at commit Y.
> Agent C starts from the same branch and consumes A's context. DoozCTL must
> report A's plan, session, and current-context `STALE` with a scoped-path
> reason, and `verify` must demote A's recorded evidence to
> `STALE-BASELINE` — **before** C can treat A's context as current.

> **Scenario B (must NOT over-flag):** Agent B changes an _unrelated_ part of
> the repository at commit Y. Agent C consumes A's scoped context for feature
> F. DoozCTL must keep A's context `CURRENT`/`TRUSTED` with the report line
> "repository moved outside described scope" and exit OK. Without Scenario B,
> v3 is a noisy "everything changed" detector — this is the acceptance gate
> for scope (CONTEXT-SPEC §19).

> **Scenario C (determinism and safety):** repeated evaluation on the same
> repository state is byte-identical; no command writes to git, to generated
> content, or to human-owned content; pre-v3 artifacts report `UNKNOWN`, never
> `INVALID`; the full v2 suite stays green.

**Definition of done (§12):** the gauntlet passes when every check in the §10
inventory passes on a clean checkout, `pnpm check` is green with the suite
present, and the whole suite is deterministic (a second clean-checkout run
passes identically). At V3-P14 the gauntlet runs as part of the release gate;
the P14 manual multi-agent scenario supplements, never replaces, it.

---

# 2. Non-Goals

The gauntlet deliberately does **not** simulate:

- **Real agents or AI.** "Agent A/B/C" are sequential CLI/App invocations in
  one temp repository. The durable residue of an agent act — plan, session,
  current-context — is exactly what v3 checks.
- **Concurrency.** The v2 single-operator assumption (V2-MANUAL-TESTING §7,
  L-8) is inherited: no check ever runs two processes against one repository.
  Git remains the coordination substrate; v3 adds no locking or merge
  machinery (CONTEXT-SPEC §15.5).
- **Time or network.** The suite is offline and wall-clock-free: a frozen,
  harness-advanced clock (AppDeps `now`) drives session ids; no assertion ever
  reads `Date.now` or a stored clock.
- **Engine writes.** DoozCTL never creates a commit in any check. All commits
  are made by the test harness (git plumbing) — the engine's read-only
  posture is itself one of the things the gauntlet verifies (Scenario C).
- **Scope creep in P12.** P12 is tests-only: no `src/` changes. If a check
  exposes a genuine contract gap, it is escalated to P13 measurement / P14,
  never patched inside the gauntlet.

---

# 3. Agent Model and Harness Primitives

Each "agent" is a named sequence of commands run at a pinned repository state.
The agent boundary v3 cares about is the handover chain: an agent's plan
(intent), session (history), and the current-context they leave for the next
agent (present state). Agent identity flows into the session record via the
existing `--tool` / `--model` / `--user` surface; session ids derive from the
frozen clock, so the same scenario always produces the same filenames.

The suite is built from the repo's existing integration conventions
(`tests/integration/summarize.test.ts`, `cli.test.ts`) plus these primitives:

| #   | Primitive                       | Definition                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-1 | `tmpRepo` / `tmpPkg`            | `mkdtemp` repositories + a standards package declaring the session/current-context artifacts (the `writeSummarizePackage` pattern), cleaned in `afterAll`                                                                                                                                            |
| H-2 | `commit(repo, message)`         | `git init -b main`, fixed `user.email`/`user.name`, `add -A`, `commit` — with `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` pinned per scenario so even commit hashes replay deterministically                                                                                                              |
| H-3 | `runCli([...], dispatcher)`     | the existing CLI runner returning the exit code, with captured stdout/stderr (`capture()` pattern). Session/plan ids stay deterministic by advancing the frozen clock a fixed step per agent act — never reusing one timestamp, which the immutable-session same-second collision guard would reject |
| H-4 | `evaluate(repo, args)`          | terminal `analyze` refresh, then the command under test. The refresh re-captures the generated analysis baseline at the current HEAD (A-3: analysis refreshes on `init`/`analyze` only; §14.1 generated-refreshable) so the analysis row is the suite's **control row** (below)                      |
| H-5 | `state(repo)` / `assertNoWrite` | pre/post capture of `git rev-parse HEAD`, `git status --porcelain`, the full file inventory of `.ai/` and `.dooz/`, and byte-identity of every artifact — the AS-5 no-write probe                                                                                                                    |

**The analysis control row.** `.ai/repository-analysis.json` is generated and
unscoped — no scope declaration exists for it. Per §6.1, an unscoped artifact
whose baseline commit precedes HEAD reports `STALE` (conservative). That is
correct-by-contract for a derived present-state artifact, and its refresh path
is an explicit `analyze`. Every evaluation stage therefore ends with H-4's
terminal `analyze`, after which the analysis row is `CURRENT` (baseline ==
HEAD; the tree is dirty only by the refreshed analysis, a qualifier, §9.3).
**Checks never assert staleness about the analysis row** beyond that control
expectation — except the deliberate conservative-rule check (T-1) that runs
_without_ the refresh to pin the unscoped behavior.

---

# 4. Canonical Fixture and Timeline

One shared fixture (FIX-1) and one shared stage-A procedure (CA) underpin
Scenarios A and B; every check is a self-contained repo built from them with
its own delta.

## FIX-1 — fixture layout

```text
<repo>                          <pkg>   (external temp dir)
  src/attendance/PunchService.ts        package.json   → session + current-context artifacts
  tests/attendance/PunchService.test.ts artifacts/session.md
  src/billing/Invoice.ts                artifacts/current-context.md
  src/billing/Invoice.test.ts
```

- Feature F = `src/attendance/` + `tests/attendance/` (the plan's declared
  scope). Unrelated area U = `src/billing/` (Scenario B's change target).
- An adopted workflow document id `feature` under `.dooz/workflows/adopted/`
  (the v2 `adoptWorkflow` pattern), so `plan` resolves a method.

## Timeline

| Commit | Contents                                                                    | Purpose                                 |
| ------ | --------------------------------------------------------------------------- | --------------------------------------- |
| C0     | source files only                                                           | seed — no control plane yet             |
| C1     | `init` + `sync` outputs, adopted workflow, AGENTS.md, `.dooz/manifest.json` | bootstrap control plane at a clean HEAD |
| X      | plan + session + current-context (stage CA below)                           | Agent A's context, all baselines C1     |
| Y      | B's change (in-scope for Scenario A, out-of-scope for Scenario B)           | Agent B's commit                        |

## CA — Agent A's stage (runs at HEAD C1, clean)

1. `plan <repo> --method feature --title "attendance punch sync"` → plan file
   `.dooz/plans/active/2026-08-09-attendance-punch-sync.md` rendered with a
   `## Baseline` block (commit C1, `dirty: yes` — the tree carries the
   uncommitted plan file; dirty is a qualifier, never a signal, §9.3).
2. Author the plan (harness writes authored content, the agent's act):
   `- scope-path: src/attendance/` and `- scope-path: tests/attendance/` in
   `## Baseline` (A-6: agents may add scope lines; validation applies), the
   method's evidence sections under `## Acceptance Criteria` / `## Verification`
   (so recorded rows exist to be demoted later), and `## Commit` = C1 (the
   evidence baseline: the repo state A's evidence rests on).
3. Transition the plan to `EXECUTING` through the v2-supported path (active,
   verifiable, but not completed — `verify` acts on it at Y).
4. `summarize <repo> <pkg> <session-file>` → immutable session
   `.ai/sessions/<ts>.md` (baseline commit C1 read live via one `detect()`,
   `source: plan:attendance-punch-sync`) and current-context overwritten with a
   top-of-file provenance block (`source: session:<ts>`, baseline C1).
5. `commit` the control-plane delta → **X** (clean tree).

At X, every context artifact has baseline C1 (X's parent) and a scoped diff
C1..X that is empty over `src/attendance/` — so the post-stage evaluation is
the **green baseline** (A-0/B-0): all rows `CURRENT` + the outside-scope note,
analysis `CURRENT` after H-4, exit 0.

> Determinism note: context files are committed at X, after their baselines
> were captured at C1. This is not a baseline refresh (A-3: never silently
> refreshed) — authored edits and the commit that carries them are content,
> and the scoped diff is computed against git history, so the sequence is
> fully deterministic and realistic.

---

# 5. Assertion Vocabulary

Every check composes these assertion primitives. Exact report wording is an
P07 implementation detail (ARCHITECTURE §9.3) locked by P07 snapshots; the
gauntlet asserts on **stable tokens and substrings** and on **byte equality**
(AS-6), never on golden prose.

| #    | Assertion                                          | Meaning                                                                                                                                                                |
| ---- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AS-1 | `exit(code)`                                       | D1 exit policy: `ExitCode.Error` (1) iff at least one `STALE` or `INVALID` artifact row exists; `OK` (0) when only `CURRENT`/`UNKNOWN` rows exist; usage errors stay 2 |
| AS-2 | `row(artifact, state)`                             | the report has a row for the artifact whose trust token is exactly `TRUSTED` / `STALE` / `UNKNOWN` / `INVALID`                                                         |
| AS-3 | `note("repository moved outside described scope")` | a `CURRENT` row under a moved HEAD carries the §6.3 note line                                                                                                          |
| AS-4 | `qualifier(row, "STALE-BASELINE")` / absence       | `verify` evidence rows: recorded rows under a `STALE` plan carry `STALE-BASELINE` (§11.2 rule 2); `BASELINE` (`commit`) rows carry the reachability qualifier (S4)     |
| AS-5 | `assertNoWrite(pre, post)`                         | H-5 pre/post state is equal: HEAD, `status --porcelain`, `.ai/`/`.dooz/` inventory, and byte-identity of every artifact — for every read-only command                  |
| AS-6 | `byteIdentical(run × 2)`                           | the same command run twice on the same state emits byte-identical stdout and the same exit code                                                                        |
| AS-7 | `drift(plan, paths)`                               | a `STALE` plan's report carries the §12 drift observation: plan identity, `Context: STALE`, baseline → HEAD, reason lines naming the changed scoped paths              |

---

# 6. Scenario A — Relevant Change Must Be Detected

| Check                                            | Setup delta                                                                   | Command sequence                                  | Expected                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A-0** green baseline                           | FIX-1 + CA                                                                    | `evaluate(validate)` at X                         | `AS-2`: plan, session, current-context rows `TRUSTED`; each carries the AS-3 note (baseline C1 precedes X; scoped diff empty). Analysis control row `CURRENT`. `AS-1`: exit 0. `status` Context block: no `STALE`                                                                                                                                                                                 |
| **A-1** plan goes `STALE`                        | A-0 + B edits `src/attendance/PunchService.ts`, `commit` Y                    | `evaluate(validate)` at Y                         | `AS-2`: plan row `STALE`. `AS-7`: drift block names `src/attendance/PunchService.ts`. `AS-1`: exit 1                                                                                                                                                                                                                                                                                              |
| **A-2** session + current-context go `STALE`     | same state as A-1                                                             | `evaluate(validate)` at Y                         | `AS-2`: session row `STALE` and current-context row `STALE` (baselines C1; scope inherited through the `source:` chain, A-6). Exactly three stale context rows; no spurious rows beyond the contract (analysis control `CURRENT`)                                                                                                                                                                 |
| **A-3** verify demotes recorded evidence         | same state as A-1                                                             | `evaluate(verify)` at Y                           | `AS-4`: recorded rows (`acceptance-criteria`, `tests`, `verification`) carry `STALE-BASELINE`; the plan's `## Commit` = C1 row is qualified recorded-older-not-current (reachable from Y, ≠ Y). `AS-7` drift present in the verify/status report. READY/NOT READY prose is not pinned here — the P10 contract settles that interaction before P12                                                 |
| **A-4** handover re-grounds C, never A           | A-1 + Agent C `summarize`s at Y (H-3 advances the clock; new session content) | `evaluate(validate)` at Y                         | C's new session row `TRUSTED` (baseline Y == HEAD); current-context overwritten with top block `source: session:<C's ts>` (P11), row `TRUSTED`; **A's session file is byte-identical and still `STALE`** (immutable, §13; its scope change stands). Plan still `STALE` — summarize performs no baseline reconcile (A-3), so exit stays 1: the reader sees "re-understand before continuing" (§12) |
| **A-5** read-only pass leaves the repo untouched | A-1 state                                                                     | validate, then status, then verify (no summarize) | `AS-5` for every command: HEAD, porcelain, inventory, and artifact bytes (plan authored sections + `## Baseline` included) unchanged. This is the §19 Scenario C safety leg applied to the "problem" state                                                                                                                                                                                        |

Scenario A's terminal state is intentionally red: A's context is stale at Y
and stays stale until an explicit human/agent reconcile (v3.0 automates
nothing, §14). That persistent signal is the acceptance outcome, not a
failure of the suite.

---

# 7. Scenario B — Unrelated Change Must Not Over-Flag

| Check                                                     | Setup delta                                        | Command sequence          | Expected                                                                                                                                                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B-0** green baseline                                    | FIX-1 + CA                                         | `evaluate(validate)` at X | identical to A-0                                                                                                                                                                                                                                           |
| **B-1** scoped chain stays current                        | B-0 + B edits `src/billing/Invoice.ts`, `commit` Y | `evaluate(validate)` at Y | `AS-2`: plan, session, current-context rows `TRUSTED`; each carries the AS-3 note. **No `STALE` row.** `AS-1`: exit 0. This is the §19 Scenario B acceptance gate                                                                                          |
| **B-2** verify is not demoted                             | same state as B-1                                  | `evaluate(verify)` at Y   | recorded rows keep their grounded qualifiers — no `STALE-BASELINE`. The `## Commit` = C1 row keeps its recorded-older qualifier (S4 fires on any older reachable hash; a qualifier, not a demotion). READY/NOT READY semantics are unchanged by qualifiers |
| **B-3** status stays clean                                | same state as B-1                                  | `evaluate(status)` at Y   | Context block: `STALE` count 0; no AS-7 drift for the plan; analysis control row `CURRENT`                                                                                                                                                                 |
| **B-4** analysis control row survives an unrelated commit | same state as B-1                                  | —                         | covered by B-1..B-3 expectations (analysis `CURRENT` after H-4 refresh); listed so the control row is explicit                                                                                                                                             |

---

# 8. Scenario C — Determinism and Safety

| Check                                                 | Setup                                                                                                                                           | Command sequence                    | Expected                                                                                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C-1** byte-identical repeats                        | both the A-1 state (problems) and the B-1 state (clean)                                                                                         | validate, status, verify each twice | `AS-6` for every command on both states                                                                                                                                                           |
| **C-2** read-only on a problem state                  | A-1 state                                                                                                                                       | validate, status, verify            | `AS-5` for each: no HEAD move, no porcelain delta, no new files under `.ai/`/`.dooz/`, every artifact byte-identical (the stale plan, A's immutable session, current-context, analysis, manifest) |
| **C-3** pre-v3 artifacts → `UNKNOWN`, never `INVALID` | fixture where context predates v3: plan without `## Baseline`, analysis JSON without `commit`, session/current-context from the legacy template | validate                            | `AS-2`: those rows `UNKNOWN`. `AS-1`: exit 0 (`UNKNOWN` is informational, D1). `status` Context block counts `UNKNOWN`. `AS-2` negation: no `INVALID` row (§18.3)                                 |
| **C-4** malformed / unreachable metadata → `INVALID`  | T-6 / T-7 states                                                                                                                                | validate                            | `AS-2`: rows `INVALID`; `AS-1`: exit 1. `INVALID` is reported, never repaired (§10.2)                                                                                                             |
| **C-5** full gate stays green                         | whole suite                                                                                                                                     | `pnpm check`                        | passes with the gauntlet present; P12 touches no `src/`; no new runtime dependency (A-8.8); v2 command output for v2-created artifacts is unchanged (§18.1)                                       |

---

# 9. Coverage Matrix

## 9.1 Trust-state and signal rows (T-1…T-8)

Systematic coverage of the ARCHITECTURE A-5 classification table and the §9.2
signals. Rows already exercised by A/B/C reference them.

| #   | Contract                   | Setup delta                                                                                                                                                                                        | Expected                                                                                                                                                                                                                                              |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-1 | §6.1 conservative default  | plan created **without** scope-path; unrelated `commit` Y (B-1 shape)                                                                                                                              | plan row `STALE` (unscoped, commit moved). Documents that Scenario B passes only for scoped chains. **Flagged for P13:** unscoped artifacts are conservative by contract (A-6); dogfood measures whether this is actionable friction                  |
| T-2 | S2 scoped change           | A-1 state                                                                                                                                                                                          | `STALE` (reference)                                                                                                                                                                                                                                   |
| T-3 | §6.3 unchanged scope       | B-1 state                                                                                                                                                                                          | `CURRENT` + AS-3 note (reference)                                                                                                                                                                                                                     |
| T-4 | S3 scope path disappears   | B deletes `src/attendance/PunchService.ts`, `commit` Y                                                                                                                                             | plan row `STALE`; reason names the missing path (`git ls-tree HEAD` empty)                                                                                                                                                                            |
| T-5 | §10.2 no baseline          | C-3 state                                                                                                                                                                                          | `UNKNOWN` (reference)                                                                                                                                                                                                                                 |
| T-6 | §10.2 unreachable baseline | history rewrite: re-parent or delete the branch so X is unreachable from the new HEAD while A's artifact files remain present (harness mechanics; e.g. rebuild the branch from a rewritten parent) | rows `INVALID`; exit 1                                                                                                                                                                                                                                |
| T-7 | §10.1 malformed metadata   | plan `## Baseline` with an empty `- commit:` or invalid `- dirty: maybe`                                                                                                                           | row `INVALID`; exit 1                                                                                                                                                                                                                                 |
| T-8 | §4 / A-4 inventory         | CA + transition plan to `COMPLETED` (moves to `.dooz/plans/completed/`), then in-scope `commit` Y                                                                                                  | completed plan row `STALE` with the same signal set. **Flagged for P13:** terminal artifacts stay `STALE` permanently (immutable, unreconcilable by the engine); the gauntlet pins the contract-literal consequence and dogfood measures the friction |

## 9.2 Non-signal guards (N-1…N-5)

Each guard exists so a future change cannot regress v3 into a noisy detector
or a writer. All are `STALE`-absence assertions with exit 0 unless noted.

| #   | Guard                                              | Setup                                                             | Expected                                                                                                                                                                                                  |
| --- | -------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N-1 | uncommitted scoped change is not staleness         | B edits `src/attendance/PunchService.ts`, **no commit**           | all rows stay `TRUSTED`; no `STALE`; exit 0. Signals are commit-grounded (S1 compares baseline commit to HEAD; A-5). The dirty tree is a qualifier, never a signal (§9.3)                                 |
| N-2 | branch rename is not staleness                     | `git branch -m` at unchanged HEAD                                 | rows unchanged; exit 0 (S1 compares commits, §9.3)                                                                                                                                                        |
| N-3 | workflow-method change is not staleness            | adopted workflow `feature` content edited at Y (D4)               | rows unchanged; exit 0 — methods are the governance axis, never staleness-checked (§9.3, D4)                                                                                                              |
| N-4 | scope cycle is detected, not evaluated             | `source:` chain A→B→A (session scopes to a plan that scopes back) | the artifact reports `INVALID` (self-contradictory metadata, §10.1) with a cycle reason; detected pre-evaluation (A-6)                                                                                    |
| N-5 | authored content and baselines are never rewritten | A-1 state                                                         | after all read-only commands, the plan's authored sections and its `## Baseline` are byte-identical — drift is an observation (AS-7), never a write (A-3; overlaps A-5, listed as an explicit non-signal) |

---

# 10. Check Inventory

| Check     | State                           | Commands                           | Expected exit                      |
| --------- | ------------------------------- | ---------------------------------- | ---------------------------------- |
| A-0 / B-0 | green baseline at X             | validate, status                   | 0                                  |
| A-1       | in-scope change Y               | validate                           | 1                                  |
| A-2       | same                            | validate                           | 1                                  |
| A-3       | same                            | verify                             | per P10/§19 demotion; AS-1 applied |
| A-4       | after Agent C's summarize       | validate                           | 1 (plan stays stale)               |
| A-5       | A-1 state                       | validate, status, verify           | per state; no writes               |
| B-1       | out-of-scope change Y           | validate                           | 0                                  |
| B-2       | same                            | verify                             | 0 (no demotion)                    |
| B-3       | same                            | status                             | 0                                  |
| B-4       | same                            | (control row, covered by B-1..B-3) | 0                                  |
| C-1       | A-1 and B-1 states              | validate, status, verify × 2       | byte-identical                     |
| C-2       | A-1 state                       | validate, status, verify           | no writes                          |
| C-3       | pre-v3 artifacts                | validate, status                   | 0                                  |
| C-4       | T-6 / T-7 states                | validate                           | 1                                  |
| C-5       | whole suite                     | `pnpm check`                       | 0                                  |
| T-1       | unscoped plan, unrelated change | validate                           | 1                                  |
| T-4       | scoped path deleted             | validate                           | 1                                  |
| T-6       | unreachable baseline            | validate                           | 1                                  |
| T-7       | malformed baseline              | validate                           | 1                                  |
| T-8       | completed plan, in-scope change | validate                           | 1                                  |
| N-1       | uncommitted scoped change       | validate                           | 0                                  |
| N-2       | branch rename                   | validate                           | 0                                  |
| N-3       | workflow-method change          | validate                           | 0                                  |
| N-4       | scope cycle                     | validate                           | 1 (`INVALID`)                      |
| N-5       | A-1 state                       | read-only pass                     | no writes                          |

---

# 11. Implementation Notes (for V3-P12)

- **Placement.** One suite, `tests/integration/gauntlet.test.ts`, with vitest
  `describe` names prefixed `gauntlet` (e.g. `gauntlet: scenario A — …`) so
  `-t gauntlet` filters it. Each check builds its own repo from FIX-1 / CA —
  no shared mutable state, vitest-parallel safe.
- **Harness reuse.** H-1/H-2/H-3/H-5 reuse the exact patterns in
  `summarize.test.ts` (temp dirs, package artifacts writer, frozen `AppDeps`
  clock, `runCli` + `capture`). H-2 pins `GIT_AUTHOR_DATE` /
  `GIT_COMMITTER_DATE` so whole-scenario replays are byte-stable, enabling
  C-1's equality and even golden replays.
- **Sequencing.** The suite depends on P04 (baseline capture/parse), P05
  (scope validation + inheritance + cycle walk), P06 (signals S1–S5,
  reachability), P07 (`context validate`, D1 exits, report), P08 (status
  Context block), P09 (drift observation), P10 (verify qualifiers), and P11
  (template provenance + `source:` markers). P12 is the integration pass over
  all of them and lands last in the phasing.
- **Assertion targets.** The gauntlet asserts stable tokens and substrings
  (AS-2/AS-3/AS-4), equality (AS-6), and no-write probes (AS-5). Full-byte
  golden text for the new report surfaces is locked where needed by snapshot
  tests following the existing `__snapshots__` convention — at P07 for wording,
  not re-litigated in the gauntlet.
- **Contract observations surfaced for P13 (not changed here).** (1) Unscoped
  artifacts are conservative-`STALE` on any commit move (§6.1), so Scenario B
  passes only for scoped chains and the analysis control row requires the
  explicit stage-final refresh (T-1). (2) Terminal artifacts — old immutable
  sessions and completed plans — stay `STALE` permanently and cannot be
  reconciled by the engine (A-4, T-8), so a repo with history can hold a
  permanent exit-1. The gauntlet pins both contract-literal behaviors and
  records them as the P13 false-positive/friction measurement targets they
  are (CONTEXT-SPEC §19, ARCHITECTURE A-6), so any amendment is versioned and
  deliberate.

---

# 12. P14 Gate Role

At V3-P14 the gauntlet is a release-gate input, alongside the existing
deterministic-output, idempotency, safety, and backward-compat suites:

1. Every check in the §10 inventory passes on a clean checkout.
2. C-5 holds — `pnpm check` green, no `src/` change attributable to P12, no
   new dependency.
3. The suite is deterministic end-to-end: a second clean-checkout run passes
   with byte-identical outputs (H-2 date pinning makes even hashes stable).
4. The P14 manual multi-agent scenario (v3 plan §17) is run by a human against
   the same choreography the automated suite covers — the manual pass validates
   developer friction and handover readability, which no assertion can.
