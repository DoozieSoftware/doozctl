import { parseBaseline } from "../model/baseline.js";
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
import {
  evaluateDocumentIntegrity,
  evaluateGitFactsIntegrity,
  type IntegrityGit,
  type IntegrityResult,
  type TrustState,
} from "./integrity.js";
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
 * lifecycle progress and the next action. Never writes. The v3 Context
 * summary (V3-P08) is an observation surface over the same fixed artifact
 * inventory as `context validate`, aggregated through the integrity engine —
 * status never determines freshness itself, and context outcomes never
 * change the existing status exit code. V3-P09 renders the §12 plan-drift
 * observation under the Active Plan section when that plan's P06 result is
 * STALE, from the same evaluation — never a second freshness signal.
 */
export async function buildStatusReport(
  root: string,
  analysis: Analysis,
  manifest: Manifest,
  planStore: PlanStore,
  store: ContextValidateAnalysisStore,
  git: IntegrityGit,
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

  // V3 Context (P08/P09): one evaluation of the fixed inventory, shared by the
  // Active Plan section (whose §12 drift observation consumes the plan's P06
  // result above) and this aggregate summary. Status never evaluates freshness
  // itself, and these observations never change the exit code.
  const context = await evaluateContextRows(root, planStore, store, git);

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
    const file = planFiles[0] as string;
    lines.push(
      ...(await describeSinglePlan(
        root,
        file,
        problems,
        context.rows.find((row) => row.label === `plans/active/${file}`),
        git,
      )),
    );
  }

  lines.push("", "Context");
  lines.push(`  Current   ${context.counts.current}`);
  lines.push(`  Stale     ${context.counts.stale}`);
  lines.push(`  Unknown   ${context.counts.unknown}`);
  if (context.counts.invalid > 0) {
    // INVALID is never silently folded into STALE or UNKNOWN.
    lines.push(`  Invalid   ${context.counts.invalid}`);
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
  contextRow: { trust: TrustState; reasons: string[] } | undefined,
  git: IntegrityGit,
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

  // V3 Plan drift (P09): the §12 observation, rendered from the plan's P06
  // integrity result — empty unless the plan is STALE.
  lines.push(...(await planDriftLines(root, plan, contextRow, git)));

  lines.push("", "Progress");
  for (const stage of PROGRESS_STAGES) {
    lines.push(`  ${stage.label.padEnd(11)}${stageReached(plan.status, stage.status) ? "✓" : "✗"}`);
  }

  lines.push("", "Next Action");
  lines.push(`  ${extractNextAction(plan.content) ?? "Not specified."}`);
  return lines;
}

/**
 * The §12 plan-drift observation (V3-P09) for a plan whose P06 integrity
 * result is STALE: the STALE context, baseline → HEAD, the re-understand
 * instruction, and the integrity engine's own deterministic reason lines
 * verbatim. This is presentation over an existing P06 result — never a second
 * freshness signal, never a new evaluation mechanism.
 *
 * Empty for every other trust state. In particular a plan whose repository
 * moved outside its described scope stays CURRENT/TRUSTED with the §6.3 note
 * and must never produce drift (Scenario B). Strictly read-only: the plan
 * file, its lifecycle state and the command's exit code are untouched.
 */
async function planDriftLines(
  root: string,
  plan: Plan,
  result: { trust: TrustState; reasons: string[] } | undefined,
  git: IntegrityGit,
): Promise<string[]> {
  if (result === undefined || result.trust !== "STALE") {
    return [];
  }
  const baseline = parseBaseline(plan.content);
  if (!baseline.present || !baseline.valid) {
    return [];
  }
  const info = await git.detect(root);
  const head = info?.commit ?? "unresolved";
  const branch = info?.branch ?? "(detached)";
  const tree = info?.dirty === true ? "uncommitted changes" : "clean";
  return [
    "  Context: STALE",
    `  Baseline: ${baseline.fields.commit} → HEAD ${head} (branch: ${branch}, ${tree})`,
    "  Re-understand the described scope before continuing.",
    "",
    "  Reason:",
    ...result.reasons.map((reason) => `  - ${reason}`),
  ];
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

/**
 * Grounding classes (CONTEXT-SPEC §11.1): how each canonical evidence
 * category grounds. The vocabulary extension rule holds — extending a
 * category is one table row plus one deterministic check, never a language.
 */
type GroundingClass = "LIVE" | "RECORDED" | "BASELINE";

const GROUNDING_CLASS: Record<EvidenceCategory, GroundingClass> = {
  "acceptance-criteria": "RECORDED",
  changelog: "LIVE",
  tests: "RECORDED",
  verification: "RECORDED",
  commit: "BASELINE",
  "git-state": "LIVE",
  release: "LIVE",
  version: "LIVE",
};

/**
 * The §11.2 qualifier vocabulary. `STALE-BASELINE` is the demotion token
 * (GAUNTLET AS-4): a record that cannot be presented as grounding for the
 * current repository state — either because its plan's baseline is STALE
 * (§11.2 rule 2) or, for a `## Commit` hash, because the recorded commit is
 * unreachable from HEAD (S4).
 */
const RECORDED_QUALIFIER = "recorded, not verified against HEAD";
const STALE_BASELINE_QUALIFIER = "STALE-BASELINE";

/** A commit-hash-shaped token: 7–40 hex characters on word boundaries. */
const COMMIT_HASH_PATTERN = /\b[0-9a-f]{7,40}\b/i;

/** The first hash-shaped token in a recorded section, or null. */
function extractCommitHash(section: string): string | null {
  const match = COMMIT_HASH_PATTERN.exec(section);
  return match === null ? null : (match[0] ?? null);
}

/**
 * The grounding qualifier for one evidence row (V3-P10, CONTEXT-SPEC §11.2).
 * A pure annotation over the existing checks — it never changes any check
 * result and never gates READY/NOT READY:
 *
 * - `LIVE` rows are checked against the current tree/git and stay unqualified
 *   by the plan's trust state.
 * - `RECORDED` rows show "recorded, not verified against HEAD"; a plan whose
 *   P06 trust state is STALE demotes them to `STALE-BASELINE` (§11.2 rule 2).
 * - `BASELINE` (`commit`) rows show the freshness of the recorded hash itself
 *   (S4): unreachable → `STALE-BASELINE`; reachable but older than HEAD →
 *   "recorded, not current"; == HEAD → "current". With no hash recorded (or
 *   HEAD unresolvable) the row is recorded prose and falls back to the
 *   recorded qualifier, demoted under a STALE plan.
 */
async function groundingQualifier(
  root: string,
  requirement: EvidenceRequirement,
  plan: Plan,
  planTrust: TrustState,
  git: IntegrityGit,
): Promise<string> {
  const groundingClass = GROUNDING_CLASS[requirement.category];
  if (groundingClass === "LIVE") {
    return "LIVE";
  }
  if (groundingClass === "RECORDED") {
    return planTrust === "STALE" ? STALE_BASELINE_QUALIFIER : RECORDED_QUALIFIER;
  }
  const hash = extractCommitHash(planSection(plan.content, "Commit"));
  if (hash === null) {
    return planTrust === "STALE" ? STALE_BASELINE_QUALIFIER : RECORDED_QUALIFIER;
  }
  const headHash = await git.revParse(root, "HEAD");
  if (headHash === null) {
    // No resolvable current state: the record cannot be verified against it.
    return planTrust === "STALE" ? STALE_BASELINE_QUALIFIER : RECORDED_QUALIFIER;
  }
  const resolved = await git.revParse(root, hash);
  if (resolved === null) {
    return STALE_BASELINE_QUALIFIER;
  }
  if (resolved === headHash) {
    return "current";
  }
  const reachable = await git.isAncestor(root, resolved);
  return reachable ? "recorded, not current" : STALE_BASELINE_QUALIFIER;
}

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
 * quality, and never writes. V3-P09 adds the §12 plan-drift observation for a
 * STALE plan, rendered from the same P06 integrity evaluation that grounds the
 * context rows. V3-P10 adds the §11 grounding qualifier to every evidence row
 * (LIVE / recorded / STALE-BASELINE / S4 commit freshness) from the same
 * evaluation — an annotation column, never a check change: presence alone
 * still gates READY/NOT READY and the problems list.
 */
export async function buildVerifyReport(
  root: string,
  analysis: Analysis,
  planStore: PlanStore,
  git: VerifyGit & IntegrityGit,
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

  // V3 Plan drift (P09): the same P06 evaluation that grounds context rows,
  // consumed read-only. A STALE plan carries the §12 drift observation with
  // its deterministic reason lines; a plan whose repository moved outside its
  // described scope stays CURRENT and never drifts (Scenario B). Observation
  // only — it never gates READY/NOT READY (P10 settles that interaction).
  const planIntegrity = await evaluateDocumentIntegrity(plan.content, root, git);
  lines.push(...(await planDriftLines(root, plan, planIntegrity, git)));

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
    // V3 Evidence grounding (P10): every row carries its grounding qualifier.
    // The checks themselves are unchanged — presence alone still gates
    // READY/NOT READY and the problems list; qualifiers are annotations.
    const qualifier = await groundingQualifier(root, requirement, plan, planIntegrity.trust, git);
    row += ` (${qualifier})`;
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

/** The analysis reader `context validate` needs; RepositoryStore satisfies it. */
export interface ContextValidateAnalysisStore {
  loadAnalysis(dir: string): Promise<Analysis>;
}

/** Read a sandboxed artifact, or null when it vanished between inventory and read. */
async function readContextArtifact(storage: Storage, parts: string[]): Promise<string | null> {
  try {
    return await storage.read(...parts);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** The fresh/trust counts of the fixed context inventory, per P06 results. */
export interface ContextCounts {
  current: number;
  stale: number;
  unknown: number;
  invalid: number;
}

/**
 * Walk the fixed context inventory (v3 A-4) and evaluate each artifact with
 * the integrity engine. Shared by `context validate` (P07, per-row detail)
 * and `status` (P08, aggregate summary) — the same inventory, the same
 * evaluator, never an independent freshness implementation. Read-only.
 */
export async function evaluateContextRows(
  root: string,
  planStore: PlanStore,
  store: ContextValidateAnalysisStore,
  git: IntegrityGit,
): Promise<{
  counts: ContextCounts;
  rows: Array<{ label: string; trust: TrustState; note: string | null; reasons: string[] }>;
}> {
  const counts: ContextCounts = { current: 0, stale: 0, unknown: 0, invalid: 0 };
  const rows: Array<{ label: string; trust: TrustState; note: string | null; reasons: string[] }> =
    [];
  const recordResult = (label: string, result: IntegrityResult): void => {
    rows.push({ label, trust: result.trust, note: result.note, reasons: result.reasons });
    if (result.trust === "TRUSTED") {
      counts.current += 1;
    } else if (result.trust === "STALE") {
      counts.stale += 1;
    } else if (result.trust === "UNKNOWN") {
      counts.unknown += 1;
    } else if (result.trust === "INVALID") {
      counts.invalid += 1;
    }
  };

  const storage = new Storage(root);

  // Facts — .ai/repository-analysis.json (provenance from the git.commit JSON
  // field, unscoped by contract). Unreadable analysis is a corrupt repository
  // state, reported INVALID, never silently skipped.
  try {
    const analysis = await store.loadAnalysis(root);
    recordResult(
      "repository-analysis.json",
      await evaluateGitFactsIntegrity(analysis.git.commit ?? null, root, git),
    );
  } catch {
    recordResult("repository-analysis.json", {
      freshness: "INVALID",
      trust: "INVALID",
      note: null,
      reasons: ["cannot read repository-analysis.json"],
    });
  }

  // Intent — .dooz/plans/active/*.md and completed/*.md (## Baseline grammar).
  for (const state of ["active", "completed"] as const) {
    for (const file of await planStore.list(root, state)) {
      const content = await readContextArtifact(storage, [".dooz", "plans", state, file]);
      if (content === null) {
        continue;
      }
      recordResult(`plans/${state}/${file}`, await evaluateDocumentIntegrity(content, root, git));
    }
  }

  // History — .ai/sessions/*.md (## Baseline grammar).
  for (const file of await storage.list(".ai", "sessions")) {
    if (!file.endsWith(".md")) {
      continue;
    }
    const content = await readContextArtifact(storage, [".ai", "sessions", file]);
    if (content === null) {
      continue;
    }
    recordResult(`sessions/${file}`, await evaluateDocumentIntegrity(content, root, git));
  }

  // Present state — .ai/current-context.md (## Baseline grammar).
  const currentContext = await readContextArtifact(storage, [".ai", "current-context.md"]);
  if (currentContext !== null) {
    recordResult("current-context.md", await evaluateDocumentIntegrity(currentContext, root, git));
  }

  return { counts, rows };
}

/**
 * Context validate (v3 P07): inventory the integrity-checkable artifacts at
 * their contract-fixed locations (v3 A-4), evaluate each against the current
 * repository with the integrity engine (P06), and report its trust state.
 * Strictly read-only. Problems are STALE and INVALID artifacts; CURRENT and
 * UNKNOWN rows are informational and never fail the command (D1).
 */
export async function buildContextValidateReport(
  root: string,
  planStore: PlanStore,
  store: ContextValidateAnalysisStore,
  git: IntegrityGit,
): Promise<CommandReport> {
  const markers: Record<TrustState, string> = {
    TRUSTED: "✓",
    STALE: "⚠",
    UNKNOWN: "?",
    INVALID: "✗",
  };
  const problems: string[] = [];
  const { rows, counts } = await evaluateContextRows(root, planStore, store, git);

  const lines: string[] = ["Context Integrity", ""];
  for (const row of rows.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))) {
    lines.push(`${markers[row.trust]} ${row.label} — ${row.trust}`);
    if (row.trust === "TRUSTED" && row.note !== null) {
      lines.push(`    ${row.note}`);
    }
    for (const reason of row.reasons) {
      lines.push(`    ${reason}`);
    }
    if (row.trust === "STALE") {
      problems.push(`stale: ${row.label}`);
    } else if (row.trust === "INVALID") {
      problems.push(`invalid: ${row.label}`);
    }
  }
  lines.push(
    "",
    `Result: ${counts.stale} stale, ${counts.unknown} unknown, ${counts.invalid} invalid`,
  );
  return { report: lines.join("\n"), problems };
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
