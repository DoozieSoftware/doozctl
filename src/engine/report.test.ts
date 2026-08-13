import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Analysis, Manifest } from "../model/model.js";
import { PlanStore } from "../store/plan-store.js";
import { buildStatusReport } from "./report.js";

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
    git: { isRepository: false, branch: null, dirty: false },
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
  if (plan.nextAction !== undefined) {
    body.push("", "## Next Action", "", plan.nextAction);
  }
  await writeFile(path.join(active, `${created}-${plan.id}.md`), body.join("\n"), "utf-8");
}

const planStore = new PlanStore({ now: () => new Date(2026, 7, 9, 9, 30, 0) });

describe("buildStatusReport", () => {
  it("reports repository and control-plane facts with no active plan", async () => {
    const dir = await tmp();
    const { report, problems } = await buildStatusReport(dir, analysis(dir), manifest, planStore);

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
      analysis(dir, { git: { isRepository: true, branch: "main", dirty: false } }),
      manifest,
      planStore,
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
      analysis(dir, { git: { isRepository: true, branch: "main", dirty: true } }),
      manifest,
      planStore,
    );

    expect(report).toContain("Git: dirty");
  });

  it("derives only reached stages from the lifecycle and never over-claims", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "feature");
    await writePlan(dir, { id: "feature", method: "feature", status: "VERIFIED" });

    const { report, problems } = await buildStatusReport(dir, analysis(dir), manifest, planStore);

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

    const { report } = await buildStatusReport(dir, analysis(dir), manifest, planStore);

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

    const { report, problems } = await buildStatusReport(dir, analysis(dir), manifest, planStore);

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

    const { report, problems } = await buildStatusReport(dir, analysis(dir), manifest, planStore);

    expect(problems).not.toEqual([]);
    expect(report).toContain("Plan broken is invalid:");
    expect(report).not.toContain("at ");
  });

  it("reports a missing adopted workflow", async () => {
    const dir = await tmp();
    await writePlan(dir, { id: "attendance-punch-sync", method: "bug-fix", status: "EXECUTING" });

    const { report, problems } = await buildStatusReport(dir, analysis(dir), manifest, planStore);

    expect(problems).not.toEqual([]);
    expect(report).toContain(
      "Plan attendance-punch-sync requires workflow 'bug-fix', but that workflow is not adopted.",
    );
  });

  it("reports a malformed adopted workflow", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix", "adopted", "# bug-fix\nno metadata\n");
    await writePlan(dir, { id: "attendance-punch-sync", method: "bug-fix", status: "EXECUTING" });

    const { report, problems } = await buildStatusReport(dir, analysis(dir), manifest, planStore);

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

    const { report, problems } = await buildStatusReport(dir, analysis(dir), manifest, planStore);

    expect(problems).not.toEqual([]);
    expect(report).toContain(
      "Plan attendance-punch-sync requires workflow 'bug-fix', but it is adopted in both adopted/ and project/.",
    );
  });

  it("reports an invalid workflow method id declared by the plan", async () => {
    const dir = await tmp();
    await writePlan(dir, { id: "sneaky", method: "../escape", status: "PLANNED" });

    const { report, problems } = await buildStatusReport(dir, analysis(dir), manifest, planStore);

    expect(problems).not.toEqual([]);
    expect(report).toContain("Plan sneaky declares an invalid workflow method: '../escape'.");
  });

  it("shows no next lifecycle state for an abandoned plan", async () => {
    const dir = await tmp();
    await writePlan(dir, { id: "old", method: "standard", status: "ABANDONED" });

    const { report } = await buildStatusReport(dir, analysis(dir), manifest, planStore);

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

    const { report, problems } = await buildStatusReport(dir, analysis(dir), manifest, planStore);

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

    const { report, problems } = await buildStatusReport(dir, analysis(dir), manifest, planStore);

    expect(problems).toEqual([]);
    expect(report).toContain("ID: feature");
  });
});
