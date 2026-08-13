# DoozCTL v2 Architecture

**Version:** 2.0.0-contract
**Status:** Frozen for v2 Phase 2.1 (intended structure; no implementation yet)
**Part of:** [V2-SPEC.md](./V2-SPEC.md) · [PLAN-SPEC.md](./PLAN-SPEC.md) · [WORKFLOW-SPEC.md](./WORKFLOW-SPEC.md)

---

# Overview

v2 does not replace the v1 engine. It adds an **optional Engineering Control
Plane** on top of the frozen v1 Repository Standards Engine. The executor — a
human or an external AI agent (Claude, Codex, OpenCode, ..., any tool) — is
outside DoozCTL.

```text
                         DOOZCTL 2.0
                              │
        ┌─────────────────────┼──────────────────────┐
        │                     │                      │
   Standards             Repository              Workflow
   Package                State                    Layer
        │                     │                      │
        ▼                     ▼                      ▼
   AGENTS.md              .dooz/                 Methods
   overlays               plans                   Plans
   policies               memory                  Evidence
                          sessions                Lifecycle
                              │                      │
                              └──────────┬───────────┘
                                         ▼
                              Human / AI Executor
                                         │
                                         ▼
                                   Git / Repository
```

The v2 control plane is a **durable, layer of repository-local intent,
context, workflow and evidence** shared by engineers and interchangeable AI
agents. It records and validates; it never executes engineering work.

---

# Architecture Principle

**DoozCTL records and validates engineering intent and evidence; it does not
perform the engineering work itself.**

Two consequences:

1. The **executor is a consumer** of the control plane. It reads plans and
   adopted workflows, does the work, and writes evidence back into plans.
   DoozCTL never routes, drives, or orchestrates the executor.
2. There is **no `execute` command** in v2.0. The engine stops at plan +
   context + evidence.

---

# Relationship to v1

v1 is FROZEN and remains independently maintainable on `release/v1`:

- merge semantics
- artifact model
- standards package semantics
- v1 safety invariants
- v1 CLI behavior
- v1 architecture

v2 is **additive**. It reuses v1's existing primitives (see below) and adds
Plan and Workflow state under `.dooz/`. If a v2 capability ever requires
changing frozen v1 behavior, development **stops** and the conflict is
reported (`V1 CONFLICT` + reason + evidence + proposed solution) before
anything ships.

The v1 `.ai/` memory tree (`.ai/repository-analysis.json`,
`.ai/current-context.md`, `.ai/sessions/`) is untouched by v2 in this
milestone. Migration of memory under `.dooz/` is a later explicit contract.

---

# Repository Layout

The v2 control plane lives in the repository under `.dooz/` and reuses the
existing v1 memory under `.ai/`:

```text
.dooz/
├── manifest.json               engine state (v1, unchanged)
├── plans/
│   ├── active/                 plans in progress (PLANNED … MERGED)
│   ├── completed/              COMPLETED plans
│   └── archive/                ABANDONED / archived plans
└── workflows/
    ├── adopted/                adopted workflow methods (opaque Markdown)
    └── project/                project-specific workflow methods

.ai/                            v1 memory, unchanged for now
├── repository-analysis.json
├── current-context.md
└── sessions/
```

`.dooz/plans/` and `.dooz/workflows/` are **user-facing repository state**
owned by engineer + AI; they are committed to Git like source. DoozCTL
validates and writes them via the existing sandboxed `Storage`, but their
content meaning lives with the workflow, not the engine.

---

# Layering

v2 follows the same downward-pointing-dependency layering as v1. The existing
layers are extended, not replaced:

```text
CLI            — argument parsing, exit codes            (src/cli)          v1
Dispatcher     — command routing                         (src/dispatcher)   v1
Application    — use cases per command, own pipeline     (src/app)          v1 + plan/verify uses
Steps          — pipeline step factories                 (src/engine)       v1 + plan steps
Engine         — ordered step execution                  (src/engine)       v1
Contracts      — extension seams (analyzer, loader,
                 merger, validator)                      (src/engine)       v1 + plan contract
Model          — frozen domain types                     (src/model)        v1 + Plan types
Infra          — git service                             (src/infra)        v1
Store          — sandboxed storage, json, repository state (src/store)      v1 + plan store
```

v2 adds no new layer. Plan and workflow handling are use cases and steps
inside the existing pipeline pattern. The app layer holds no infra knowledge;
steps receive infra via constructor injection, exactly as v1 does.

---

# The v2 Data Flow

```text
doozctl plan --method bug-fix --title "attendance punch sync"
        │
        ▼
App (create-plan use case)
        │
        ▼
Model (Plan) + Store (write .dooz/plans/active/…)     ← pure state ops
        │
        ▼
Executor (human / AI agent) reads plan, works, records evidence
        │
        ▼
doozctl status / verify   → validates evidence against the plan contract
```

Plan operations are **pure state operations**: create, load, validate, update,
transition lifecycle, move `active → completed`. They use existing primitives
(`Storage`, JSON utilities, the pipeline/step pattern). No database, no new
abstraction beyond what the use cases actually need.

---

# Plan Model (target)

The Plan is the primary v2 domain object (fully specified in
[PLAN-SPEC.md](./PLAN-SPEC.md)). Its shape is Markdown, not a class to be
invented:

- A plan is a Markdown file at `.dooz/plans/<state>/YYYY-MM-DD-<id>.md`.
- Only four metadata fields are machine-parsed: `id`, `method`, `status`,
  `created`.
- Everything else is opaque human/AI-authored content preserved verbatim.
- Lifecycle transitions are forward-only moves along a canonical sequence,
  with workflow-influenced subsets.

The engine treats a Plan as **opaque Markdown with four parsed metadata lines**.
The parse surface must stay that small.

---

# Workflow Layer (target)

Workflow methods are **opaque Markdown assets** (specified in
[WORKFLOW-SPEC.md](./WORKFLOW-SPEC.md)):

- Adopted methods live under `.dooz/workflows/adopted/`; project methods under
  `.dooz/workflows/project/`.
- The engine does not parse method bodies in v2.0. It reads only the method
  id referenced by a plan's metadata.
- Adoption is a file-level existence check: a method is adopted iff its
  document is present. No registry, no inheritance engine, no policy
  evaluation machinery.

---

# Commands in v2

```text
CORE  (v1, unchanged)     init · sync · analyze · summarize · doctor · status
WORK  (v2, new)           plan
FUTURE (not in v2.0)      plan list/show/validate · verify · workflow*
NEVER  (v2.0)             execute
```

`plan` (Phase 2.3) and `verify` (Phase 2.6) are new **use cases** implemented
on the existing pipeline. `status` gains a control-plane view (Phase 2.5):
repository facts + active plan + workflow + lifecycle + next action.

---

# Reused v1 Primitives

| v2 concern                       | Reused v1 primitive                                 |
| -------------------------------- | --------------------------------------------------- |
| Sandboxed repo access            | `Storage` (`src/store/storage.ts`)                  |
| Atomic, idempotent writes        | `Storage.atomicWrite`                               |
| JSON state where required        | `parseJson` / `serializeJson` (`src/store/json.ts`) |
| Repository state access          | `RepositoryStore` pattern (`src/store/`)            |
| Command routing                  | `Dispatcher` + exit codes (`src/dispatcher/`)       |
| Per-command use cases            | App services (`src/app/app.ts`)                     |
| Ordered, short-circuit execution | `Engine` + `pipeline steps` (`src/engine/`)         |
| Git facts for plans/status       | `GitService` (`src/infra/git/`)                     |
| Domain types                     | Model layer (`src/model/`)                          |

No new infrastructure is required by the Plan contract. Files, Markdown and
the existing pipeline are sufficient.

---

# Plan/Workflow Storage (target)

The plan store will sit behind the existing `Storage` abstraction:

- reads: `Storage.root` confined to the repository
- writes: `atomicWrite` (temp + rename), so a crash never leaves a partial plan
- determinism: identical input → identical output, no timestamp churn on
  unchanged state (byte-identical writes skipped)

A `plan` command writes plan files exactly like v1 persists manifest/analysis
state — atomic, sandboxed, deterministic. Malformed plans are never repaired,
only reported.

---

# Verification (target)

`doozctl verify` (Phase 2.6) answers one question, against the plan contract:

> Does the repository contain sufficient evidence to consider this plan
> verified/completed according to its adopted workflow?

It checks plan metadata, lifecycle order, acceptance criteria and required
evidence. It does **not** run tests, does not know the project's build, and
does not become a test runner. The workflow method may state which evidence
commands to record — but verification is evidence validation, not execution.

---

# Status 2.0 View (target)

`doozctl status` becomes a control-plane view, not a task tracker:

```text
Repository
  Laravel 13
  Branch: feature/attendance
  Git: clean

Active Work
  attendance-punch-sync
  Method: bug-fix
  Status: EXECUTING

Progress
  Plan     ✓   Implement  ✓   Verify  ✓   Test  ✓
  Commit   ✗   Merge      ✗

Next action
  Review diff and create commit
```

This is derived from `analysis` + the active plan's metadata — still
deterministic, still read-only.

---

# Minimalism

v2.0 deliberately ships **no** new infrastructure: no database, no vector
store, no model routing, no plugin system, no workflow DSL, no policy engine,
no `execute`, no plan server. Every capability maps onto Markdown + existing
primitives.

The implementation order (Phase 2.2 onward) follows the contracts frozen here,
one capability per commit, stopping after: implement → verify → test → commit
→ report.
