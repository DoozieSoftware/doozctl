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
    await (app.status as (args: string[]) => Promise<number>)([repo]);
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
      ["analyzeStep", "reportStep"],
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

  it("status prints a report about the repository", async () => {
    const dir = await tmp();
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, "src", "main.ts"), "export {};\n", "utf-8");

    const { deps, printed } = buildDeps();
    const app = new App(new Engine(), deps);
    await expect(app.status([dir])).resolves.toBe(0);
    expect(printed.join("\n")).toContain("Repository: " + dir);
    expect(printed.join("\n")).toContain("Languages: TypeScript");
  });
});

describe("App plan", () => {
  const active = (dir: string) => path.join(dir, ".dooz", "plans", "active");
  const listActive = async (dir: string): Promise<string[]> => readdir(active(dir)).catch(() => []);

  it("creates a plan with the default method and a concise report", async () => {
    const dir = await tmp();
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
    const app = new App(new Engine(), buildDeps().deps);

    await expect(app.plan([dir, "--method", "bug-fix"])).resolves.toBe(0);
    const content = await readFile(path.join(active(dir), "2026-08-09-bug-fix.md"), "utf-8");
    expect(content).toContain("- id: bug-fix");
    expect(content).toContain("- method: bug-fix");
  });

  it("accepts the --method=value flag form", async () => {
    const dir = await tmp();
    const app = new App(new Engine(), buildDeps().deps);

    await expect(app.plan([dir, "--method=feature"])).resolves.toBe(0);
    expect(await readFile(path.join(active(dir), "2026-08-09-feature.md"), "utf-8")).toContain(
      "- method: feature",
    );
  });

  it("derives the plan id from --title", async () => {
    const dir = await tmp();
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

  it("rejects an unknown method with a usage error and writes nothing", async () => {
    const dir = await tmp();
    const app = new App(new Engine(), buildDeps().deps);

    await expect(app.plan([dir, "--method", "nope"])).rejects.toMatchObject({
      name: "UsageError",
      exitCode: 2,
    });
    await expect(app.plan([dir, "--method", "nope"])).rejects.toThrow(/unknown plan method: nope/);
    expect(await listActive(dir)).toEqual([]);
  });

  it("rejects a title that cannot produce a valid plan id", async () => {
    const dir = await tmp();
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
    const app = new App(new Engine(), buildDeps().deps);
    await mkdir(path.join(dir, ".dooz", "plans"), { recursive: true });
    await writeFile(path.join(dir, ".dooz", "plans", "active"), "blocking file", "utf-8");

    await expect(app.plan([dir])).rejects.toThrow();
    expect(await readdir(path.join(dir, ".dooz", "plans"))).toEqual(["active"]);
  });
});
