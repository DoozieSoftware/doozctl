import type { Analysis, Manifest } from "../model/model.js";
import {
  PLAN_LIFECYCLE,
  extractNextAction,
  nextPlanStatus,
  parsePlan,
  planIdFromFilename,
  type PlanAnyStatus,
  type PlanStatus,
} from "../model/plan.js";
import type { PlanStore } from "../store/plan-store.js";
import { Storage } from "../store/storage.js";
import { resolveAdoptedWorkflow } from "../workflows/adoption.js";
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

/** A status report: the deterministic text plus the problems that gate the exit code. */
export interface StatusReport {
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
 * Status 2.0: a concise, read-only view of the repository and its v2 control
 * plane — repository facts, initialization, the active plan, its workflow,
 * lifecycle progress and the next action. Never writes.
 */
export async function buildStatusReport(
  root: string,
  analysis: Analysis,
  manifest: Manifest,
  planStore: PlanStore,
): Promise<StatusReport> {
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

/** Map a workflow resolution failure to the status problem message. */
async function workflowProblemFor(
  root: string,
  plan: {
    id: string;
    method: string;
  },
): Promise<string | undefined> {
  try {
    await resolveAdoptedWorkflow(root, plan.method);
  } catch (error) {
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
  return undefined;
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
