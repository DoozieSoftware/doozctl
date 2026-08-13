/**
 * Workflow method assets for DoozCTL v2.
 *
 * WORKFLOW-SPEC.md freezes the five initial methods and defines `standard` as
 * the default ("## When to Use — Default."). Phase 2.3 supplies plan methods
 * from that contract; per-repository adoption under `.dooz/workflows/` is a
 * later phase and is NOT built here.
 *
 * The engine reads only each method's id from its Metadata section — the same
 * parse surface the Plan contract uses. Method bodies are opaque Markdown and
 * are preserved verbatim; nothing here is engine business logic. There is no
 * registry, JSON declaration file, or discovery mechanism beyond these frozen
 * contract assets.
 */

/** A workflow method asset: its id and opaque Markdown body. */
export interface WorkflowMethod {
  readonly id: string;
  readonly content: string;
}

/**
 * The default plan method, per WORKFLOW-SPEC.md: `standard` "When to Use —
 * Default. Use when no specialized method applies."
 */
export const DEFAULT_METHOD = "standard";

/**
 * The five initial methods, verbatim from WORKFLOW-SPEC.md §Initial Methods.
 * Keyed by id so a missing asset is indistinguishable from an unknown id.
 */
const METHOD_CONTENT: Readonly<Record<string, string>> = {
  standard: `# Standard

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

Code, tests, verification notes, a commit.`,

  feature: `# Feature

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

Code, tests, verification notes, a commit.`,

  "bug-fix": `# Bug-Fix

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

A minimal fix, a regression test, verification notes, a commit.`,

  triage: `# Triage

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

A classified issue, a next action, and a decision. No commit required.`,

  investigation: `# Investigation

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

Findings, a decision, and a next action. No commit required.`,
};

/** The available method ids, sorted for deterministic output. */
export function listWorkflowMethodIds(): string[] {
  return Object.keys(METHOD_CONTENT).sort();
}

/**
 * Resolve a method id to its asset, validating the asset against the frozen
 * contract: the document must exist, have a `## Metadata` section, and carry a
 * non-empty `- id:` that matches the requested id. A missing asset and a
 * malformed asset fail loudly; the engine never guesses.
 */
export function resolveWorkflowMethod(
  id: string,
  assets: Readonly<Record<string, string>> = METHOD_CONTENT,
): WorkflowMethod {
  const content = assets[id];
  if (content === undefined) {
    throw new Error(`workflow method not found: ${id}`);
  }
  const declared = parseWorkflowMethodId(content);
  if (declared === undefined || declared !== id) {
    throw new Error(`workflow method asset is malformed: ${id}`);
  }
  return { id, content };
}

/** The `- id:` value inside the `## Metadata` section, if present. */
function parseWorkflowMethodId(content: string): string | undefined {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const metaIndex = lines.findIndex((line) => /^##\s+Metadata\s*$/.test(line));
  if (metaIndex === -1) {
    return undefined;
  }
  for (let i = metaIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (/^##\s/.test(line)) {
      break;
    }
    const match = /^-\s*id:\s*(.*?)\s*$/.exec(line);
    if (match !== null) {
      return (match[1] ?? "").trim();
    }
  }
  return undefined;
}
