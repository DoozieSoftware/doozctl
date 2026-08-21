import type { Analysis, Manifest } from "../model/model.js";
import {
  PLAN_LIFECYCLE,
  extractNextAction,
  nextPlanStatus,
  parsePlan,
  planIdFromFilename,
  planSection,
  type Plan,
  type PlanAnyStatus,
  type PlanStatus,
} from "../model/plan.js";
import type { PlanStore } from "../store/plan-store.js";
import { Storage } from "../store/storage.js";
import { resolveAdoptedWorkflow } from "../workflows/adoption.js";
import {
  parseEvidenceRequirements,
  type EvidenceCategory,
  type EvidenceRequirement,
} from "../workflows/evidence.js";
import type { ExecutionContext } from "./engine.js";
import { validateManagedBlocks } from "./merge.js";

/**
 * Report builders for the read-only commands.
 *
 * status reports what DoozCTL understands about the repository and its control
 * plane (v2). doctor validates the repository's health and reports problems.
 * Both produce plain text only — no formatting state, no opinions.
 */

const check = (ok: boolean, label: string): string => `${ok ? "✓" : "✗"} ${label}`;

function describeGit(analysis: Analysis | null): string {
  const git = analysis?.git;
  if (git === undefined || !git.isRepository) {
    return "Git: not a repository";
  }
  const state = git.dirty ? "uncommitted changes" : "clean";
  const branch = git.branch === null ? "detached HEAD" : git.branch;
  return `Git: ${branch} (${state})`;
}

/** A command report: the deterministic text plus the problems that gate the exit code. */
export interface CommandReport {
  report: string;
  problems: string[];
}

/**
 * The progress checklist stages and their lifecycle state, in display order.
 * EXECUTING (in progress) and COMPLETED (terminal) are not checklist items.
 */
const PROGRESS_STAGES: ReadonlyArray<{ label: string; status: PlanStatus }> = [
  { label: "Plan", status: "PLANNED" },
  { label: "Verify", status: "VERIFIED" },
  { label: "Test", status: "TESTED" },
  { label: "Commit", status: "COMMITTED" },
  { label: "Merge", status: "MERGED" },
];

/** Whether a plan's current status has reached the given canonical state. */
function stageReached(status: PlanAnyStatus, stage: PlanStatus): boolean {
  if (!PLAN_LIFECYCLE.includes(status as PlanStatus)) {
    return false;
  }
  return PLAN_LIFECYCLE.indexOf(status as PlanStatus) >= PLAN_LIFECYCLE.indexOf(stage);
}

/**
 * The repository's detected test facts ("vitest · 12 test files"), or null
 * when none are detected. Purely descriptive: the engine never judges whether
 * the tests are sufficient — it juxtaposes facts with recorded evidence.
 */
function describeTestFacts(analysis: Analysis): string | null {
  const parts: string[] = [];
  if (analysis.testFramework !== null) {
    parts.push(analysis.testFramework);
  }
  if (analysis.statistics.testFiles > 0) {
    const n = analysis.statistics.testFiles;
    parts.push(`${n} test ${n === 1 ? "file" : "files"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Status 2.0: a concise, read-only view of the repository and its v2 control
 * plane — repository facts, initialization, the active plan, its workflow,
 * lifecycle progress and the next action. Never writes.
 */
export async function buildStatusReport(
  root: string,
  analysis: Analysis,
  manifest: Manifest,
  planStore: PlanStore,
): Promise<CommandReport> {
  const problems: string[] = [];
  const lines: string[] = ["DoozCTL Status", ""];

  lines.push("Repository");
  lines.push(`  Path: ${analysis.root}`);
  if (analysis.git.isRepository) {
    lines.push(`  Branch: ${analysis.git.branch ?? "detached HEAD"}`);
  }
  lines.push(
    `  Git: ${analysis.git.isRepository ? (analysis.git.dirty ? "dirty" : "clean") : "not a repository"}`,
  );
  if (analysis.languages.length > 0) {
    lines.push(`  Languages: ${analysis.languages.join(", ")}`);
  }
  const testFacts = describeTestFacts(analysis);
  if (testFacts !== null) {
    lines.push(`  Tests: ${testFacts}`);
  }

  lines.push("", "Control Plane");
  lines.push("  Initialized: yes");
  lines.push(`  Artifacts: ${manifest.artifacts.length}`);

  let planFiles: string[];
  try {
    planFiles = await planStore.list(root, "active");
  } catch (error) {
    problems.push(`cannot read active plans: ${messageOf(error)}`);
    lines.push("", "Active Plan", "  Unavailable.");
    return { report: lines.join("\n"), problems };
  }

  if (planFiles.length === 0) {
    lines.push("", "Active Plan", "  None", "", "Next Action");
    lines.push("  Create a plan with:", "    doozctl plan --method <adopted-method>");
  } else if (planFiles.length > 1) {
    problems.push(`multiple active plans found: ${planFiles.join(", ")}`);
    lines.push("", "Active Plan", "  Multiple active plans found:");
    for (const file of planFiles) {
      lines.push(`    ${await describePlanFile(root, file)}`);
    }
    lines.push("", "  Resolve the ambiguity before continuing.");
  } else {
    lines.push(...(await describeSinglePlan(root, planFiles[0] as string, problems)));
  }

  return { report: lines.join("\n"), problems };
}

/** A one-line summary of an active plan file for the multiple-plans listing. */
async function describePlanFile(root: string, file: string): Promise<string> {
  const id = planIdFromFilename(file) ?? file;
  try {
    const plan = parsePlan(await readPlanFile(root, file));
    return `${plan.id} — ${plan.method} (${plan.status})`;
  } catch (error) {
    return `${id} — invalid plan: ${messageOf(error)}`;
  }
}

/** The full active-plan block for the single-plan case, including problems. */
async function describeSinglePlan(
  root: string,
  file: string,
  problems: string[],
): Promise<string[]> {
  const id = planIdFromFilename(file) ?? file;
  let plan;
  try {
    plan = parsePlan(await readPlanFile(root, file));
  } catch (error) {
    const problem = `Plan ${id} is invalid: ${messageOf(error)}`;
    problems.push(problem);
    return ["", "Active Plan", `  ${problem}`];
  }

  const workflowProblem = await workflowProblemFor(root, plan);
  if (workflowProblem !== undefined) {
    problems.push(workflowProblem);
  }

  const lines: string[] = ["", "Active Plan"];
  lines.push(`  ID: ${plan.id}`, `  Method: ${plan.method}`, `  Status: ${plan.status}`);
  const next = nextPlanStatus(plan.status);
  if (next !== undefined) {
    lines.push(`  Next: ${next}`);
  }
  if (workflowProblem !== undefined) {
    lines.push("", `  ${workflowProblem}`);
  }

  lines.push("", "Progress");
  for (const stage of PROGRESS_STAGES) {
    lines.push(`  ${stage.label.padEnd(11)}${stageReached(plan.status, stage.status) ? "✓" : "✗"}`);
  }

  lines.push("", "Next Action");
  lines.push(`  ${extractNextAction(plan.content) ?? "Not specified."}`);
  return lines;
}

/** Map a workflow resolution failure to the plan-centric problem message. */
function workflowProblemFromError(plan: { id: string; method: string }, error: unknown): string {
  const detail = messageOf(error);
  if (detail.startsWith("workflow method not adopted:")) {
    return `Plan ${plan.id} requires workflow '${plan.method}', but that workflow is not adopted.`;
  }
  if (detail.startsWith("workflow method asset is malformed:")) {
    return `Plan ${plan.id} requires workflow '${plan.method}', but its document is malformed.`;
  }
  if (detail.startsWith("duplicate workflow method:")) {
    return `Plan ${plan.id} requires workflow '${plan.method}', but it is adopted in both adopted/ and project/.`;
  }
  if (detail.startsWith("invalid workflow method id:")) {
    return `Plan ${plan.id} declares an invalid workflow method: '${plan.method}'.`;
  }
  return `Plan ${plan.id} workflow error: ${detail}`;
}

/** The problem for a workflow whose evidence declarations are invalid. */
function invalidEvidenceProblem(plan: { id: string; method: string }, invalid: string[]): string {
  return (
    `Plan ${plan.id} uses workflow '${plan.method}', which declares an ` +
    `invalid evidence requirement: ${invalid.join(", ")}.`
  );
}

/** Resolve the active plan's workflow, returning a problem message instead of a workflow. */
async function workflowProblemFor(
  root: string,
  plan: { id: string; method: string },
): Promise<string | undefined> {
  let workflow;
  try {
    workflow = await resolveAdoptedWorkflow(root, plan.method);
  } catch (error) {
    return workflowProblemFromError(plan, error);
  }
  const { invalid } = parseEvidenceRequirements(workflow.content);
  return invalid.length > 0 ? invalidEvidenceProblem(plan, invalid) : undefined;
}

/** Minimal git capability verification needs: whether HEAD carries a tag. */
export interface VerifyGit {
  headTagged(dir: string): Promise<boolean>;
}

/** Human-readable label and missing-detail per canonical evidence category. */
const EVIDENCE_LABELS: Record<EvidenceCategory, { label: string; missing: string }> = {
  "acceptance-criteria": { label: "Acceptance criteria", missing: "Acceptance criteria" },
  changelog: { label: "Changelog", missing: "Changelog" },
  tests: { label: "Tests", missing: "Tests" },
  verification: { label: "Verification", missing: "Verification" },
  commit: { label: "Commit", missing: "Commit" },
  "git-state": { label: "Git state", missing: "Git repository" },
  release: { label: "Release", missing: "Release tag" },
  version: { label: "Version", missing: "Version" },
};

/**
 * Whether a path-bound file exists with usable content. The parser guarantees
 * `path` is set and safe for these categories; a readable but non-matching
 * file counts as absent evidence.
 */
async function boundFilePresent(
  root: string,
  path: string | undefined,
  matches: (content: string) => boolean,
): Promise<boolean> {
  if (path === undefined) {
    return false;
  }
  let content: string;
  try {
    content = await new Storage(root).read(...path.split("/"));
  } catch {
    return false;
  }
  return content.trim() !== "" && matches(content);
}

/** Semantic-version form: three dot-separated numbers (industry standard). */
const SEMVER_PATTERN = /\d+\.\d+\.\d+/;

/** Evaluate one declared requirement against recorded evidence and facts. */
async function evaluateRequirement(
  root: string,
  requirement: EvidenceRequirement,
  plan: Plan,
  analysis: Analysis,
  git: VerifyGit,
): Promise<boolean> {
  switch (requirement.category) {
    case "acceptance-criteria":
      return planSection(plan.content, "Acceptance Criteria") !== "";
    case "changelog":
      return boundFilePresent(root, requirement.path, () => true);
    case "commit":
      return planSection(plan.content, "Commit") !== "";
    case "git-state":
      return analysis.git.isRepository;
    case "release":
      return git.headTagged(root);
    case "tests":
      return planSection(plan.content, "Test Evidence") !== "";
    case "verification":
      return planSection(plan.content, "Verification") !== "";
    case "version":
      return boundFilePresent(root, requirement.path, (content) => SEMVER_PATTERN.test(content));
  }
}

/**
 * Verify: determine whether the active Plan has the required evidence per its
 * adopted workflow (WORKFLOW-SPEC). Read-only — it checks the presence
 * of recorded evidence and git facts; it never runs commands, never judges
 * quality, and never writes.
 */
export async function buildVerifyReport(
  root: string,
  analysis: Analysis,
  planStore: PlanStore,
  git: VerifyGit,
): Promise<CommandReport> {
  const problems: string[] = [];
  const lines: string[] = ["DoozCTL Verify", ""];

  let planFiles: string[];
  try {
    planFiles = await planStore.list(root, "active");
  } catch (error) {
    problems.push(`cannot read active plans: ${messageOf(error)}`);
    lines.push("Plan", "  Unavailable.");
    return { report: lines.join("\n"), problems };
  }

  if (planFiles.length === 0) {
    problems.push("no active plan");
    lines.push("Plan", "  None", "", "Result", "  NOT READY", "", "No active plan to verify.");
    return { report: lines.join("\n"), problems };
  }

  if (planFiles.length > 1) {
    problems.push(`multiple active plans found: ${planFiles.join(", ")}`);
    lines.push("Plan", "  Multiple active plans found:");
    for (const file of planFiles) {
      lines.push(`    ${await describePlanFile(root, file)}`);
    }
    lines.push("", "  Resolve the ambiguity before continuing.");
    return { report: lines.join("\n"), problems };
  }

  const file = planFiles[0] as string;
  const id = planIdFromFilename(file) ?? file;
  let plan;
  try {
    plan = parsePlan(await readPlanFile(root, file));
  } catch (error) {
    const problem = `Plan ${id} is invalid: ${messageOf(error)}`;
    problems.push(problem);
    lines.push("Plan", `  ${problem}`);
    return { report: lines.join("\n"), problems };
  }

  lines.push("Plan");
  lines.push(`  ID: ${plan.id}`, `  Method: ${plan.method}`, `  Status: ${plan.status}`);

  let workflow;
  try {
    workflow = await resolveAdoptedWorkflow(root, plan.method);
  } catch (error) {
    const problem = workflowProblemFromError(plan, error);
    problems.push(problem);
    lines.push("", `  ${problem}`);
    return { report: lines.join("\n"), problems };
  }
  const { requirements, manual, invalid } = parseEvidenceRequirements(workflow.content);
  if (invalid.length > 0) {
    const problem = invalidEvidenceProblem(plan, invalid);
    problems.push(problem);
    lines.push("", `  ${problem}`);
    return { report: lines.join("\n"), problems };
  }

  const missing: string[] = [];
  lines.push("", "Evidence", "");
  if (requirements.length === 0 && manual.length === 0) {
    lines.push("  Workflow declares no required evidence.");
  }
  for (const requirement of requirements) {
    const present = await evaluateRequirement(root, requirement, plan, analysis, git);
    let row = `  ${EVIDENCE_LABELS[requirement.category].label.padEnd(22)}${present ? "✓" : "✗"}`;
    if (requirement.category === "tests") {
      const facts = describeTestFacts(analysis);
      if (facts !== null) {
        row += `  ${facts}`;
      }
    }
    lines.push(row);
    if (!present) {
      const detail = EVIDENCE_LABELS[requirement.category].missing;
      missing.push(requirement.path !== undefined ? `${detail} (${requirement.path})` : detail);
    }
  }
  if (manual.length > 0) {
    lines.push("", "Manual evidence (not machine-checked):");
    for (const item of manual) {
      lines.push(`  - ${item}`);
    }
  }

  if (missing.length === 0) {
    lines.push("", "Result", "  READY");
  } else {
    problems.push(`evidence incomplete: ${missing.join(", ")}`);
    lines.push("", "Result", "  NOT READY", "", "Missing:");
    for (const item of missing) {
      lines.push(`  ${item}`);
    }
  }
  return { report: lines.join("\n"), problems };
}

/** Read an active plan file through the sandboxed Storage. */
async function readPlanFile(root: string, file: string): Promise<string> {
  return new Storage(root).read(".dooz", "plans", "active", file);
}

/** The stable human-readable message from an unknown error. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Health check: verify initialization, package validity, artifact coverage,
 * artifact existence and managed-block integrity. Returns the human-readable
 * report plus the list of problems (empty when healthy).
 */
export async function buildDoctorReport(
  ctx: ExecutionContext,
  manifest: Manifest | null,
): Promise<{ report: string; problems: string[] }> {
  const repo = new Storage(ctx.root);
  const problems: string[] = [];
  const lines: string[] = [formatTitle("Checking repository", ctx.root), ""];

  lines.push(check(true, "Initialized — .dooz/manifest.json"));
  lines.push(check(true, "Repository memory — .ai/repository-analysis.json"));

  if (ctx.standards !== null) {
    lines.push(check(true, `Standards package — ${ctx.standards.name} ${ctx.standards.version}`));
  }

  // Only artifacts that init or sync persist are expected in the manifest;
  // summarize-only artifacts are recorded later, by summarize.
  const persistable = ctx.artifacts.filter(
    (artifact) => artifact.lifecycle.includes("init") || artifact.lifecycle.includes("sync"),
  );
  const expected = persistable.map((artifact) => artifact.id);
  lines.push(check(true, `Artifacts — ${ctx.artifacts.length} declared`));

  const recorded = new Set(
    (manifest?.artifacts ?? []).map((entry) => (typeof entry === "string" ? entry : entry.id)),
  );
  const missing = expected.filter((id) => !recorded.has(id));
  if (missing.length === 0) {
    lines.push(check(true, `Generated artifacts recorded — ${recorded.size} in manifest`));
  } else {
    problems.push(
      `Artifacts not recorded in the manifest: ${missing.join(", ")}. Re-run doozctl init or doozctl sync to repair.`,
    );
    lines.push(
      check(
        false,
        `Generated artifacts recorded — ${recorded.size} of ${expected.length} in manifest`,
      ),
    );
  }

  for (const artifact of persistable) {
    let content: string;
    try {
      content = await repo.read(artifact.destination.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        problems.push(
          `Generated artifact missing: ${artifact.destination.path} (artifact "${artifact.id}"). Re-run doozctl init or doozctl sync.`,
        );
        lines.push(check(false, `Artifact ${artifact.id} — ${artifact.destination.path} exists`));
        continue;
      }
      throw error;
    }
    lines.push(check(true, `Artifact ${artifact.id} — ${artifact.destination.path} exists`));
    if (artifact.mergeStrategy === "managed-blocks") {
      try {
        validateManagedBlocks(content);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        problems.push(
          `Managed-block markers malformed in ${artifact.destination.path}: ${detail}. DoozCTL never repairs malformed files; fix the markers by hand, then run doozctl sync.`,
        );
        lines.push(check(false, `Managed blocks in ${artifact.destination.path} are well-formed`));
      }
    }
  }

  lines.push(describeGit(ctx.analysis));
  if (ctx.analysis?.git.isRepository === true && ctx.analysis.git.dirty) {
    problems.push("Working tree has uncommitted changes. Commit before summarizing.");
  }

  lines.push("");
  if (problems.length === 0) {
    lines.push("Repository is healthy.");
  } else {
    lines.push("Problems found:");
    for (const problem of problems) {
      lines.push(`  ✗ ${problem}`);
    }
  }
  return { report: lines.join("\n"), problems };
}

function formatTitle(label: string, subject: string): string {
  return `${label}: ${subject}`;
}
