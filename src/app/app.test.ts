import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { App, type AppDeps } from "./app.js";
import { Engine } from "../engine/engine.js";
import {
  builtinMergers,
  DefaultAnalyzer,
  DefaultStandardsLoader,
  DefaultValidator,
} from "../engine/contracts.js";
import { GitService } from "../infra/git/git.js";
import { RepositoryStore } from "../store/repository-store.js";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "doozctl-app-"));
  dirs.push(dir);
  return dir;
}

/** Create a Standards Package declaring one managed-blocks artifact. */
async function writePackage(pkg: string): Promise<void> {
  await writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({
      format: 2,
      name: "@dooziesoft/standards",
      version: "1.0.0",
      engine: ">=1.0.0",
      artifacts: [
        {
          id: "agents",
          source: "artifacts/AGENTS.md",
          destination: "AGENTS.md",
          merge: "managed-blocks",
          lifecycle: ["init", "sync"],
        },
      ],
    }),
  );
  await mkdir(path.join(pkg, "artifacts"), { recursive: true });
  await writeFile(
    path.join(pkg, "artifacts", "AGENTS.md"),
    [
      "# AGENTS",
      "",
      "<!-- DOOZCTL:BEGIN:v1 repository-analysis -->",
      "",
      "Lang: {{analysis.language}}",
      "",
      "<!-- DOOZCTL:END:v1 repository-analysis -->",
    ].join("\n"),
    "utf-8",
  );
}

function buildDeps(): { deps: AppDeps; printed: string[] } {
  const git = new GitService();
  const printed: string[] = [];
  return {
    printed,
    deps: {
      git,
      store: new RepositoryStore(),
      analyzer: new DefaultAnalyzer(git),
      loader: new DefaultStandardsLoader(),
      validator: new DefaultValidator(),
      mergers: builtinMergers(),
      print: (message) => printed.push(message),
      now: () => new Date(2026, 7, 9, 9, 30, 0),
    },
  };
}

/** Fake engine that records runs instead of executing scaffolding steps. */
function spyEngine() {
  const calls: { root: string; steps: string[] }[] = [];
  const engine = {
    run: async (opts: { root: string; standardsDir: string }, steps: Array<{ name?: string }>) => {
      calls.push({ root: opts.root, steps: steps.map((s) => s.name ?? "?") });
      return { doctorProblems: [] };
    },
  } as unknown as Engine;
  return { engine, calls };
}

/** Adopt a workflow document into the temp repository's control plane. */
async function adoptWorkflowForStatus(dir: string, id: string): Promise<void> {
  const base = path.join(dir, ".dooz", "workflows", "adopted");
  await mkdir(base, { recursive: true });
  const content = [
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
  await writeFile(path.join(base, `${id}.md`), content, "utf-8");
}

/** Write a valid plan document into `.dooz/plans/active/` with the given state. */
async function writeActivePlan(
  dir: string,
  plan: {
    id: string;
    method: string;
    status: string;
    created: string;
    nextAction?: string;
  },
): Promise<void> {
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
    `- created: ${plan.created}`,
  ];
  if (plan.nextAction !== undefined) {
    body.push("", "## Next Action", "", plan.nextAction);
  }
  await writeFile(path.join(active, `${plan.created}-${plan.id}.md`), body.join("\n"), "utf-8");
}

describe("App", () => {
  it("routes init through the full pipeline and prints a report", async () => {
    const { engine, calls } = spyEngine();
    const { deps, printed } = buildDeps();
    const app = new App(engine, deps);
    const code = await app.init(["/tmp/repo", "/tmp/pkg"]);
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.root).toBe("/tmp/repo");
    expect(calls[0]?.steps).toEqual([
      "analyzeStep",
      "loadStep",
      "lifecycleStep",
      "resolveVariablesStep",
      "renderStep",
      "mergeStep",
      "validateStep",
      "writeStep",
    ]);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain("Repository initialized: /tmp/repo");
    expect(printed[0]).toContain(".dooz/manifest.json");
    expect(printed[0]).toContain(".ai/repository-analysis.json");
  });

  it("fails fast before running any step when init is missing arguments", async () => {
    const { engine, calls } = spyEngine();
    const app = new App(engine, buildDeps().deps);

    await expect(app.init([])).rejects.toThrow(/Usage:\s+doozctl init <repo> <package>/);
    await expect(app.init(["/tmp/repo"])).rejects.toThrow(/Usage:\s+doozctl init <repo> <package>/);
    expect(calls).toHaveLength(0);
  });

  it("routes each command to its own pipeline", async () => {
    const { engine, calls } = spyEngine();
    const app = new App(engine, buildDeps().deps);

    const repo = await tmp();
    const pkg = await tmp();
    await writePackage(pkg);
    const sessionFile = path.join(repo, "session.md");
    await writeFile(sessionFile, "## Summary\ndone\n", "utf-8");

    await (app.analyze as (args: string[]) => Promise<number>)([repo]);
    await (app.doctor as (args: string[]) => Promise<number>)([repo, pkg]);
    await app.summarize([repo, pkg, sessionFile]);
    await app.sync([repo, pkg]);

    const executed = calls.map((c) => c.steps);
    expect(executed).toEqual([
      ["loadStateStep", "analyzeStep", "saveAnalysisStep"],
      ["loadStateStep", "loadStep", "analyzeStep", "reportStep"],
      [
        "loadStateStep",
        "loadStep",
        "lifecycleStep",
        "resolveVariablesStep",
        "sessionStep",
        "resolveDestinationStep",
        "renderStep",
        "mergeStep",
        "validateStep",
        "writeStep",
      ],
      [
        "loadStateStep",
        "loadStep",
        "lifecycleStep",
        "resolveVariablesStep",
        "renderStep",
        "mergeStep",
        "validateStep",
        "writeStep",
      ],
    ]);
  });

  it("fails fast when summarize is missing arguments", async () => {
    const { engine, calls } = spyEngine();
    const app = new App(engine, buildDeps().deps);

    await expect(app.summarize([])).rejects.toThrow(/Usage:\s+doozctl summarize <repo> <package>/);
    await expect(app.summarize(["/tmp/repo", "/tmp/pkg"])).rejects.toThrow(
      /Usage:\s+doozctl summarize <repo> <package>/,
    );
    expect(calls).toHaveLength(0);
  });

  it("rejects a missing session file", async () => {
    const { engine } = spyEngine();
    const app = new App(engine, buildDeps().deps);

    await expect(app.summarize(["/tmp/repo", "/tmp/pkg", "/tmp/missing.md"])).rejects.toThrow(
      /session file not found/,
    );
  });

  it("rejects a session flag without a value", async () => {
    const { engine } = spyEngine();
    const app = new App(engine, buildDeps().deps);

    await expect(app.summarize(["/tmp/repo", "/tmp/pkg", "/tmp/s.md", "--tool"])).rejects.toThrow(
      /--tool requires a value/,
    );
  });

  it("fails fast when sync is missing arguments", async () => {
    const { engine, calls } = spyEngine();
    const app = new App(engine, buildDeps().deps);

    await expect(app.sync([])).rejects.toThrow(/Usage:\s+doozctl sync <repo> <package>/);
    await expect(app.sync(["/tmp/repo"])).rejects.toThrow(/Usage:\s+doozctl sync <repo> <package>/);
    expect(calls).toHaveLength(0);
  });

  it("never sends a write step to read-only commands", async () => {
    const { engine, calls } = spyEngine();
    const app = new App(engine, buildDeps().deps);

    const args: Record<string, string[]> = {
      analyze: [],
      doctor: ["/tmp/repo", "/tmp/pkg"],
      status: [],
    };
    for (const cmd of ["analyze", "doctor", "status"]) {
      await (app[cmd as keyof App] as (args: string[]) => Promise<number>)(args[cmd] as string[]);
    }

    for (const call of calls) {
      expect(call.steps).not.toContain("writeStep");
    }
  });

  it("doctor reports a healthy repository after init", async () => {
    const dir = await tmp();
    const pkg = await tmp();
    await writePackage(pkg);

    const { deps } = buildDeps();
    const app = new App(new Engine(), deps);
    await app.init([dir, pkg]);

    const { deps: doctorDeps, printed: doctorPrinted } = buildDeps();
    const doctor = new App(new Engine(), doctorDeps);
    await expect(doctor.doctor([dir, pkg])).resolves.toBe(0);
    expect(doctorPrinted.join("\n")).toContain("Repository is healthy.");
    expect(doctorPrinted.join("\n")).toContain("✓ Initialized — .dooz/manifest.json");
  });

  it("doctor reports a healthy repository when a package declares summarize-only artifacts", async () => {
    const dir = await tmp();
    const pkg = await tmp();
    await writePackage(pkg);
    await writeFile(
      path.join(pkg, "package.json"),
      JSON.stringify({
        format: 2,
        name: "@dooziesoft/standards",
        version: "1.0.0",
        engine: ">=1.0.0",
        artifacts: [
          {
            id: "agents",
            source: "artifacts/AGENTS.md",
            destination: "AGENTS.md",
            merge: "managed-blocks",
            lifecycle: ["init", "sync"],
          },
          {
            id: "session",
            source: "artifacts/session.md",
            destination: ".ai/sessions/{{session.id}}.md",
            merge: "append",
            lifecycle: ["summarize"],
          },
        ],
      }),
    );
    await mkdir(path.join(pkg, "artifacts"), { recursive: true });
    await writeFile(path.join(pkg, "artifacts", "session.md"), "summary", "utf-8");

    const { deps } = buildDeps();
    const app = new App(new Engine(), deps);
    await app.init([dir, pkg]);

    const { deps: doctorDeps, printed: doctorPrinted } = buildDeps();
    const doctor = new App(new Engine(), doctorDeps);
    await expect(doctor.doctor([dir, pkg])).resolves.toBe(0);
    const report = doctorPrinted.join("\n");
    expect(report).toContain("Repository is healthy.");
    expect(report).not.toContain("not recorded in the manifest");
  });

  it("doctor rejects a repository that was never initialized", async () => {
    const dir = await tmp();
    const pkg = await tmp();
    await writePackage(pkg);
    const { deps } = buildDeps();
    const app = new App(new Engine(), deps);
    await expect(app.doctor([dir, pkg])).rejects.toThrow(/not initialized/);
  });

  it("doctor returns exit code 1 when problems are found", async () => {
    const dir = await tmp();
    const pkg = await tmp();
    await writePackage(pkg);
    const { deps } = buildDeps();
    const app = new App(new Engine(), deps);
    await app.init([dir, pkg]);

    const { rm } = await import("node:fs/promises");
    await rm(path.join(dir, "AGENTS.md"));

    const { deps: doctorDeps, printed: doctorPrinted } = buildDeps();
    const doctor = new App(new Engine(), doctorDeps);
    await expect(doctor.doctor([dir, pkg])).resolves.toBe(1);
    expect(doctorPrinted.join("\n")).toContain("Problems found:");
  });

  it("usage errors carry exit code 2", async () => {
    const { engine, calls } = spyEngine();
    const app = new App(engine, buildDeps().deps);
    await expect(app.init([])).rejects.toMatchObject({ exitCode: 2 });
    expect(calls).toHaveLength(0);
  });

  it("status reports an uninitialized repository and guides the user", async () => {
    const dir = await tmp();
    const { deps, printed } = buildDeps();
    const app = new App(new Engine(), deps);

    await expect(app.status([dir])).resolves.toBe(1);
    expect(printed.join("\n")).toContain("DoozCTL is not initialized in this repository.");
    expect(printed.join("\n")).toContain("doozctl init <repository> <standards-package>");
  });

  it("status reports repository facts and no active plan", async () => {
    const dir = await tmp();
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, "src", "main.ts"), "export {};\n", "utf-8");
    const pkg = await tmp();
    await writePackage(pkg);
    const { deps, printed } = buildDeps();
    const app = new App(new Engine(), deps);
    await app.init([dir, pkg]);

    await expect(app.status([dir])).resolves.toBe(0);
    const report = printed.join("\n");
    expect(report).toContain("DoozCTL Status");
    expect(report).toContain("Path: " + dir);
    expect(report).toContain("Languages: TypeScript");
    expect(report).toContain("Initialized: yes");
    expect(report).toContain("Active Plan\n  None");
    expect(report).toContain("doozctl plan --method <adopted-method>");
  });

  it("status shows the active plan, lifecycle progress and next action", async () => {
    const dir = await tmp();
    await adoptWorkflowForStatus(dir, "bug-fix");
    const pkg = await tmp();
    await writePackage(pkg);
    const { deps, printed } = buildDeps();
    const app = new App(new Engine(), deps);
    await app.init([dir, pkg]);

    await writeActivePlan(dir, {
      id: "attendance-punch-sync",
      method: "bug-fix",
      status: "EXECUTING",
      created: "2026-08-09",
      nextAction: "Commit the verified change.",
    });

    await expect(app.status([dir])).resolves.toBe(0);
    const report = printed.join("\n");
    expect(report).toContain("ID: attendance-punch-sync");
    expect(report).toContain("Method: bug-fix");
    expect(report).toContain("Status: EXECUTING");
    expect(report).toContain("Next: VERIFIED");
    expect(report).toContain("Plan       ✓");
    expect(report).toContain("Verify     ✗");
    expect(report).toContain("Test       ✗");
    expect(report).toContain("Next Action");
    expect(report).toContain("Commit the verified change.");
  });

  it("status reports an invalid evidence declaration as a problem", async () => {
    const dir = await tmp();
    const workflows = path.join(dir, ".dooz", "workflows", "adopted");
    await mkdir(workflows, { recursive: true });
    await writeFile(
      path.join(workflows, "bug-fix.md"),
      [
        "# Bug-Fix",
        "",
        "## Metadata",
        "",
        "- id: bug-fix",
        "",
        "## Required Evidence",
        "",
        "- [ ] tests",
        "- [ ] tsets",
      ].join("\n"),
      "utf-8",
    );
    const pkg = await tmp();
    await writePackage(pkg);
    const { deps, printed } = buildDeps();
    const app = new App(new Engine(), deps);
    await app.init([dir, pkg]);

    await writeActivePlan(dir, {
      id: "attendance-punch-sync",
      method: "bug-fix",
      status: "EXECUTING",
      created: "2026-08-09",
    });

    await expect(app.status([dir])).resolves.toBe(1);
    expect(printed.join("\n")).toContain(
      "Plan attendance-punch-sync uses workflow 'bug-fix', which declares an invalid evidence requirement: tsets.",
    );
  });

  it("status reports multiple active plans without selecting one", async () => {
    const dir = await tmp();
    const pkg = await tmp();
    await writePackage(pkg);
    const { deps, printed } = buildDeps();
    const app = new App(new Engine(), deps);
    await app.init([dir, pkg]);

    await writeActivePlan(dir, {
      id: "plan-a",
      method: "bug-fix",
      status: "EXECUTING",
      created: "2026-08-09",
    });
    await writeActivePlan(dir, {
      id: "plan-b",
      method: "feature",
      status: "PLANNED",
      created: "2026-08-10",
    });

    await expect(app.status([dir])).resolves.toBe(1);
    const report = printed.join("\n");
    expect(report).toContain("Multiple active plans found:");
    expect(report).toContain("plan-a — bug-fix (EXECUTING)");
    expect(report).toContain("plan-b — feature (PLANNED)");
    expect(report).toContain("Resolve the ambiguity before continuing.");
  });

  it("status reports a malformed active plan as a problem", async () => {
    const dir = await tmp();
    const pkg = await tmp();
    await writePackage(pkg);
    const { deps, printed } = buildDeps();
    const app = new App(new Engine(), deps);
    await app.init([dir, pkg]);

    const active = path.join(dir, ".dooz", "plans", "active");
    await mkdir(active, { recursive: true });
    await writeFile(path.join(active, "2026-08-09-broken.md"), "# Broken\nno metadata\n", "utf-8");

    await expect(app.status([dir])).resolves.toBe(1);
    expect(printed.join("\n")).toContain("Plan broken is invalid:");
  });

  it("status reports a missing adopted workflow as a problem", async () => {
    const dir = await tmp();
    const pkg = await tmp();
    await writePackage(pkg);
    const { deps, printed } = buildDeps();
    const app = new App(new Engine(), deps);
    await app.init([dir, pkg]);

    await writeActivePlan(dir, {
      id: "attendance-punch-sync",
      method: "bug-fix",
      status: "EXECUTING",
      created: "2026-08-09",
    });

    await expect(app.status([dir])).resolves.toBe(1);
    expect(printed.join("\n")).toContain(
      "Plan attendance-punch-sync requires workflow 'bug-fix', but that workflow is not adopted.",
    );
  });

  it("status with no explicit next action says it is not specified", async () => {
    const dir = await tmp();
    await adoptWorkflowForStatus(dir, "feature");
    const pkg = await tmp();
    await writePackage(pkg);
    const { deps, printed } = buildDeps();
    const app = new App(new Engine(), deps);
    await app.init([dir, pkg]);

    await writeActivePlan(dir, {
      id: "feature",
      method: "feature",
      status: "VERIFIED",
      created: "2026-08-09",
    });

    await expect(app.status([dir])).resolves.toBe(0);
    const report = printed.join("\n");
    expect(report).toContain("Status: VERIFIED");
    expect(report).toContain("Next: TESTED");
    expect(report).toContain("Plan       ✓");
    expect(report).toContain("Verify     ✓");
    expect(report).toContain("Test       ✗");
    expect(report).toContain("Next Action\n  Not specified.");
  });
});

describe("App plan", () => {
  const active = (dir: string) => path.join(dir, ".dooz", "plans", "active");
  const listActive = async (dir: string): Promise<string[]> => readdir(active(dir)).catch(() => []);

  /** A minimal valid workflow document declaring the given id. */
  const workflowContent = (id: string): string =>
    [`# ${id}`, "", "## Metadata", "", `- id: ${id}`, "", "## Purpose", "", "Test method."].join(
      "\n",
    );

  /** Adopt a workflow document into the temp repository's control plane. */
  const adoptWorkflow = async (
    dir: string,
    id: string,
    place: "adopted" | "project" = "adopted",
    content: string = workflowContent(id),
  ): Promise<void> => {
    const base = path.join(dir, ".dooz", "workflows", place);
    await mkdir(base, { recursive: true });
    await writeFile(path.join(base, `${id}.md`), content, "utf-8");
  };

  it("creates a plan with the default method and a concise report", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "standard");
    const { deps, printed } = buildDeps();
    const app = new App(new Engine(), deps);

    const code = await app.plan([dir]);

    expect(code).toBe(0);
    const report = printed.join("\n");
    expect(report).toContain("Created plan:");
    expect(report).toContain("ID: standard");
    expect(report).toContain("Method: standard");
    expect(report).toContain("Status: PLANNED");
    expect(report).toContain("Path: .dooz/plans/active/2026-08-09-standard.md");

    const file = path.join(active(dir), "2026-08-09-standard.md");
    const content = await readFile(file, "utf-8");
    expect(content).toContain("# Standard");
    expect(content).toContain("- id: standard");
    expect(content).toContain("- method: standard");
    expect(content).toContain("- status: PLANNED");
    expect(content).toContain("- created: 2026-08-09");
    expect(content).toContain("## Objective");
    expect(content).toContain("## Acceptance Criteria");
  });

  it("creates a plan with an explicit method", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix");
    const app = new App(new Engine(), buildDeps().deps);

    await expect(app.plan([dir, "--method", "bug-fix"])).resolves.toBe(0);
    const content = await readFile(path.join(active(dir), "2026-08-09-bug-fix.md"), "utf-8");
    expect(content).toContain("- id: bug-fix");
    expect(content).toContain("- method: bug-fix");
  });

  it("accepts the --method=value flag form", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "feature");
    const app = new App(new Engine(), buildDeps().deps);

    await expect(app.plan([dir, "--method=feature"])).resolves.toBe(0);
    expect(await readFile(path.join(active(dir), "2026-08-09-feature.md"), "utf-8")).toContain(
      "- method: feature",
    );
  });

  it("derives the plan id from --title", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix");
    const app = new App(new Engine(), buildDeps().deps);

    await expect(
      app.plan([dir, "--method", "bug-fix", "--title", "attendance punch sync"]),
    ).resolves.toBe(0);
    const file = path.join(active(dir), "2026-08-09-attendance-punch-sync.md");
    const content = await readFile(file, "utf-8");
    expect(content).toContain("# attendance punch sync");
    expect(content).toContain("- id: attendance-punch-sync");
    expect(content).toContain("- method: bug-fix");
  });

  it("creates a plan using a project-local workflow", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "client-release", "project");
    const app = new App(new Engine(), buildDeps().deps);

    await expect(app.plan([dir, "--method", "client-release"])).resolves.toBe(0);
    const content = await readFile(path.join(active(dir), "2026-08-09-client-release.md"), "utf-8");
    expect(content).toContain("- method: client-release");
  });

  it("rejects an unadopted method with a usage error and writes nothing", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix");
    const app = new App(new Engine(), buildDeps().deps);

    await expect(app.plan([dir, "--method", "nope"])).rejects.toMatchObject({
      name: "UsageError",
      exitCode: 2,
    });
    await expect(app.plan([dir, "--method", "nope"])).rejects.toThrow(/unknown plan method: nope/);
    expect(await listActive(dir)).toEqual([]);
  });

  it("rejects the default method when it is not adopted", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix");
    const app = new App(new Engine(), buildDeps().deps);

    await expect(app.plan([dir])).rejects.toMatchObject({ name: "UsageError", exitCode: 2 });
    await expect(app.plan([dir])).rejects.toThrow(/unknown plan method: standard/);
  });

  it("rejects an invalid method id as a usage error", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "bug-fix");
    const app = new App(new Engine(), buildDeps().deps);

    await expect(app.plan([dir, "--method", "../escape"])).rejects.toMatchObject({
      name: "UsageError",
      exitCode: 2,
    });
    await expect(app.plan([dir, "--method", "../escape"])).rejects.toThrow(
      /invalid plan method: \.\.\/escape/,
    );
    expect(await listActive(dir)).toEqual([]);
  });

  it("rejects a malformed adopted workflow without writing a plan", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "standard", "adopted", "# Standard\n\nNo metadata here.");
    const app = new App(new Engine(), buildDeps().deps);

    await expect(app.plan([dir])).rejects.toThrow(/workflow method asset is malformed: standard/);
    expect(await listActive(dir)).toEqual([]);
  });

  it("rejects a workflow with an invalid evidence requirement without writing a plan", async () => {
    const dir = await tmp();
    await adoptWorkflow(
      dir,
      "standard",
      "adopted",
      [
        "# Standard",
        "",
        "## Metadata",
        "",
        "- id: standard",
        "",
        "## Required Evidence",
        "",
        "- [ ] tests",
        "- [ ] tsets",
      ].join("\n"),
    );
    const app = new App(new Engine(), buildDeps().deps);

    // A repository-state problem (exit 1), not user input (exit 2).
    const error = await app.plan([dir]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toMatchObject({ name: "UsageError" });
    expect((error as Error).message).toContain("invalid evidence requirement: tsets");
    expect(await listActive(dir)).toEqual([]);
  });

  it("rejects a method adopted in both places without guessing", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "standard", "adopted");
    await adoptWorkflow(dir, "standard", "project");
    const app = new App(new Engine(), buildDeps().deps);

    await expect(app.plan([dir])).rejects.toThrow(/duplicate workflow method: standard/);
    expect(await listActive(dir)).toEqual([]);
  });

  it("rejects a title that cannot produce a valid plan id", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "standard");
    const app = new App(new Engine(), buildDeps().deps);

    await expect(app.plan([dir, "--title", "!!!"])).rejects.toMatchObject({
      name: "UsageError",
      exitCode: 2,
    });
    await expect(app.plan([dir, "--title", "!!!"])).rejects.toThrow(
      /--title must produce a valid plan id/,
    );
    expect(await listActive(dir)).toEqual([]);
  });

  it("rejects a flag without a value", async () => {
    const dir = await tmp();
    const app = new App(new Engine(), buildDeps().deps);
    await expect(app.plan([dir, "--method"])).rejects.toThrow(/--method requires a value/);
    await expect(app.plan([dir, "--title"])).rejects.toThrow(/--title requires a value/);
  });

  it("rejects unknown options", async () => {
    const dir = await tmp();
    const app = new App(new Engine(), buildDeps().deps);
    await expect(app.plan([dir, "--bogus"])).rejects.toThrow(/unknown option: --bogus/);
  });

  it("rejects more than one positional argument", async () => {
    const dir = await tmp();
    const app = new App(new Engine(), buildDeps().deps);
    await expect(app.plan([dir, "/other"])).rejects.toThrow(/Usage:\s+doozctl plan/);
  });

  it("does not overwrite an existing plan and preserves the original file", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "standard");
    const app = new App(new Engine(), buildDeps().deps);
    await app.plan([dir]);
    const file = path.join(active(dir), "2026-08-09-standard.md");
    const before = await readFile(file, "utf-8");

    await expect(app.plan([dir])).rejects.toThrow(/plan already exists: standard/);
    expect(await readFile(file, "utf-8")).toBe(before);
    expect(await listActive(dir)).toEqual(["2026-08-09-standard.md"]);
  });

  it("sanitizes hostile titles into safe kebab-case ids inside .dooz", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "standard");
    const app = new App(new Engine(), buildDeps().deps);

    await expect(app.plan([dir, "--title", "../../../etc/passwd"])).resolves.toBe(0);
    const entries = await listActive(dir);
    expect(entries).toEqual(["2026-08-09-etc-passwd.md"]);
    expect(await readFile(path.join(active(dir), entries[0] as string), "utf-8")).toContain(
      "- id: etc-passwd",
    );
  });

  it("reports a write failure and writes nothing outside .dooz", async () => {
    const dir = await tmp();
    await adoptWorkflow(dir, "standard");
    const app = new App(new Engine(), buildDeps().deps);
    await mkdir(path.join(dir, ".dooz", "plans"), { recursive: true });
    await writeFile(path.join(dir, ".dooz", "plans", "active"), "blocking file", "utf-8");

    await expect(app.plan([dir])).rejects.toThrow();
    expect(await readdir(path.join(dir, ".dooz", "plans"))).toEqual(["active"]);
  });
});
