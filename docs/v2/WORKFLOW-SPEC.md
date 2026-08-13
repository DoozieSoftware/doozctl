# DoozCTL Workflow Specification

**Version:** 1.0.0 (v2 Workflow contract)
**Status:** Frozen — v2 Phase 2.1
**Part of:** [V2-SPEC.md](./V2-SPEC.md) · see [PLAN-SPEC.md](./PLAN-SPEC.md) for the Plan contract

---

# What a Workflow Method Is

A **workflow method** is a Markdown document that describes how a particular
kind of engineering work should be carried out: which stages to follow, which
evidence to produce, what counts as done, and where a human must approve.

A workflow method is **optional**. Repositories adopt the methods they want.
The Plan is the unit of work; the method attached to a Plan tells the executor
_how_ to run that Plan (see [PLAN-SPEC.md — Metadata](./PLAN-SPEC.md)).

---

# Method Contract

Every workflow method is a Markdown document with the following structure. The
section names are frozen. This is a **contract, not a DSL**: no YAML, no
scripting, no policy language, no execution engine.

```markdown
# <Method Name>

## Metadata

- id: <method-id>

## Purpose

One paragraph: what this method is for.

## When to Use

When this method applies (and when it does not).

## Inputs

What the method requires before it starts (e.g. a confirmed defect, a ticket, a goal).

## Stages

Numbered stages the work passes through.

## Required Evidence

The evidence that must exist for the Plan to be considered done.

## Completion Criteria

Checklist of criteria the Plan must meet to be COMPLETED.

## Human Approval Points

Where a human must approve before the work proceeds (or "None").

## Artifacts Produced

What the method produces (code, tests, docs, commits, plan sections updated).
```

### Method contract rules

1. A method may define its own lifecycle subset (which of
   `PLANNED → EXECUTING → VERIFIED → TESTED → COMMITTED → MERGED → COMPLETED`
   it requires). It may **skip** states; it may **never reorder** them.
2. The lifecycle describes evidence and state, not bureaucracy. A method must
   be able to **scale down**: a tiny bug fix still works with the same method
   as a major ERP change, just with less ceremony.
3. A method must define its **minimum evidence**, not a ceremony. Required
   evidence is the floor, never the ceiling.
4. A method may define **Human Approval Points**. Required approvals are
   mandatory; project customization may not remove them.

---

# Workflow Methods Are Markdown Assets

Workflow methods are shipped as Markdown files by the Standards Package and
adopted into a repository:

```text
standards/                     (a DoozieSoft Standards Package)
├── workflows/
│   ├── standard.md
│   ├── feature.md
│   ├── bug-fix.md
│   ├── triage.md
│   └── investigation.md
```

DoozCTL itself does not know these names. The package declares them. The
engine treats them as opaque Markdown assets. There is no workflow schema, no
JSON declaration file, and no workflow registry in v2.0.

---

# Adoption

A repository declares which workflow methods it adopts by copying them into its
own control plane:

```text
.dooz/workflows/
├── adopted/        adopted methods (from a Standards Package)
└── project/        project-specific methods (written by the project)
```

- **Adopted**: present in `.dooz/workflows/adopted/`.
- **Not adopted**: absent.
- **Project-specific**: present in `.dooz/workflows/project/`.

A project may adopt only the methods it needs:

```text
.dooz/workflows/adopted/
├── feature.md
├── bug-fix.md
└── investigation.md
```

Another project:

```text
.dooz/workflows/adopted/
└── standard.md
```

A project may also add:

```text
.dooz/workflows/project/
└── client-release.md
```

A Plan's `method` field refers to an adopted method id. If a plan names a
method that is not adopted, the plan is still valid (workflows are optional) —
the executor simply follows the canonical lifecycle with no method-specific
requirements.

---

# Override Hierarchy

When multiple sources of guidance apply, they compose as follows:

```text
DoozieSoft mandatory policy
        ↓
Technology overlay
        ↓
Workflow method
        ↓
Project workflow extension
```

**Lower levels may:**

- add requirements
- specialize a workflow
- add steps
- add evidence
- add project-specific workflows

**Lower levels may NOT:**

- weaken security
- remove human approval requirements
- remove required verification
- bypass client-data rules
- contradict mandatory company policy
- weaken repository safety

This is **extension, not inheritance**. There is no override engine, no
multi-level merge machinery, and no policy programming language. A project
extension is an additional Markdown document, nothing more.

---

# Initial Methods

The first implementation milestone defines five minimal methods. They exist to
demonstrate the contract — they are deliberately small, not manuals.

## standard

```markdown
# Standard

## Metadata

- id: standard

## Purpose

General-purpose method for everyday engineering work with no specialized method.

## When to Use

Default. Use when no specialized method (feature, bug-fix, investigation, ...) applies.

## Inputs

A goal. Optionally a ticket or issue reference.

## Stages

PLANNED → EXECUTING → VERIFIED → TESTED → COMMITTED → MERGED → COMPLETED

## Required Evidence

- Verification result
- Test result (when tests exist)

## Completion Criteria

- [ ] Acceptance criteria met
- [ ] Required evidence recorded

## Human Approval Points

- None required (a human may always approve early)

## Artifacts Produced

Code, tests, verification notes, a commit.
```

## feature

```markdown
# Feature

## Metadata

- id: feature

## Purpose

Build a new capability from a clear goal.

## When to Use

A feature request, story, or requirement. Not for bug fixes.

## Inputs

A goal, optionally a ticket. Scope should be clarified before execution.

## Stages

PLANNED → EXECUTING → VERIFIED → TESTED → COMMITTED → MERGED → COMPLETED

## Required Evidence

- Verification result
- Test evidence (tests written or explicitly N/A with reason)
- Commit reference

## Completion Criteria

- [ ] Acceptance criteria met
- [ ] In-scope work done, out-of-scope unchanged
- [ ] Required evidence recorded
- [ ] Human approval where required

## Human Approval Points

- Production / irreversible actions
- Scope changes that expand the plan

## Artifacts Produced

Code, tests, verification notes, a commit.
```

## bug-fix

```markdown
# Bug-Fix

## Metadata

- id: bug-fix

## Purpose

Resolve a confirmed defect.

## When to Use

A confirmed, reproducible defect. Not for new features.

## Inputs

A confirmed defect. Optionally a reproduction.

## Stages

PLANNED → EXECUTING → VERIFIED → TESTED → COMMITTED → MERGED → COMPLETED

## Required Evidence

- Reproduction (when reproducible)
- Root cause
- Regression test
- Verification result

## Completion Criteria

- [ ] Defect reproduced or confirmed
- [ ] Root cause identified
- [ ] Fix implemented
- [ ] Regression test added
- [ ] Verification result recorded

## Human Approval Points

- Production / irreversible actions

## Artifacts Produced

A minimal fix, a regression test, verification notes, a commit.
```

## triage

```markdown
# Triage

## Metadata

- id: triage

## Purpose

Quickly classify an incoming report or issue and decide next steps.

## When to Use

Incoming issues, bug reports, or requests that need classification before work.

## Inputs

A report, issue, or request.

## Stages

PLANNED → EXECUTING → VERIFIED → COMPLETED

## Required Evidence

- Classification (type, priority, owner)

## Completion Criteria

- [ ] Report understood
- [ ] Classification recorded
- [ ] Next action assigned

## Human Approval Points

- Escalation of critical / production issues

## Artifacts Produced

A classified issue, a next action, and a decision. No commit required.
```

## investigation

```markdown
# Investigation

## Metadata

- id: investigation

## Purpose

Answer a question or understand a system without necessarily changing code.

## When to Use

Research, root-cause discovery, feasibility, or unknowns that must be
understood before a feature or bug-fix.

## Inputs

A question to answer.

## Stages

PLANNED → EXECUTING → VERIFIED → COMPLETED

## Required Evidence

- Findings
- A recommendation or decision (when applicable)

## Completion Criteria

- [ ] Question answered
- [ ] Findings recorded
- [ ] Next action recorded

## Human Approval Points

- None required

## Artifacts Produced

Findings, a decision, and a next action. No commit required.
```

---

# Methods Defined Later

The following methods are designed for, but not implemented in the first
milestone: `refactor`, `documentation`, `greenfield`, `hotfix`. They will be
derived from real use after the first five are dogfooded.

---

# Methods and AGENTS.md

Workflow definitions do **not** belong in `AGENTS.md`. AGENTS.md is the hot AI
context and stays small; it only tells an agent how to _discover_ the control
plane (see [V2-SPEC.md — Context Separation](./V2-SPEC.md)). Workflow methods
live in `.dooz/workflows/` and are read on demand.

---

# What a Workflow Method Is Not

A workflow method is not:

- an enforcement engine (DoozCTL records and validates; it does not police)
- a scripting language or DSL (no YAML steps, no runner)
- a policy hierarchy with inheritance
- a mandatory sequence for every plan
