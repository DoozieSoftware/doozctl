import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { RepositoryInfo } from "../infra/git/git.js";
import type { Analysis, Manifest } from "../model/model.js";
import { renderPlan } from "../model/plan.js";
import { PlanStore } from "../store/plan-store.js";
import { RepositoryStore } from "../store/repository-store.js";
import type { IntegrityGit } from "./integrity.js";
import {
  buildContextValidateReport,
  buildStatusReport,
  buildVerifyReport,
  type VerifyGit,
} from "./report.js";

const dirs: string[] = [];
afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "doozctl-status-"));
  dirs.push(dir);
  return dir;
}

/** A minimal factual analysis for a non-git repository root. */
function analysis(root: string, overrides: Partial<Analysis> = {}): Analysis {
  return {
    root,
    git: { isRepository: false, branch: null, dirty: false, commit: null },
    languages: [],
    frameworks: [],
    buildSystem: null,
    packageManager: null,
    testFramework: null,
    ci: [],
    docker: false,
    statistics: { totalFiles: 0, sourceFiles: 0, testFiles: 0 },
    ...overrides,
  };
}

const manifest: Manifest = { version: 1, artifacts: [{ id: "agents", destination: "AGENTS.md" }] };

/** A workflow document declaring the given id. */
function workflowContent(id: string): string {
  return [
    `# ${id}`,
    "",
    "## Metadata",
    "",
    `- id: ${id}`,
    "",
    "## Purpose",
    "",
    "Test method.",
  ].join("\n");
}

/** Adopt a workflow into `.dooz/workflows/<place>/`. */
async function adoptWorkflow(
  dir: string,
  id: string,
  place: "adopted" | "project" = "adopted",
  content: string = workflowContent(id),
): Promise<void> {
  const base = path.join(dir, ".dooz", "workflows", place);
  await mkdir(base, { recursive: true });
  await writeFile(path.join(base, `${id}.md`), content, "utf-8");
}

/** Write a plan document into `.dooz/plans/active/`. */
async function writePlan(
  dir: string,
  plan: {
    id: string;
    method: string;
    status: string;
    created?: string;
    nextAction?: string;
    /** Extra `## <heading>` sections with body text, in insertion order. */
    sections?: Record<string, string>;
  },
): Promise<void> {
  const created = plan.created ?? "2026-08-09";
  const active = path.join(dir, ".dooz", "plans", "active");
  await mkdir(active, { recursive: true });
  const body = [
    `# ${plan.id}`,
    "",
    "## Metadata",
    "",
    `- id: ${plan.id}`,
    `- method: ${plan.method}`,
    `- status: ${plan.status}`,
    `- created: ${created}`,
  ];
  for (const [heading, text] of Object.entries(plan.sections ?? {})) {
    body.push("", `## ${heading}`, "", text);
  }
  if (plan.nextAction !== undefined) {
    body.push("", "## Next Action", "", plan.nextAction);
  }
  await writeFile(path.join(active, `${created}-${plan.id}.md`), body.join("\n"), "utf-8");
}

/** A workflow document declaring the given required-evidence checklist. */
function workflowWithEvidence(id: string, checklist: string[], manual: string[] = []): string {
  return [
    `# ${id}`,
    "",
    "## Metadata",
    "",
    `- id: ${id}`,
    "",
    "## Required Evidence",
    "",
    ...checklist.map((category) => `- [ ] ${category}`),
    ...manual.map((text) => `- ${text}`),
  ].join("\n");
}

const planStore = new PlanStore({ now: () => new Date(2026, 7, 9, 9, 30, 0) });

describe("buildStatusReport", () => {
  it("reports repository and control-plane facts with no active plan", async () => {
    const dir = await tmp();
    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(problems).toEqual([]);
    expect(report).toContain("DoozCTL Status");
    expect(report).toContain(`Path: ${dir}`);
    expect(report).toContain("Git: not a repository");
    expect(report).toContain("Initialized: yes");
    expect(report).toContain("Artifacts: 1");
    expect(report).toContain("Active Plan\n  None");
    expect(report).toContain("doozctl plan --method <adopted-method>");
  });

  it("reports a clean git branch with the active plan's progress and next action", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix");
    await writePlan(dir, {
      id: "attendance-punch-sync",
      method: "bug-fix",
      status: "EXECUTING",
      nextAction: "Commit the verified change.",
    });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(problems).toEqual([]);
    expect(report).toContain("Branch: main");
    expect(report).toContain("Git: clean");
    expect(report).toContain("ID: attendance-punch-sync");
    expect(report).toContain("Method: bug-fix");
    expect(report).toContain("Status: EXECUTING");
    expect(report).toContain("Next: VERIFIED");
    expect(report).toContain("Plan       ✓");
    expect(report).toContain("Verify     ✗");
    expect(report).toContain("Test       ✗");
    expect(report).toContain("Commit     ✗");
    expect(report).toContain("Merge      ✗");
    expect(report).toContain("Commit the verified change.");
  });

  it("reports a dirty repository", async () => {
    const dir = await tmp();
    const { report } = await buildStatusReport(
      dir,
      analysis(dir, { git: { isRepository: true, branch: "main", dirty: true, commit: "abc123" } }),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(report).toContain("Git: dirty");
  });

  it("reports detected test facts in the repository section", async () => {
    const dir = await tmp();
    const { report } = await buildStatusReport(
      dir,
      analysis(dir, {
        testFramework: "vitest",
        statistics: { totalFiles: 20, sourceFiles: 8, testFiles: 12 },
      }),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(report).toContain("Tests: vitest · 12 test files");
  });

  it("omits the test facts line when no test framework or files are detected", async () => {
    const dir = await tmp();
    const { report } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(report).not.toContain("Tests:");
  });

  it("derives only reached stages from the lifecycle and never over-claims", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "feature");
    await writePlan(dir, { id: "feature", method: "feature", status: "VERIFIED" });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(problems).toEqual([]);
    expect(report).toContain("Status: VERIFIED");
    expect(report).toContain("Next: TESTED");
    expect(report).toContain("Plan       ✓");
    expect(report).toContain("Verify     ✓");
    expect(report).toContain("Test       ✗");
    expect(report).toContain("Commit     ✗");
    expect(report).toContain("Next Action\n  Not specified.");
  });

  it("reports a plan without an explicit next action as not specified", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "standard");
    await writePlan(dir, { id: "standard", method: "standard", status: "PLANNED" });

    const { report } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(report).toContain("Next Action\n  Not specified.");
  });

  it("lists multiple active plans without selecting one", async () => {
    const dir = await tmp();
    await writePlan(dir, {
      id: "plan-a",
      method: "bug-fix",
      status: "EXECUTING",
      created: "2026-08-09",
    });
    await writePlan(dir, {
      id: "plan-b",
      method: "feature",
      status: "PLANNED",
      created: "2026-08-10",
    });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(problems).not.toEqual([]);
    expect(report).toContain("Multiple active plans found:");
    expect(report).toContain("plan-a — bug-fix (EXECUTING)");
    expect(report).toContain("plan-b — feature (PLANNED)");
    expect(report).toContain("Resolve the ambiguity before continuing.");
  });

  it("reports a malformed active plan without a stack trace", async () => {
    const dir = await tmp();
    const active = path.join(dir, ".dooz", "plans", "active");
    await mkdir(active, { recursive: true });
    await writeFile(path.join(active, "2026-08-09-broken.md"), "# Broken\nno metadata\n", "utf-8");

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(problems).not.toEqual([]);
    expect(report).toContain("Plan broken is invalid:");
    expect(report).not.toContain("at ");
  });

  it("reports a missing adopted workflow", async () => {
    const dir = await tmp();
    await writePlan(dir, { id: "attendance-punch-sync", method: "bug-fix", status: "EXECUTING" });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(problems).not.toEqual([]);
    expect(report).toContain(
      "Plan attendance-punch-sync requires workflow 'bug-fix', but that workflow is not adopted.",
    );
  });

  it("reports a malformed adopted workflow", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix", "adopted", "# bug-fix\nno metadata\n");
    await writePlan(dir, { id: "attendance-punch-sync", method: "bug-fix", status: "EXECUTING" });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(problems).not.toEqual([]);
    expect(report).toContain(
      "Plan attendance-punch-sync requires workflow 'bug-fix', but its document is malformed.",
    );
  });

  it("reports a workflow adopted in both places as a problem", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix", "adopted");
    await adoptWorkflow(dir, "bug-fix", "project");
    await writePlan(dir, { id: "attendance-punch-sync", method: "bug-fix", status: "EXECUTING" });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(problems).not.toEqual([]);
    expect(report).toContain(
      "Plan attendance-punch-sync requires workflow 'bug-fix', but it is adopted in both adopted/ and project/.",
    );
  });

  it("reports an invalid workflow method id declared by the plan", async () => {
    const dir = await tmp();
    await writePlan(dir, { id: "sneaky", method: "../escape", status: "PLANNED" });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(problems).not.toEqual([]);
    expect(report).toContain("Plan sneaky declares an invalid workflow method: '../escape'.");
  });

  it("shows no next lifecycle state for an abandoned plan", async () => {
    const dir = await tmp();
    await writePlan(dir, { id: "old", method: "standard", status: "ABANDONED" });

    const { report } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(report).toContain("Status: ABANDONED");
    expect(report).not.toContain("Next:");
    expect(report).toContain("Plan       ✗");
  });

  it("reports an unreadable active-plan directory as a problem", async () => {
    const dir = await tmp();
    const outside = await tmp();
    const plans = path.join(dir, ".dooz", "plans");
    await mkdir(plans, { recursive: true });
    await symlink(outside, path.join(plans, "active"), "dir");

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(problems).not.toEqual([]);
    expect(report).toContain("Active Plan\n  Unavailable.");
  });

  it("handles a plan with a large body without truncation", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "feature");
    const big = new Array(5000).fill("progress note").join("\n");
    await writePlan(dir, { id: "feature", method: "feature", status: "EXECUTING" });
    const active = path.join(dir, ".dooz", "plans", "active");
    await writeFile(
      path.join(active, "2026-08-09-feature.md"),
      [
        "# Feature",
        "",
        "## Metadata",
        "",
        "- id: feature",
        "- method: feature",
        "- status: EXECUTING",
        "- created: 2026-08-09",
        "",
        "## Next Action",
        "",
        big,
      ].join("\n"),
      "utf-8",
    );

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    expect(problems).toEqual([]);
    expect(report).toContain("ID: feature");
  });

  it("Context summary: all artifacts CURRENT at the tip", async () => {
    const dir = await tmp();
    await contextStore.saveAnalysis(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDoc("abc123"),
    );
    const git = new FakeContextGit({ headFull: "full", resolve: { abc123: "full" } });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      git,
    );

    // The only problem is the v2 control-plane one (unadopted workflow); the
    // context section never contributes problems.
    expect(problems).toEqual([
      "Plan punch requires workflow 'bug-fix', but that workflow is not adopted.",
    ]);
    expect(report).toContain("Context");
    expect(report).toContain("  Current   2");
    expect(report).toContain("  Stale     0");
    expect(report).toContain("  Unknown   0");
    expect(report).not.toContain("  Invalid");
  });

  it("Context summary: a stale artifact is counted without changing the exit code", async () => {
    const dir = await tmp();
    await contextStore.saveAnalysis(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDoc("abc123"),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-stale.md"],
      baselinedDoc("def456", ["src/attendance/"]),
    );
    const git = new FakeContextGit({
      headFull: "head-full",
      resolve: { abc123: "head-full", def456: "base-full" },
      changed: ["src/attendance/PunchService.php"],
    });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      git,
    );

    // v2 reports the multiple-active-plans problem; the stale context row
    // adds none — context never changes the status exit code.
    expect(problems).toEqual([
      "multiple active plans found: 2026-08-09-punch.md, 2026-08-09-stale.md",
    ]);
    expect(report).toContain("  Current   2"); // analysis + the at-tip plan
    expect(report).toContain("  Stale     1");
    expect(report).toContain("  Unknown   0");
  });

  it("Context summary: pre-v3 artifacts without baselines count as Unknown", async () => {
    const dir = await tmp();
    await contextStore.saveAnalysis(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-legacy.md"],
      renderPlan({ id: "legacy", method: "bug-fix" }, "2026-08-13"),
    );
    await writeDoc(
      dir,
      [".ai", "sessions", "2026-08-09_093000.md"],
      renderPlan({ id: "s", method: "bug-fix" }, "2026-08-13"),
    );
    const git = new FakeContextGit({
      headFull: "full",
      resolve: { abc123: "full" },
    });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      git,
    );

    // The legacy plan has no baseline → UNKNOWN; the session likewise. The
    // analysis at the tip stays CURRENT. No context problems surface.
    expect(problems).toEqual([
      "Plan legacy requires workflow 'bug-fix', but that workflow is not adopted.",
    ]);
    expect(report).toContain("  Current   1");
    expect(report).toContain("  Stale     0");
    expect(report).toContain("  Unknown   2");
  });

  it("Context summary: mixed counts aggregate deterministically", async () => {
    const dir = await tmp();
    await contextStore.saveAnalysis(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch-current.md"],
      baselinedDoc("abc123"),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch-stale.md"],
      baselinedDoc("def456", ["src/attendance/"]),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch-unknown.md"],
      renderPlan({ id: "punch-unknown", method: "bug-fix" }, "2026-08-13"),
    );
    const git = new FakeContextGit({
      headFull: "head-full",
      resolve: { abc123: "head-full", def456: "base-full" },
      changed: ["src/attendance/PunchService.php"],
    });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      git,
    );

    // 2 current (analysis + at-tip plan), 1 stale (in-scope change), 1 unknown (no baseline)
    expect(problems).toEqual([
      "multiple active plans found: 2026-08-09-punch-current.md, 2026-08-09-punch-stale.md, 2026-08-09-punch-unknown.md",
    ]);
    expect(report).toContain("  Current   2");
    expect(report).toContain("  Stale     1");
    expect(report).toContain("  Unknown   1");
  });

  it("Context summary: repeated runs produce identical output", async () => {
    const dir = await tmp();
    await contextStore.saveAnalysis(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDoc("abc123"),
    );
    const git = new FakeContextGit({ headFull: "full", resolve: { abc123: "full" } });

    const first = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      git,
    );
    const second = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      git,
    );

    expect(first.report).toBe(second.report);
    expect(first.problems).toEqual(second.problems);
  });

  it("Context summary: reports INVALID rather than folding it into Stale or Unknown", async () => {
    const dir = await tmp();
    await writeDoc(dir, [".ai", "repository-analysis.json"], "not json{{");
    const git = new FakeContextGit({ headFull: "full" });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      git,
    );

    expect(problems).toEqual([]);
    expect(problems).toEqual([]); // invalid context never changes the exit code
    expect(report).toContain("  Current   0");
    expect(report).toContain("  Stale     0");
    expect(report).toContain("  Unknown   0");
    expect(report).toContain("  Invalid   1");
  });

  it("existing v2 status output is unchanged except for the appended Context block", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "feature");
    await writePlan(dir, { id: "feature", method: "feature", status: "VERIFIED" });
    // A clean v2 repo also has its analysis file — legacy shape (no live git
    // facts), which evaluates UNKNOWN, not INVALID.
    await contextStore.saveAnalysis(dir, analysis(dir));

    const withContext = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );
    const withoutContext = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      new FakeContextGit({ repo: null }),
    );

    // Both runs render the identical output — the v2 control-plane surface is
    // untouched and Context is a pure observation appended at the end.
    expect(withoutContext.report).toBe(withContext.report);
    expect(withoutContext.report).toContain("Status: VERIFIED");
    expect(withoutContext.report).toContain("Verify     ✓");
    expect(withoutContext.report).toContain("Progress");
    expect(withContext.report).toContain("Context");
    expect(withContext.report).toContain("  Current   0");
    expect(withContext.report).toContain("  Stale     0");
    expect(withContext.report).toContain("  Unknown   2");
    expect(withContext.report).not.toContain("  Invalid");
  });

  it("Plan drift (Scenario A): a scoped change under a moved tip surfaces the §12 observation deterministically", async () => {
    const dir = await tmp();
    await contextStore.saveAnalysis(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDoc("abc123", ["src/attendance/"]),
    );
    const git = new FakeContextGit({
      repo: { root: dir, branch: "main", dirty: false, commit: "9f8e7d6" },
      headFull: "head-full",
      resolve: { abc123: "base-full" },
      changed: ["src/attendance/PunchService.php", "tests/PunchServiceTest.php"],
    });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      git,
    );
    const repeat = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      git,
    );

    // The §12 drift observation: STALE context, baseline → HEAD, the
    // re-understand instruction and P06's own per-path reasons, verbatim.
    expect(report).toContain("  Context: STALE");
    expect(report).toContain("  Baseline: abc123 → HEAD 9f8e7d6 (branch: main, clean)");
    expect(report).toContain("  Re-understand the described scope before continuing.");
    expect(report).toContain("  - src/attendance/PunchService.php changed since baseline 'abc123'");
    expect(report).toContain("  - tests/PunchServiceTest.php changed since baseline 'abc123'");
    // Repeated execution remains deterministic.
    expect(repeat.report).toBe(report);
    // Observation only: drift adds no problems, so the status exit code is
    // unchanged — the sole problem is the v2 workflow-adoption one.
    expect(problems).toEqual([
      "Plan punch requires workflow 'bug-fix', but that workflow is not adopted.",
    ]);
  });

  it("Plan drift (Scenario B): a repository move outside the described scope never produces drift", async () => {
    const dir = await tmp();
    await contextStore.saveAnalysis(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDoc("abc123", ["src/attendance/"]),
    );
    const git = new FakeContextGit({
      repo: { root: dir, branch: "main", dirty: false, commit: "9f8e7d6" },
      headFull: "head-full",
      resolve: { abc123: "base-full" },
      changed: [],
    });

    const { report, problems } = await buildStatusReport(
      dir,
      analysis(dir),
      manifest,
      planStore,
      contextStore,
      git,
    );

    // The plan stays CURRENT/TRUSTED (§6.3): no drift observation and no
    // re-understand instruction. The one stale count is the unscoped
    // repository-analysis control row (conservative §6.1 granularity), not
    // the scoped plan.
    expect(report).not.toContain("Context: STALE");
    expect(report).not.toContain("Re-understand the described scope");
    expect(report).toContain("  Current   1");
    expect(report).toContain("  Stale     1");
    expect(problems).toEqual([
      "Plan punch requires workflow 'bug-fix', but that workflow is not adopted.",
    ]);
  });
});

describe("buildVerifyReport", () => {
  /**
   * Git stub: HEAD tagged (release evidence) per flag. The integrity probes
   * (P09 plan drift) fail safe: a plan without a resolvable repository state
   * can never evaluate STALE, so no drift is rendered for these fixtures.
   */
  const git = (tagged: boolean): VerifyGit & IntegrityGit => ({
    headTagged: async () => tagged,
    detect: async () => null,
    revParse: async () => null,
    isAncestor: async () => false,
    changedPathsSince: async () => [],
    pathExistsAtHead: async () => false,
  });

  it("reports READY when the plan records every required evidence", async () => {
    const dir = await tmp();
    await adoptWorkflow(
      dir,
      "bug-fix",
      "adopted",
      workflowWithEvidence("bug-fix", ["tests", "verification", "commit"]),
    );
    await writePlan(dir, {
      id: "punch-sync",
      method: "bug-fix",
      status: "TESTED",
      sections: {
        "Acceptance Criteria": "- Punch sync verified on device.",
        Verification: "typecheck passed; lint passed",
        "Test Evidence": "19 tests / 38 assertions passed",
        Commit: "abc1234 on main",
      },
    });

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, git(false));

    expect(problems).toEqual([]);
    expect(report).toContain("DoozCTL Verify");
    expect(report).toContain("ID: punch-sync");
    expect(report).toContain("Method: bug-fix");
    expect(report).toContain("Status: TESTED");
    expect(report).toContain("Tests                 ✓");
    expect(report).toContain("Verification          ✓");
    expect(report).toContain("Commit                ✓");
    expect(report).toContain("Result\n  READY");
  });

  it("reports NOT READY with the missing evidence list", async () => {
    const dir = await tmp();
    await adoptWorkflow(
      dir,
      "bug-fix",
      "adopted",
      workflowWithEvidence("bug-fix", ["tests", "verification", "commit"]),
    );
    await writePlan(dir, { id: "punch-sync", method: "bug-fix", status: "EXECUTING" });

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, git(false));

    expect(problems).not.toEqual([]);
    expect(report).toContain("Tests                 ✗");
    expect(report).toContain("Verification          ✗");
    expect(report).toContain("Commit                ✗");
    expect(report).toContain("Result\n  NOT READY");
    expect(report).toContain("Missing:\n  Tests\n  Verification\n  Commit");
  });

  it("checks acceptance criteria against the plan section", async () => {
    const dir = await tmp();
    await adoptWorkflow(
      dir,
      "feature",
      "adopted",
      workflowWithEvidence("feature", ["acceptance-criteria"]),
    );
    await writePlan(dir, {
      id: "feature",
      method: "feature",
      status: "EXECUTING",
      sections: { "Acceptance Criteria": "- Works." },
    });

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, git(false));

    expect(problems).toEqual([]);
    expect(report).toContain("Acceptance criteria   ✓");
  });

  it("annotates the tests row with the repository's test facts", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix", "adopted", workflowWithEvidence("bug-fix", ["tests"]));
    await writePlan(dir, {
      id: "punch-sync",
      method: "bug-fix",
      status: "TESTED",
      sections: { "Test Evidence": "19 tests passed" },
    });
    const facts = {
      testFramework: "vitest" as const,
      statistics: { totalFiles: 20, sourceFiles: 8, testFiles: 12 },
    };

    const recorded = await buildVerifyReport(dir, analysis(dir, facts), planStore, git(false));
    expect(recorded.report).toContain("Tests                 ✓  vitest · 12 test files");

    // The same facts annotate a missing-evidence row — the juxtaposition is
    // exactly the signal an engineer needs.
    const empty = await tmp();
    await adoptWorkflow(empty, "bug-fix", "adopted", workflowWithEvidence("bug-fix", ["tests"]));
    await writePlan(empty, { id: "punch-sync", method: "bug-fix", status: "EXECUTING" });
    const missing = await buildVerifyReport(empty, analysis(empty, facts), planStore, git(false));
    expect(missing.report).toContain("Tests                 ✗  vitest · 12 test files");
  });

  it("leaves the tests row unannotated when no test facts are detected", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix", "adopted", workflowWithEvidence("bug-fix", ["tests"]));
    await writePlan(dir, {
      id: "punch-sync",
      method: "bug-fix",
      status: "TESTED",
      sections: { "Test Evidence": "manual verification only" },
    });

    const { report } = await buildVerifyReport(dir, analysis(dir), planStore, git(false));

    expect(report).toContain("Tests                 ✓ (recorded, not verified against HEAD)");
  });

  it("derives git-state from repository facts and release from a tag on HEAD", async () => {
    const dir = await tmp();
    await adoptWorkflow(
      dir,
      "release",
      "adopted",
      workflowWithEvidence("release", ["git-state", "release"]),
    );
    await writePlan(dir, { id: "release", method: "release", status: "TESTED" });

    const tagged = await buildVerifyReport(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
      planStore,
      git(true),
    );
    expect(tagged.problems).toEqual([]);
    expect(tagged.report).toContain("Git state             ✓");
    expect(tagged.report).toContain("Release               ✓");

    const untagged = await buildVerifyReport(dir, analysis(dir), planStore, git(false));
    expect(untagged.problems).not.toEqual([]);
    expect(untagged.report).toContain("Git state             ✗");
    expect(untagged.report).toContain("Release               ✗");
    expect(untagged.report).toContain("Missing:\n  Git repository\n  Release tag");
  });

  it("lists manual evidence without letting it gate the result", async () => {
    const dir = await tmp();
    await adoptWorkflow(
      dir,
      "bug-fix",
      "adopted",
      workflowWithEvidence("bug-fix", ["tests"], ["Root cause identified and recorded"]),
    );
    await writePlan(dir, {
      id: "punch-sync",
      method: "bug-fix",
      status: "TESTED",
      sections: { "Test Evidence": "regression test added" },
    });

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, git(false));

    expect(problems).toEqual([]);
    expect(report).toContain("Manual evidence (not machine-checked):");
    expect(report).toContain("- Root cause identified and recorded");
    expect(report).toContain("Result\n  READY");
  });

  it("reports a workflow that declares no required evidence", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "triage", "adopted", workflowContent("triage"));
    await writePlan(dir, { id: "triage", method: "triage", status: "PLANNED" });

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, git(false));

    expect(problems).toEqual([]);
    expect(report).toContain("Workflow declares no required evidence.");
    expect(report).toContain("Result\n  READY");
  });

  it("reports no active plan as NOT READY", async () => {
    const dir = await tmp();
    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, git(false));

    expect(problems).not.toEqual([]);
    expect(report).toContain("Plan\n  None");
    expect(report).toContain("No active plan to verify.");
    expect(report).toContain("Result\n  NOT READY");
  });

  it("reports multiple active plans without selecting one", async () => {
    const dir = await tmp();
    await writePlan(dir, { id: "plan-a", method: "bug-fix", status: "EXECUTING" });
    await writePlan(dir, {
      id: "plan-b",
      method: "feature",
      status: "PLANNED",
      created: "2026-08-10",
    });

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, git(false));

    expect(problems).not.toEqual([]);
    expect(report).toContain("Multiple active plans found:");
    expect(report).toContain("plan-a — bug-fix (EXECUTING)");
    expect(report).toContain("Resolve the ambiguity before continuing.");
  });

  it("reports a malformed active plan", async () => {
    const dir = await tmp();
    const active = path.join(dir, ".dooz", "plans", "active");
    await mkdir(active, { recursive: true });
    await writeFile(path.join(active, "2026-08-09-broken.md"), "# Broken\nno metadata\n", "utf-8");

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, git(false));

    expect(problems).not.toEqual([]);
    expect(report).toContain("Plan broken is invalid:");
  });

  it("reports a missing adopted workflow", async () => {
    const dir = await tmp();
    await writePlan(dir, { id: "punch-sync", method: "bug-fix", status: "EXECUTING" });

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, git(false));

    expect(problems).not.toEqual([]);
    expect(report).toContain(
      "Plan punch-sync requires workflow 'bug-fix', but that workflow is not adopted.",
    );
  });

  it("reports an invalid evidence requirement in the workflow", async () => {
    const dir = await tmp();
    await adoptWorkflow(
      dir,
      "bug-fix",
      "adopted",
      workflowWithEvidence("bug-fix", ["tests", "tsets"]),
    );
    await writePlan(dir, { id: "punch-sync", method: "bug-fix", status: "EXECUTING" });

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, git(false));

    expect(problems).not.toEqual([]);
    expect(report).toContain(
      "Plan punch-sync uses workflow 'bug-fix', which declares an invalid evidence requirement: tsets.",
    );
  });

  it("checks changelog and version evidence at the paths the workflow declares", async () => {
    const dir = await tmp();
    await adoptWorkflow(
      dir,
      "release",
      "adopted",
      workflowWithEvidence("release", ["changelog: CHANGELOG.md", "version: package.json"]),
    );
    await writePlan(dir, { id: "august-release", method: "release", status: "TESTED" });
    await writeFile(path.join(dir, "CHANGELOG.md"), "# Changelog\n\n## 1.2.3\n- Fixed.\n");
    await writeFile(path.join(dir, "package.json"), '{\n  "version": "1.2.3"\n}\n');

    const ready = await buildVerifyReport(dir, analysis(dir), planStore, git(false));
    expect(ready.problems).toEqual([]);
    expect(ready.report).toContain("Changelog             ✓");
    expect(ready.report).toContain("Version               ✓");

    // An empty changelog records no evidence; a version file without a
    // semantic version does not count.
    await writeFile(path.join(dir, "CHANGELOG.md"), "");
    await writeFile(path.join(dir, "package.json"), '{\n  "name": "x"\n}\n');
    const missing = await buildVerifyReport(dir, analysis(dir), planStore, git(false));
    expect(missing.problems).not.toEqual([]);
    expect(missing.report).toContain(
      "Missing:\n  Changelog (CHANGELOG.md)\n  Version (package.json)",
    );
  });

  it("reports a traversal path declaration as an invalid evidence requirement", async () => {
    const dir = await tmp();
    await adoptWorkflow(
      dir,
      "bug-fix",
      "adopted",
      workflowWithEvidence("bug-fix", ["changelog: ../escape.md"]),
    );
    await writePlan(dir, { id: "punch-sync", method: "bug-fix", status: "EXECUTING" });

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, git(false));

    expect(problems).not.toEqual([]);
    expect(report).toContain("invalid evidence requirement: changelog: ../escape.md");
  });

  it("Plan drift (Scenario A): verify carries the §12 observation for a STALE plan without changing the result", async () => {
    const dir = await tmp();
    await adoptWorkflow(
      dir,
      "bug-fix",
      "adopted",
      workflowWithEvidence("bug-fix", ["tests", "verification", "commit"]),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDoc("abc123", ["src/attendance/"]),
    );
    const driftGit: VerifyGit & IntegrityGit = {
      headTagged: async () => false,
      detect: async () => ({ root: dir, branch: "main", dirty: false, commit: "9f8e7d6" }),
      revParse: async (_dir, rev) => (rev === "HEAD" ? "head-full" : "base-full"),
      isAncestor: async () => true,
      changedPathsSince: async () => ["src/attendance/PunchService.php"],
      pathExistsAtHead: async () => true,
    };

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, driftGit);

    // The §12 drift observation rides on the same P06 evaluation that grounds
    // the context rows — never a second freshness mechanism.
    expect(report).toContain("  Context: STALE");
    expect(report).toContain("  Baseline: abc123 → HEAD 9f8e7d6 (branch: main, clean)");
    expect(report).toContain("  Re-understand the described scope before continuing.");
    expect(report).toContain("  - src/attendance/PunchService.php changed since baseline 'abc123'");
    // Observation only: the result and its problems stay exactly the
    // evidence-driven ones — drift never gates READY/NOT READY (P10 settles
    // that interaction).
    expect(report).toContain("Result\n  NOT READY");
    expect(problems).toEqual(["evidence incomplete: Tests, Verification, Commit"]);
  });

  it("Plan drift (Scenario B): verify never drifts a plan whose repository moved outside its described scope", async () => {
    const dir = await tmp();
    await adoptWorkflow(
      dir,
      "bug-fix",
      "adopted",
      workflowWithEvidence("bug-fix", ["tests", "verification", "commit"]),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDoc("abc123", ["src/attendance/"]),
    );
    const driftGit: VerifyGit & IntegrityGit = {
      headTagged: async () => false,
      detect: async () => ({ root: dir, branch: "main", dirty: false, commit: "9f8e7d6" }),
      revParse: async (_dir, rev) => (rev === "HEAD" ? "head-full" : "base-full"),
      isAncestor: async () => true,
      changedPathsSince: async () => [],
      pathExistsAtHead: async () => true,
    };

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, driftGit);

    // CURRENT/TRUSTED under a moved tip (§6.3): no drift observation, and the
    // evidence result is unchanged.
    expect(report).not.toContain("Context: STALE");
    expect(report).not.toContain("Re-understand the described scope");
    expect(report).toContain("Result\n  NOT READY");
    expect(problems).toEqual(["evidence incomplete: Tests, Verification, Commit"]);
  });

  it("Evidence grounding: every row carries its qualifier and a CURRENT plan records nothing stale", async () => {
    const dir = await tmp();
    await adoptWorkflow(
      dir,
      "bug-fix",
      "adopted",
      workflowWithEvidence("bug-fix", ["tests", "verification", "commit", "git-state"]),
    );
    // Plan baselined at the current tip → TRUSTED, evidence recorded; the
    // `## Commit` row is present prose with no hash (S4 has nothing to probe).
    const doc = baselinedDocReady("abc123").replace(
      "## Commit\n\n## Next Action",
      "## Commit\n\nmerged to main\n\n## Next Action",
    );
    await writeDoc(dir, [".dooz", "plans", "active", "2026-08-09-punch.md"], doc);
    const tipGit: VerifyGit & IntegrityGit = {
      headTagged: async () => false,
      detect: async () => ({ root: dir, branch: "main", dirty: false, commit: "9f8e7d6" }),
      revParse: async () => "head-full",
      isAncestor: async () => true,
      changedPathsSince: async () => [],
      pathExistsAtHead: async () => true,
    };

    const { report, problems } = await buildVerifyReport(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
      planStore,
      tipGit,
    );

    // LIVE rows ground in the current repository; RECORDED rows (and the
    // hashless commit row) admit they are records, not HEAD verification.
    expect(report).toContain("Git state             ✓ (LIVE)");
    expect(report).toContain("Tests                 ✓ (recorded, not verified against HEAD)");
    expect(report).toContain("Verification          ✓ (recorded, not verified against HEAD)");
    expect(report).toContain("Commit                ✓ (recorded, not verified against HEAD)");
    expect(report).not.toContain("STALE-BASELINE");
    // Qualifiers are annotations: the presence-driven result is unchanged.
    expect(report).toContain("Result\n  READY");
    expect(problems).toEqual([]);
  });

  it("Evidence grounding: a STALE plan demotes its recorded rows to STALE-BASELINE; LIVE rows stay LIVE", async () => {
    const dir = await tmp();
    await adoptWorkflow(
      dir,
      "bug-fix",
      "adopted",
      workflowWithEvidence("bug-fix", ["tests", "verification", "commit", "git-state"]),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDoc("abc123", ["src/attendance/"]),
    );
    const staleGit: VerifyGit & IntegrityGit = {
      headTagged: async () => false,
      detect: async () => ({ root: dir, branch: "main", dirty: false, commit: "9f8e7d6" }),
      revParse: async (_dir, rev) => (rev === "HEAD" ? "head-full" : "base-full"),
      isAncestor: async () => true,
      changedPathsSince: async () => ["src/attendance/PunchService.php"],
      pathExistsAtHead: async () => true,
    };

    const { report, problems } = await buildVerifyReport(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
      planStore,
      staleGit,
    );

    // §11.2 rule 2: recorded evidence inherits the plan's STALE trust state.
    // The LIVE row still grounds in the current repository.
    expect(report).toContain("Tests                 ✗ (STALE-BASELINE)");
    expect(report).toContain("Verification          ✗ (STALE-BASELINE)");
    expect(report).toContain("Commit                ✗ (STALE-BASELINE)");
    expect(report).toContain("Git state             ✓ (LIVE)");
    // Demotion is an annotation: presence alone still gates the result.
    expect(report).toContain("Result\n  NOT READY");
    expect(problems).toEqual(["evidence incomplete: Tests, Verification, Commit"]);
  });

  it("Evidence grounding (S4): a ## Commit hash at the current tip reports current", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix", "adopted", workflowWithEvidence("bug-fix", ["commit"]));
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDocWithCommit("abc123", "abc1234 on main"),
    );
    const tipGit: VerifyGit & IntegrityGit = {
      headTagged: async () => false,
      detect: async () => ({ root: dir, branch: "main", dirty: false, commit: "9f8e7d6" }),
      revParse: async () => "head-full",
      isAncestor: async () => true,
      changedPathsSince: async () => [],
      pathExistsAtHead: async () => true,
    };

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, tipGit);

    expect(report).toContain("Commit                ✓ (current)");
    expect(report).toContain("Result\n  READY");
    expect(problems).toEqual([]);
  });

  it("Evidence grounding (S4): a reachable but older ## Commit hash is recorded, not current", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix", "adopted", workflowWithEvidence("bug-fix", ["commit"]));
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDocWithCommit("abc123", "abc1234 on main"),
    );
    // Plan baseline at the tip; the recorded commit is an older ancestor.
    const olderGit: VerifyGit & IntegrityGit = {
      headTagged: async () => false,
      detect: async () => ({ root: dir, branch: "main", dirty: false, commit: "9f8e7d6" }),
      revParse: async (_dir, rev) => (rev === "abc1234" ? "base-full" : "head-full"),
      isAncestor: async () => true,
      changedPathsSince: async () => [],
      pathExistsAtHead: async () => true,
    };

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, olderGit);

    expect(report).toContain("Commit                ✓ (recorded, not current)");
    expect(report).not.toContain("STALE-BASELINE");
    expect(problems).toEqual([]);
  });

  it("Evidence grounding (S4): an unreachable ## Commit hash is STALE-BASELINE", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix", "adopted", workflowWithEvidence("bug-fix", ["commit"]));
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDocWithCommit("abc123", "abc1234 on main"),
    );
    // Plan baseline at the tip; the recorded commit resolves to nothing.
    const lostGit: VerifyGit & IntegrityGit = {
      headTagged: async () => false,
      detect: async () => ({ root: dir, branch: "main", dirty: false, commit: "9f8e7d6" }),
      revParse: async (_dir, rev) => (rev === "abc1234" ? null : "head-full"),
      isAncestor: async () => false,
      changedPathsSince: async () => [],
      pathExistsAtHead: async () => true,
    };

    const { report, problems } = await buildVerifyReport(dir, analysis(dir), planStore, lostGit);

    expect(report).toContain("Commit                ✓ (STALE-BASELINE)");
    // Annotation only: presence alone still gates the result.
    expect(report).toContain("Result\n  READY");
    expect(problems).toEqual([]);
  });
});

/** A plan/session-style document with a baseline and optional scope paths. */
function baselinedDoc(commit: string, scopePaths: string[] = []): string {
  return renderPlan({ id: "punch", method: "bug-fix" }, "2026-08-13", {
    commit,
    branch: "main",
    dirty: "no",
    source: "none",
    ownership: "mixed",
    scopePaths,
  });
}

/** A baselined plan document with recorded text in its `## Commit` section. */
function baselinedDocWithCommit(
  commit: string,
  commitText: string,
  scopePaths: string[] = [],
): string {
  return baselinedDoc(commit, scopePaths).replace(
    "## Commit\n\n## Next Action",
    `## Commit\n\n${commitText}\n\n## Next Action`,
  );
}

/** A baselined plan document whose recorded evidence sections are filled. */
function baselinedDocReady(commit: string, scopePaths: string[] = []): string {
  return baselinedDoc(commit, scopePaths)
    .replace(
      "## Verification\n\n## Test Evidence",
      "## Verification\n\ntypecheck passed\n\n## Test Evidence",
    )
    .replace(
      "## Test Evidence\n\n## Decisions",
      "## Test Evidence\n\n19 tests passed\n\n## Decisions",
    );
}

/** A fake git satisfying the integrity engine's read-only surface. */
class FakeContextGit implements IntegrityGit {
  constructor(
    private readonly opts: {
      repo?: RepositoryInfo | null;
      headFull?: string;
      resolve?: Record<string, string>;
      ancestor?: boolean;
      changed?: string[];
      exists?: () => boolean;
    } = {},
  ) {}

  async detect(): Promise<RepositoryInfo | null> {
    return this.opts.repo ?? { root: "/repo", branch: "main", dirty: false, commit: "h" };
  }

  async revParse(_dir: string, rev: string): Promise<string | null> {
    if (rev === "HEAD") {
      return this.opts.headFull ?? "head-full";
    }
    return this.opts.resolve?.[rev] ?? "base-full";
  }

  async isAncestor(): Promise<boolean> {
    return this.opts.ancestor ?? true;
  }

  async changedPathsSince(): Promise<string[]> {
    return this.opts.changed ?? [];
  }

  async pathExistsAtHead(): Promise<boolean> {
    return this.opts.exists?.() ?? true;
  }
}

const contextStore = new RepositoryStore();

/** Write a doc under the temp repo, creating parent directories. */
async function writeDoc(dir: string, parts: string[], content: string): Promise<void> {
  await mkdir(path.join(dir, ...parts.slice(0, -1)), { recursive: true });
  await writeFile(path.join(dir, ...parts), content, "utf-8");
}

describe("buildContextValidateReport", () => {
  it("reports TRUSTED artifacts grounded at the current tip with no problems", async () => {
    const dir = await tmp();
    await contextStore.saveAnalysis(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDoc("abc123"),
    );
    await writeDoc(dir, [".ai", "sessions", "2026-08-09_093000.md"], baselinedDoc("abc123"));
    const git = new FakeContextGit({ headFull: "full", resolve: { abc123: "full" } });

    const { report, problems } = await buildContextValidateReport(
      dir,
      planStore,
      contextStore,
      git,
    );

    expect(problems).toEqual([]);
    expect(report).toContain("Context Integrity");
    expect(report).toContain("✓ repository-analysis.json — TRUSTED");
    expect(report).toContain("✓ plans/active/2026-08-09-punch.md — TRUSTED");
    expect(report).toContain("✓ sessions/2026-08-09_093000.md — TRUSTED");
    expect(report).toContain("Result: 0 stale, 0 unknown, 0 invalid");
  });

  it("reports UNKNOWN rows as informational with no problems (D1 safety property)", async () => {
    const dir = await tmp();
    // Legacy analysis without a commit, and a v2 plan without a baseline.
    await contextStore.saveAnalysis(dir, analysis(dir));
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-legacy.md"],
      renderPlan({ id: "legacy", method: "bug-fix" }, "2026-08-13"),
    );

    const { report, problems } = await buildContextValidateReport(
      dir,
      planStore,
      contextStore,
      new FakeContextGit(),
    );

    expect(problems).toEqual([]); // UNKNOWN never fails the command
    expect(report).toContain("? repository-analysis.json — UNKNOWN");
    expect(report).toContain("? plans/active/2026-08-09-legacy.md — UNKNOWN");
    expect(report).toContain("Result: 0 stale, 2 unknown, 0 invalid");
  });

  it("Scenario B: an unrelated change reports TRUSTED with the outside-scope note", async () => {
    const dir = await tmp();
    await contextStore.saveAnalysis(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDoc("a1b2c3d", ["src/attendance/"]),
    );
    const git = new FakeContextGit({ headFull: "full", resolve: { abc123: "full" }, changed: [] });

    const { report, problems } = await buildContextValidateReport(
      dir,
      planStore,
      contextStore,
      git,
    );

    expect(problems).toEqual([]);
    expect(report).toContain("✓ plans/active/2026-08-09-punch.md — TRUSTED");
    expect(report).toContain("    repository moved outside described scope");
  });

  it("Scenario A: an in-scope change reports STALE with the path reason and a problem", async () => {
    const dir = await tmp();
    await contextStore.saveAnalysis(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDoc("a1b2c3d", ["src/attendance/"]),
    );
    const git = new FakeContextGit({
      headFull: "full",
      resolve: { abc123: "full" },
      changed: ["src/attendance/PunchService.php"],
    });

    const { report, problems } = await buildContextValidateReport(
      dir,
      planStore,
      contextStore,
      git,
    );

    expect(problems).toEqual(["stale: plans/active/2026-08-09-punch.md"]);
    expect(report).toContain("⚠ plans/active/2026-08-09-punch.md — STALE");
    expect(report).toContain(
      "    src/attendance/PunchService.php changed since baseline 'a1b2c3d'",
    );
    expect(report).toContain("Result: 1 stale, 0 unknown, 0 invalid");
  });

  it("reports an unreachable baseline as INVALID with a problem", async () => {
    const dir = await tmp();
    await contextStore.saveAnalysis(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-orphan.md"],
      baselinedDoc("deadbeef"),
    );
    const git = new FakeContextGit({
      headFull: "full",
      resolve: { abc123: "full" },
      ancestor: false,
    });

    const { report, problems } = await buildContextValidateReport(
      dir,
      planStore,
      contextStore,
      git,
    );

    expect(problems).toEqual(["invalid: plans/active/2026-08-09-orphan.md"]);
    expect(report).toContain("✗ plans/active/2026-08-09-orphan.md — INVALID");
    expect(report).toContain(
      "    baseline commit 'deadbeef' is not in the current repository history",
    );
  });

  it("reports an unreadable analysis as INVALID rather than skipping it", async () => {
    const dir = await tmp();
    await writeDoc(dir, [".ai", "repository-analysis.json"], "{ not json");

    const { report, problems } = await buildContextValidateReport(
      dir,
      planStore,
      contextStore,
      new FakeContextGit(),
    );

    expect(problems).toEqual(["invalid: repository-analysis.json"]);
    expect(report).toContain("✗ repository-analysis.json — INVALID");
    expect(report).toContain("    cannot read repository-analysis.json");
  });

  it("inventories current-context and completed plans with sorted deterministic rows", async () => {
    const dir = await tmp();
    await contextStore.saveAnalysis(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
    );
    await writeDoc(dir, [".ai", "current-context.md"], baselinedDoc("abc123"));
    await writeDoc(
      dir,
      [".dooz", "plans", "completed", "2026-08-01-done.md"],
      baselinedDoc("abc123"),
    );

    const git = new FakeContextGit({ headFull: "full", resolve: { abc123: "full" } });
    const { report, problems } = await buildContextValidateReport(
      dir,
      planStore,
      contextStore,
      git,
    );

    expect(problems).toEqual([]);
    expect(report).toContain("✓ current-context.md — TRUSTED");
    expect(report).toContain("✓ plans/completed/2026-08-01-done.md — TRUSTED");
    expect(report.indexOf("current-context.md")).toBeLessThan(
      report.indexOf("plans/completed/2026-08-01-done.md"),
    );
  });

  it("evaluation is deterministic for the same repository state", async () => {
    const dir = await tmp();
    await contextStore.saveAnalysis(
      dir,
      analysis(dir, {
        git: { isRepository: true, branch: "main", dirty: false, commit: "abc123" },
      }),
    );
    await writeDoc(
      dir,
      [".dooz", "plans", "active", "2026-08-09-punch.md"],
      baselinedDoc("a1b2c3d", ["src/attendance/"]),
    );
    const a = await buildContextValidateReport(dir, planStore, contextStore, new FakeContextGit());
    const b = await buildContextValidateReport(dir, planStore, contextStore, new FakeContextGit());
    expect(a).toEqual(b);
  });
});
