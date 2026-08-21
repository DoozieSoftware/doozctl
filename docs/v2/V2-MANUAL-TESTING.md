# DoozCTL v2 — Phase 2 Manual Testing Readiness Analysis

**Status:** Ready for manual testing (GO, with caveats)
**Date:** 2026-08-21
**Covers:** v2 phases 2.1–2.10 on top of frozen v1.0.0
**Purpose:** give a human tester everything needed to manually validate the v2
Engineering Control Plane before phases 2.11–2.15 (handoff, doctor, E2E,
red team, freeze).

---

# 1. Where Phase 2 Stands

| Phase | Deliverable                                    | Commit    | State |
| ----- | ---------------------------------------------- | --------- | ----- |
| 2.1   | Control-plane contracts frozen                 | `5a37d03` | ✅    |
| 2.2   | Plan domain model + storage                    | `d281ece` | ✅    |
| 2.3   | `doozctl plan` CLI                             | `786b8db` | ✅    |
| 2.4   | Workflow assets + adoption                     | `0f2c95f` | ✅    |
| 2.5   | Status control-plane view                      | `041e8aa` | ✅    |
| 2.6   | Evidence contract (WORKFLOW-SPEC v1.1.0)       | `a8a42c8` | ✅    |
| 2.7   | Workflow evidence validation                   | `fd8f37d` | ✅    |
| 2.8   | `doozctl verify`                               | `3f6501f` | ✅    |
| 2.9   | Test-fact visibility                           | `f8dfd1f` | ✅    |
| 2.10  | Path-bound changelog/version evidence (v1.2.0) | `abc8f89` | ✅    |

**Automated safety net at time of writing:** 483 tests / 30 files green;
coverage 96.19% statements / 93.36% branch; typecheck, lint and build clean;
`format:check` fails only on the pre-existing, out-of-scope
`docs/release/V1-FREEZE.md`.

---

# 2. What Is Next (After Manual Testing)

| Phase | Deliverable                   | Notes                                                                                                                                                          |
| ----- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.11  | Execution handoff             | Make `plan + .dooz + status/verify` sufficient for an agent/human to continue work without a conversation. Likely AGENTS.md guidance (hot context stays tiny). |
| 2.12  | Workflow-aware doctor         | Doctor learns `.dooz/` health: adopted-workflow validity, active-plan sanity — complementing status/verify.                                                    |
| 2.13  | End-to-end V2 integration     | One scripted pass across all commands on a real repository.                                                                                                    |
| 2.14  | Red team / independent review | Corruption, staleness, conflict, cross-agent misuse.                                                                                                           |
| 2.15  | V2 freeze → `2.0.0-rc.1`      | Contracts + engine locked.                                                                                                                                     |

Manual testing now is deliberately timed: it is the cheapest moment to find
semantics problems before handoff guidance (2.11) is written against them.

---

# 3. Readiness Verdict

**GO for manual testing**, based on:

- every v2 command has deterministic, snapshot-tested output;
- all red-team cases named in the milestones have automated coverage
  (traversal ids, symlinked plan dir, duplicate/corrupted plans, missing /
  duplicate / malformed workflows, invalid evidence declarations, dirty and
  empty repositories, repeated-run byte-identity for status **and** verify);
- read-only guarantees are proven by byte-level snapshots including `.git`;
- v1 command behavior is regression-guarded by the existing suite.

**Caveats that manual testing must probe** (automation cannot): real-platform
behavior (Windows/Linux), real-editor file mutations (CRLF, unicode),
ergonomics of the human/agent experience, performance on large real
repositories, and the semantics questions listed in §9.

---

# 4. Environment & Setup

Prerequisites: Node 18+, pnpm, git on PATH.

```bash
pnpm install
pnpm build                 # produces dist/index.js
pnpm test                  # must be green before you start: 483 passing
```

Run the built CLI from any scratch directory:

```bash
alias dz="node <repo>/dist/index.js"
```

> **Version caveat:** `dz --version` prints `0.0.0-dev` when invoked directly,
> because the version comes from the `npm_package_version` env var that only
> package-manager scripts set (`pnpm start`). This is cosmetic, not a v2
> regression — but note it if you see it.

Suggested sandbox per scenario group (fresh temp dir each group):

```bash
SCRATCH=$(mktemp -d) && cd "$SCRATCH" && mkdir repo && cd repo
```

A minimal Standards Package for init:

```
pkg/
├── package.json   (see below)
└── artifacts/AGENTS.md
```

```json
{
  "format": 2,
  "name": "test-standards",
  "version": "1.0.0",
  "engine": ">=1.0.0",
  "artifacts": [
    {
      "id": "agents",
      "source": "artifacts/AGENTS.md",
      "destination": "AGENTS.md",
      "merge": "managed-blocks",
      "lifecycle": ["init", "sync"]
    }
  ]
}
```

`artifacts/AGENTS.md` needs one managed block, e.g.

```markdown
# AGENTS

<!-- DOOZCTL:BEGIN:v1 repository-analysis -->

Lang: {{analysis.language}}

<!-- DOOZCTL:END:v1 repository-analysis -->
```

---

# 5. Manual Test Scenarios

Conventions: expected exit codes are `(0)` / `(1)` / `(2)`. "byte-identical"
means compare `find . -type f | sort | xargs shasum | shasum` before/after.

## A. Control-plane basics

- **M-01 Initialize + first status.** `dz init . ../pkg` `(0)`; `dz status .`
  `(0)` shows Repository (Path/Branch/Git/Languages/Tests when detected),
  `Control Plane / Initialized: yes`, `Active Plan / None`, and the
  create-a-plan next action.
- **M-02 Uninitialized repository.** Fresh non-init dir: `dz status .` and
  `dz verify .` both print the not-initialized guidance, exit `(1)`.
- **M-03 Create a plan.** Adopt nothing yet; `dz plan . --method bug-fix`
  without adoption exits `(2)` with "unknown plan method". After writing
  `.dooz/workflows/adopted/bug-fix.md` (valid minimal document), the same
  command creates `.dooz/plans/active/<today>-bug-fix.md` `(0)`.
- **M-04 Title-derived id.** `dz plan . --method bug-fix --title "Attendance Punch Sync"`
  creates id `attendance-punch-sync`; `--title "!!!"` exits `(2)` with usage.
- **M-05 Collision never overwrites.** Repeat M-03 exactly → exit `(1)`,
  "Plan already exists", original file untouched (check mtime/content).
- **M-06 Status with an active plan.** Shows ID/Method/Status, `Next:` state,
  Progress checklist matching the lifecycle position, Next Action from the
  plan's `## Next Action` section or "Not specified.".
- **M-07 Lifecycle progression display.** Hand-edit `- status:` forward
  (PLANNED→EXECUTING→VERIFIED→TESTED) and confirm Progress checkmarks and
  `Next:` track it. At VERIFIED, Verify is ✓ but Test must still be ✗ — no
  state may ever be claimed beyond the recorded status.

## B. Workflow adoption & validation

- **M-08 Project-local workflow.** Put the same method under
  `.dooz/workflows/project/` instead of `adopted/` → plan creation works;
  status/verify behave identically.
- **M-09 Duplicate adoption fails loudly.** Same id in both `adopted/` and
  `project/` → plan/status/verify all report the ambiguity, never pick one.
- **M-10 Malformed workflow.** Document whose `- id:` mismatches its filename
  → clear "malformed" problem everywhere the workflow is consumed.
- **M-11 Invalid evidence declaration.** Checklist item `- [ ] tsets` →
  `plan` exits `(1)` with the valid-category list; `status` shows the problem
  line; `verify` refuses to guess.
- **M-12 Bare path-bound category.** `- [ ] changelog` without `:path` →
  invalid requirement, same as M-11.

## C. Verification (all eight categories)

Build a release-style workflow declaring:
`acceptance-criteria, tests, verification, commit, git-state, release,
changelog: CHANGELOG.md, version: package.json`.

- **M-13 Empty plan → NOT READY.** All rows ✗, Missing lists every category
  (path-bound ones path-qualified), exit `(1)`.
- **M-14 Fill plan sections.** Record text under Acceptance Criteria /
  Verification / Test Evidence / Commit → those rows flip to ✓.
- **M-15 Git facts.** In a git repo: git-state ✓. Tag HEAD (`git tag v1.0.0`)
  → Release ✓; delete tag → ✗ again. Outside any git repo both degrade
  honestly.
- **M-16 Changelog/version files.** Create non-empty `CHANGELOG.md` and a
  `package.json` containing `"version": "x.y.z"` → ✓. Empty changelog or a
  version-less JSON → ✗ with `Missing: Changelog (CHANGELOG.md)`.
- **M-17 READY end-state.** Everything satisfied → `Result / READY`, exit
  `(0)`. Manual-evidence bullets are listed but never change the result.
- **M-18 Tests row annotation.** In a repo with test files, the Tests row
  carries the analyzer facts (e.g. `✗  2 test files`) on ✓ and ✗ alike.
- **M-19 Status mirrors reality.** The Repository section's `Tests:` line
  matches what you know about the tree.

## D. Failure modes & safety (red-team by hand)

- **M-20 Multiple active plans.** Two files in `active/` → status and verify
  list both with id/method/status and refuse to choose, exit `(1)`.
- **M-21 Corrupted plan.** A plan file without `## Metadata` →
  "Plan <id> is invalid: …", no stack trace anywhere.
- **M-22 Hostile identifiers.** `--method ../escape` → usage error `(2)`;
  `changelog: ../escape.md` in a workflow → invalid requirement.
- **M-23 Symlinked plan directory.** Point `.dooz/plans/active` outside the
  repo → "Unavailable." problem, no data read from outside.
- **M-24 Read-only proof, by hand.** Snapshot bytes; run `status` twice and
  `verify` twice (READY and NOT READY states); snapshot again → identical,
  including `.git`. Also confirm verify never creates `.dooz` entries.
- **M-25 Dirty vs clean.** Status reports Git: dirty/clean correctly around
  uncommitted changes.

## E. v1 regression sweep

- **M-26** `init → sync → analyze → doctor → summarize` full v1 loop on the
  sandbox package behaves exactly as v1.0.0 (doctor healthy, sync idempotent).
- **M-27** `dz --help` lists all eight commands including verify; each
  `--help` renders usage/example.
- **M-28** Unknown command and missing arguments produce the familiar
  humanized errors (no stack traces).

## F. Environment probes (informational)

- **M-29 Subdirectory invocation.** From a subdirectory of an initialized
  repo, `dz status` currently reports _not initialized_ (the manifest is
  looked up relative to cwd while analysis reports the git root). Expected
  today; recorded as limitation L-3.
- **M-30 Detached HEAD.** `git checkout --detach` → Branch shows
  "detached HEAD".
- **M-31 Platform matrix.** Repeat M-01/M-13/M-24 on Linux and Windows
  (paths, symlinks, shasum equivalents). macOS is the only CI-proven platform.
- **M-32 Real editors.** Edit plans/workflows in an editor that writes CRLF
  and/or unicode; parsing must keep working (the parsers normalize CRLF).

---

# 6. What Automation Already Proves (skip re-testing)

Per-command unit + integration suites already assert, byte-for-byte: output
shapes above, every failure message quoted in §5, exit-code mapping
(0/1/2), symlink escape handling, run-twice byte-identity, large plan bodies,
and v1 pipeline routing. Manual effort is best spent on platform variance,
real-repository scale, and the semantic questions in §9 — not on re-verifying
quoted strings.

---

# 7. Risk Register & Known Limitations

| #   | Limitation / risk                                           | Impact                                       | Mitigation                                           |
| --- | ----------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| L-1 | Verify checks **presence** of evidence, never truthfulness  | A filled section always counts               | By contract; executor integrity is the model         |
| L-2 | `changelog` = non-empty file, not "updated for this change" | Weak guarantee                               | Deliberate; "updated"-semantics deferred to overlays |
| L-3 | Commands expect to run from the repository root             | Subdir runs report "not initialized"         | Documented behavior; candidate improvement post-2.10 |
| L-4 | Only macOS exercised by automation                          | Windows/Linux unknown                        | Manual matrix M-31                                   |
| L-5 | No workflow management commands (adopt/list)                | Adoption is manual file copying              | Frozen out of v2.0 by spec                           |
| L-6 | Method-defined lifecycle states unsupported                 | Workflows use subsets of the canonical seven | Explicit deferral; revisit post-freeze               |
| L-7 | Direct `node dist/index.js --version` shows `0.0.0-dev`     | Cosmetic                                     | Use `pnpm start`                                     |
| L-8 | Concurrent modifications to `.dooz/` untested               | Two agents racing                            | Single-operator assumption for now; red-team 2.14    |

---

# 8. Exit Criteria for Manual Testing

Manual testing may be declared passed when:

- [ ] All scenarios M-01–M-28 executed with expected results (or deviations
      filed as issues);
- [ ] At least Linux **or** Windows probed via M-31 with results recorded;
- [ ] M-24 byte-identity reproduced on a real repository (not just sandboxes);
- [ ] Every deviation triaged into: bug (blocker for freeze), improvement
      (post-freeze), or documented limitation (added to §7);
- [ ] A short findings report appended to this document or linked from it.

---

# 9. Product Questions Manual Testing Should Answer

These are design confirmations only humans/dogfooding can give:

1. Does `status` really answer "can I continue this work?" in under ten
   seconds?
2. Is the Progress checklist wording (Plan/Verify/Test/Commit/Merge) clear
   about EXECUTING being omitted?
3. Are the failure messages actionable enough that a new engineer can fix the
   cause without reading these specs?
4. Does `verify`'s presence-based READY match what "ready" means to you — or
   does it need an explicit "evidence recorded ≠ work done" banner?
5. Is manual workflow adoption (file copying) acceptable until a future
   `workflow adopt` exists?

---

_Prepared from the repository state at commit `abc8f89`. Update the tables in
§1 and the coverage figures if phases land after this revision._
