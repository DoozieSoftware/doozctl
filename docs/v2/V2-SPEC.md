# DoozCTL v2 Specification

**Version:** 2.0.0-contract
**Status:** Frozen for v2 Phase 2.1 (control-plane contracts)
**Companion docs:** [PLAN-SPEC.md](./PLAN-SPEC.md) · [WORKFLOW-SPEC.md](./WORKFLOW-SPEC.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)

---

# Vision

DoozCTL 2.0 evolves v1 into a **repository-local Engineering Control Plane** for
humans and AI agents.

v1 remains the generic, vendor-neutral Repository Standards Engine: it renders,
installs, updates and validates repository artifacts supplied by an external
Standards Package. That engine is **frozen** and stays independently
maintainable.

v2 adds an **optional** control plane on top: repository-local intent, context,
workflow and evidence that any engineer or AI agent can read and continue from.

> **Conversations are ephemeral. Engineering intent, evidence and decisions
> should live with the repository.**

The repository should carry enough information for:

```text
Human A
   ↓
AI A
   ↓
commit
   ↓
AI B
   ↓
Human B
```

to continue engineering **without** the previous conversation.

---

# Philosophy

Everything in v1 plus:

- Intent and evidence live with the repository, not the conversation.
- Standards may be mandatory; **workflow methods are optional and adopted per
  repository**.
- Markdown is the canonical representation for intent, workflow and evidence.
- The engine records and validates; it never executes engineering work.
- Minimal state is a feature. Add a file, field or abstraction only when a
  frozen requirement demands it.

---

# Architectural Boundary

DoozCTL does **not**:

- perform the engineering work itself
- become an AI agent
- replace Git, Redmine or Phoenix
- enforce one methodology everywhere
- integrate with, route or orchestrate models
- execute autonomous coding

The **executor is outside DoozCTL**. Claude, Codex, OpenCode and other coding
agents are external tools that read the control plane, do the engineering work
in the repository, and leave evidence back in the control plane.

```text
Standards + Repository facts + Memory + Plans + Optional workflows + Evidence + Lifecycle state
                                     │
                                     ▼
                          Human / AI Executor (external)
                                     │
                                     ▼
                                  Git / Repository
```

There is **no `doozctl execute`** in this milestone or in v2.0. `execute`
immediately invites agent adapters, tool routing, permission systems, model
routing, retry logic and autonomous coding — an entirely different product.

---

# The v2 Model

The control plane combines seven durable layers:

```text
Standards                    →  AGENTS.md, overlays, policies   (from Standards Package)
Repository facts             →  .ai/repository-analysis.json    (machine-generated)
Repository memory            →  .ai/current-context.md, sessions
Plans                        →  .dooz/plans/                    (engineering intent)
Optional workflow methods    →  .dooz/workflows/                (adopted methods)
Evidence                     →  plan verification/test evidence, git references
Lifecycle state              →  plan lifecycle, git state
```

---

# The Control Plane

## Target layout

`.dooz/` becomes the single repository control plane:

```text
.dooz/
├── manifest.json
├── repository-analysis.json
├── current-context.md
├── sessions/
│   ├── INDEX.md
│   └── YYYY-MM-DD_HHMM.md
├── plans/
│   ├── active/
│   ├── completed/
│   └── archive/
└── workflows/
    ├── adopted/
    └── project/
```

Do **not** create `.dooz/config.json`, `.dooz/database.json`, `.dooz/cache/`,
`.dooz/agents/` or plugin infrastructure unless a later frozen contract
requires them.

## v1 `.ai/` memory is preserved for now

This milestone does **not** migrate or delete the v1 `.ai/` memory tree.

- `.ai/repository-analysis.json`, `.ai/current-context.md` and `.ai/sessions/`
  stay exactly where v1 puts them and keep v1 behavior.
- v2 is **additive**: it introduces `.dooz/plans/` and `.dooz/workflows/`.
- Re-homing memory under `.dooz/` is a **separate, later, explicit migration
  contract** and is a candidate `V1 CONFLICT` — it must preserve v1 reads and
  be idempotent and safe before it ships.

The target layout above is the destination state, not today's state.

## Ownership model

| Asset                          | Owner                       | Notes                                 |
| ------------------------------ | --------------------------- | ------------------------------------- |
| `.dooz/manifest.json`          | DoozCTL                     | engine state (v1)                     |
| `.ai/repository-analysis.json` | DoozCTL                     | machine facts (v1, memory root today) |
| `.ai/current-context.md`       | Engineering / AI workflow   | authored content, engine writes       |
| `.ai/sessions/`                | Engineering / AI workflow   | authored content, engine appends      |
| `.dooz/plans/`                 | Engineer + AI               | intent + evidence, engine validates   |
| `.dooz/workflows/`             | Standards Package / project | adopted method assets                 |
| `AGENTS.md`                    | Standards Package           | hot AI context                        |
| Source code                    | Project                     |                                       |
| Git history                    | Git                         |                                       |

DoozCTL does not imply every `.dooz` file is immutable engine state. Content
ownership belongs to the workflow; the engine manages writes and validation.

---

# Context Separation

These concepts stay distinct and **must not collapse into one document**:

| Concept       | Where                          | Answers                        |
| ------------- | ------------------------------ | ------------------------------ |
| Rules         | `AGENTS.md`                    | "What are the stable rules?"   |
| Facts         | `.ai/repository-analysis.json` | "What is this repository?"     |
| Present state | `.ai/current-context.md`       | "What are we doing right now?" |
| History       | `.ai/sessions/`                | "What happened before?"        |
| Intent        | `.dooz/plans/`                 | "What are we trying to do?"    |
| Methods       | `.dooz/workflows/`             | "Which workflow do we follow?" |

- A **Plan** is intent.
- **Current context** is present state.
- **Sessions** are historical handover.
- **Repository analysis** is deterministic facts (no opinions, no plans, no
  conversations, no task state).

---

# Standards / Plans / Evidence

Three concepts are deliberately separated:

## A. Standards — "what rules should we follow?"

```text
AGENTS.md
overlays/
policies/
```

## B. Plans — "what are we trying to accomplish?"

```text
.dooz/plans/
```

## C. Evidence — "what actually happened?"

```text
plan lifecycle state
verification
tests
commits
handover
```

These are not one giant state document. A Plan is the primary v2 domain object
(see [PLAN-SPEC.md](./PLAN-SPEC.md)); evidence lives inside the plan itself,
initially — no separate `evidence.json`.

---

# Command Surface

v1 (unchanged):

```text
init · sync · analyze · summarize · doctor · status
```

v2 initially adds:

```text
plan
plan --method <method> --title <title>
```

Later, only if proven necessary:

```text
plan list · plan show · plan validate
verify            → evidence/acceptance validation (NOT a test runner)
workflow (future) → workflow list · workflow adopt · workflow status
```

Explicitly **not** in v2.0:

```text
execute · agent integrations · model routing
```

`doozctl plan` is implemented in Phase 2.3; `verify` in Phase 2.6. Their
contracts are frozen here, their implementation is not.

---

# Explicitly NOT Built in v2

```text
NO
├── AI model integration
├── model routing
├── autonomous coding
├── plugin marketplace
├── remote plan server
├── cloud synchronization
├── task tracker replacement
├── Redmine/Phoenix integration
├── GitHub project replacement
├── workflow inheritance engine
├── YAML workflow DSL
├── workflow scripting language
├── database
├── vector database
├── LLM evaluation engine
├── agent registry
├── complex policy engine
└── doozctl execute
```

If a change requires any of these, stop and return to the spec.

---

# v2 Invariants

These three sentences prevent most future architecture drift:

> **DoozCTL records and validates engineering intent and evidence; it does not
> perform the engineering work itself.**

> **Workflows are optional. Standards may be mandatory; workflow methods are
> adopted per repository or project.**

> **Project customization may extend adopted workflows but may not weaken
> mandatory safety or engineering policy.**

---

# Success Criteria

DoozCTL v2 succeeds when:

### Handoff

Agent B can continue Agent A's work from `plan + .dooz + repository` without
conversation transfer.

### Planning

An engineer can understand the intended change without reading the
conversation.

### Verification

The repository demonstrates why a plan is considered complete.

### History

Months later, someone can reconstruct `why / what / how / evidence / decision /
commit` without Slack, Redmine or AI transcripts.

### Minimalism

`.dooz/` stays small enough for an AI to understand in seconds.

---

# v1 Protection

The v1 engine is frozen:

- merge semantics
- artifact model
- standards package semantics
- v1 safety invariants
- v1 CLI behavior
- v1 architecture

If v2 requires a change to v1 behavior, **STOP** and report:

```text
V1 CONFLICT
Reason
Evidence
Proposed solution
```

Do not silently change the frozen engine. v1 fixes belong on `release/v1`.

---

# Phase Order

> **Closure note (2026-08-21):** v2 development closed at **2.0.0-rc.1** after
> Phase 2.10. In this roadmap, 2.1–2.6 shipped as phases 2.1–2.6; the
> verification work landed as 2.7–2.10 (validation, `verify`, test-fact
> visibility, path-bound changelog/version). The rows below marked _deferred_
> are consciously postponed — see `docs/release/V2-CLOSE-OUT.md`. Promotion
> to final 2.0.0 is gated on manual testing
> (`docs/v2/V2-MANUAL-TESTING.md`).

| Phase | Deliverable                            | Gate                                         |
| ----- | -------------------------------------- | -------------------------------------------- |
| 2.1   | Freeze contracts (this doc)            | documents agree                              |
| 2.2   | Plan domain model (phase 2.2 contract) | create/load/validate/update/transition       |
| 2.3   | `doozctl plan` CLI                     | plan + plan --method                         |
| 2.4   | Workflow assets + adoption             | five methods                                 |
| 2.5   | Status 2.0                             | active plan/workflow                         |
| 2.6   | Evidence contract + verify             | evidence validation                          |
| 2.7   | AGENTS.md guidance                     | hot context tiny — _deferred_                |
| 2.8   | Dogfood on DoozieSoft repos            | — _deferred → manual testing_                |
| 2.9   | Cross-agent handoff                    | Claude ↔ Codex ↔ OpenCode — _deferred_       |
| 2.10  | Red team v2                            | corruption, staleness, conflict — _deferred_ |
| 2.11  | Release candidate                      | `v2.0.0-rc.1` — ✅ cut at close              |

Each phase implements → verifies → tests → commits → stops for approval.

---

# Contract Documents

These four documents must agree with each other and with v1:

| Document           | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| `V2-SPEC.md`       | scope, boundaries, invariants (this document)    |
| `PLAN-SPEC.md`     | the frozen Plan contract — the v2 fulcrum        |
| `WORKFLOW-SPEC.md` | the workflow-method contract and initial methods |
| `ARCHITECTURE.md`  | how v2 maps onto the frozen v1 architecture      |

---

# Minimalism Rule

Before creating a new class, interface, schema, registry, service,
configuration file or abstraction, ask:

> "Can this be implemented using the existing primitives?"

Prefer Markdown + existing `Storage` + existing JSON utilities + existing
pipeline/command patterns over new infrastructure. No speculative
abstractions.

---

# Testing

Every v2 capability ships with:

- unit tests
- integration tests where appropriate
- deterministic output tests
- malformed-input tests
- idempotency tests where state is persisted
- safety tests for repository writes

All existing v1 tests must remain green. No v2 milestone may weaken the
existing coverage gate.

---

# Git Discipline

One capability = one commit. Conventional commits. Do not mix v1 fixes, v2
architecture, v2 implementation and unrelated documentation. Each milestone
stops after: implement → verify → test → commit → report.
