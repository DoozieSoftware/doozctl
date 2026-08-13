# DoozCTL Plan Specification

**Version:** 1.0.0 (v2 Plan contract)
**Status:** Frozen — v2 Phase 2.1
**Part of:** [V2-SPEC.md](./V2-SPEC.md) · see [WORKFLOW-SPEC.md](./WORKFLOW-SPEC.md) for workflow methods

---

# What a Plan Is

A Plan is the **durable unit of engineering work** in DoozCTL v2.

It records:

- **intent** — what we are trying to accomplish and why
- **context** — what was known when the plan was made
- **scope** — what is and is not included
- **acceptance** — how we will know it is done
- **progress** — the steps taken and lifecycle state
- **evidence** — verification, tests, and the commit that satisfies the plan
- **decisions** — choices made and why
- **next action** — what to do next, so another agent or engineer can continue

A Plan is the answer to _"what are we trying to do?"_ It is not a conversation,
not a session, not current context, and not a repository analysis. Those are
separate concepts (see [V2-SPEC.md — Context Separation](./V2-SPEC.md)).

The primary handoff unit is:

```text
Agent A ends a session  →  plan + .dooz + repository  →  Agent B continues
```

---

# Location

Plans live under `.dooz/plans/`:

```text
.dooz/plans/
├── active/
│   └── YYYY-MM-DD-<id>.md
├── completed/
└── archive/
```

| Directory    | Contains                                               |
| ------------ | ------------------------------------------------------ |
| `active/`    | Plans being worked on (not yet terminal)               |
| `completed/` | Plans that reached `COMPLETED`                         |
| `archive/`   | Plans that reached `ABANDONED`, or were later archived |

A plan moves between directories only via a lifecycle transition. Plans are
**never deleted automatically** — a completed plan is engineering history.
Archiving happens only when needed to keep the tree compact.

---

# Identity

A plan has a **deterministic, human-readable id**:

```text
id: attendance-punch-sync
```

Rules:

- Lowercase kebab-case (`[a-z0-9]+(-[a-z0-9]+)*`).
- Unique among active plans.
- The filename is `YYYY-MM-DD-<id>.md` where the date is the creation date.
- A create that collides with an existing plan file fails with an explicit
  error; DoozCTL never guesses, never renames, and never overwrites.
- No random UUIDs. Human-readable repository state is part of the product.

The id is recorded in the plan's `Metadata` section (not only in the filename),
so a plan remains identifiable even if the file is moved.

---

# The Plan Format

A Plan is a **Markdown document**, not JSON, not YAML, not a database row.

Markdown is canonical because:

- humans and AI agents read and edit it with any tool
- it diffs cleanly in Git
- it needs no schema, migration, or query layer
- it can be rendered, searched, and reviewed as plain text

## Canonical Template

The section order below is frozen for v2. Do not invent a JSON schema for
plans, and do not create a database.

```markdown
# <Plan Title>

## Metadata

- id: <kebab-case-id>
- method: <workflow-method-id>
- status: <LIFECYCLE_STATE>
- created: <YYYY-MM-DD>

## Objective

...

## Context

...

## Scope

### In Scope

...

### Out of Scope

...

## Constraints

...

## Acceptance Criteria

- [ ] ...
- [ ] ...

## Plan

- [ ] ...
- [ ] ...

## Verification

...

## Test Evidence

...

## Decisions

...

## Known Limitations

...

## Commit

...

## Next Action

...
```

## Section Semantics

| Section               | Meaning                                              | Required |
| --------------------- | ---------------------------------------------------- | -------- |
| `Metadata`            | identity, method, lifecycle state, created date      | yes      |
| `Objective`           | the goal in a few sentences                          | yes      |
| `Context`             | facts known when the plan was made                   | yes*     |
| `Scope`               | in-scope / out-of-scope                              | yes*     |
| `Constraints`         | hard limits (platform, policy, safety, time)         | yes*     |
| `Acceptance Criteria` | checkbox list proving the objective is met           | yes*     |
| `Plan`                | checkbox list of implementation steps                | yes*     |
| `Verification`        | how the work was verified (commands + results)       | yes*     |
| `Test Evidence`       | test results, counts, failures observed              | yes*     |
| `Decisions`           | choices made and the reason                          | no       |
| `Known Limitations`   | what remains limited or unaddressed                  | no       |
| `Commit`              | commit reference(s) and branch that satisfy the plan | no       |
| `Next Action`         | the single next step for the executor                | no       |

\* Required **once work begins**. At creation only `Metadata` + `Objective` are
required; the rest may start empty and be filled as the work proceeds.

Every section may be empty when work has not started. A plan is never invalid
for being early in its lifecycle — it is invalid if its content contradicts its
lifecycle state (see [Validation](#validation)).

---

# Metadata

The `Metadata` section is the plan's identity block. Its four fields are the
only machine-parsed fields in v2:

```text
- id: attendance-punch-sync
- method: bug-fix
- status: PLANNED
- created: 2026-08-13
```

| Field     | Allowed values                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`      | kebab-case, unique among active plans                                                                                     |
| `method`  | a workflow-method id from the adopted set (see WORKFLOW-SPEC); a plan may also omit `method`, meaning "no adopted method" |
| `status`  | one of the lifecycle states below                                                                                         |
| `created` | `YYYY-MM-DD`                                                                                                              |

The metadata values are the only fields the plan engine parses on load.
Everything else is preserved verbatim and treated as human/AI-authored content.

---

# Lifecycle

## Canonical Lifecycle

The canonical v2 plan lifecycle is:

```text
PLANNED
   ↓
EXECUTING
   ↓
VERIFIED
   ↓
TESTED
   ↓
COMMITTED
   ↓
MERGED
   ↓
COMPLETED
```

**This is not a universal mandatory pipeline.** The lifecycle describes
evidence and state, not bureaucracy. Different workflow methods may require
different subsets (see WORKFLOW-SPEC).

## Workflow-Specific Subsets

```text
Investigation:   PLANNED → EXECUTING → VERIFIED → COMPLETED
Documentation:   PLANNED → EXECUTING → VERIFIED → COMMITTED → COMPLETED
Bug fix:         PLANNED → EXECUTING → VERIFIED → TESTED → COMMITTED → MERGED → COMPLETED
```

A method may skip states it does not require, but may never reverse the
canonical order. A plan's `method` determines which states are required; a
plan with no method uses the full canonical lifecycle.

## Terminal States

| State       | Meaning                                                    | Directory    |
| ----------- | ---------------------------------------------------------- | ------------ |
| `COMPLETED` | every acceptance criterion met, evidence recorded          | `completed/` |
| `ABANDONED` | superseded or dropped; recorded with a reason in Decisions | `archive/`   |

## Transition Rules

- A plan is **created** at `PLANNED` in `active/`.
- Lifecycle moves **forward only** along the canonical order.
- A transition may skip intermediate states when the workflow method allows it
  (e.g. `EXECUTING → VERIFIED` for an investigation that needs no test stage).
- `COMPLETED` requires the workflow method's completion criteria to be met and
  recorded in the plan (acceptance criteria all checked, required evidence
  present).
- `ABANDONED` requires a recorded reason under `Decisions`.
- A completed plan moves to `completed/`; an abandoned plan moves to `archive/`.
  The move is a rename of the same file — identity is preserved.
- Reopening a `COMPLETED` or `ABANDONED` plan is an explicit, human-approved
  action that returns it to `EXECUTING` in `active/` and records a Decision.
- No state transitions other than the above are valid.

---

# Evidence

Evidence is recorded **inside the plan** — there is no separate
`evidence.json` in v2.

- `Verification` — the exact commands run and their results (e.g.
  `PHPStan: passed`, `PHPUnit: 19 tests / 38 assertions`).
- `Test Evidence` — what was tested, counts, observed failures.
- `Commit` — the commit hash(es) and branch that satisfy the plan.

Evidence is recorded as **facts**, not prose opinions. DoozCTL never fabricates
evidence; the evidence is only as trustworthy as the executor that records it.
A later `doozctl verify` (Phase 2.6) will check whether the plan's declared
acceptance and evidence requirements are satisfied — it will not run the
project's tests.

---

# Plans and Git

A Plan is a lightweight engineering ledger, not a Git replacement:

```text
Plan
  ↓
implementation
  ↓
working tree
  ↓
verification
  ↓
commit            ← plan records the commit hash
  ↓
merge
  ↓
plan completed
```

Plans reference commits (hash + branch) in the `Commit` section. The plan file
itself lives in the repository and is committed like any other repository
state. DoozCTL stays Git-aware (branch, dirty state, commit) but never
manages Git.

---

# Validation

`doozctl plan validate` (later phase) checks:

- metadata is present and well-formed
- id is kebab-case
- status is a known lifecycle state
- lifecycle order is respected (no backwards jumps recorded in history)
- a plan marked `COMPLETED` has all acceptance criteria checked
- a plan marked `COMPLETED`/`ABANDONED` has the evidence the workflow method
  requires

Validation reports, it never repairs. DoozCTL never rewrites malformed plans.

---

# What a Plan Is Not

A Plan does **not** contain:

- conversation transcripts (those belong in `.ai/sessions/`)
- repository analysis or opinions (`.ai/repository-analysis.json`)
- present-time state (`.ai/current-context.md`)
- workflow definitions (`.dooz/workflows/`)
- full documentation or specs beyond what is needed to execute

Keep plans compact. A plan that cannot be read in seconds by a new agent is too
big.

---

# Scalability

Do not build a search engine for plans. Use the filesystem + Markdown. If 500
plans eventually make this painful, solve that problem then — not now.

Completed plans are never deleted automatically. They become engineering
history. Keep them compact.
