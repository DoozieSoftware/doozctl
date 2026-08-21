import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Analysis, Manifest } from "../model/model.js";
import { PlanStore } from "../store/plan-store.js";
import { buildStatusReport, buildVerifyReport } from "./report.js";

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
    );

    expect(report).toContain("Tests: vitest · 12 test files");
  });

  it("omits the test facts line when no test framework or files are detected", async () => {
    const dir = await tmp();
    const { report } = await buildStatusReport(dir, analysis(dir), manifest, planStore);

    expect(report).not.toContain("Tests:");
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

describe("buildVerifyReport", () => {
  /** Git stub: HEAD tagged (release evidence) per flag. */
  const git = (tagged: boolean) => ({ headTagged: async () => tagged });

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

    expect(report).toContain("Tests                 ✓\n");
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
      analysis(dir, { git: { isRepository: true, branch: "main", dirty: false } }),
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
});
