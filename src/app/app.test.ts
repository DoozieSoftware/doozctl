import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { App, type AppDeps } from "./app.js";
import { NotImplementedError } from "../errors.js";
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
      format: 1,
      name: "@dooziesoft/standards",
      version: "1.0.0",
      engine: ">=1.0.0",
      artifacts: [
        {
          id: "agents",
          source: "artifacts/AGENTS.md",
          destination: "AGENTS.md",
          merge: "managed-blocks",
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
    },
  };
}

/** Fake engine that records runs instead of executing scaffolding steps. */
function spyEngine() {
  const calls: { root: string; steps: string[] }[] = [];
  const engine = {
    run: async (opts: { root: string; standardsDir: string }, steps: Array<{ name?: string }>) => {
      calls.push({ root: opts.root, steps: steps.map((s) => s.name ?? "?") });
    },
  } as unknown as Engine;
  return { engine, calls };
}

describe("App", () => {
  it("routes init through the full seven-stage pipeline and prints a report", async () => {
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

    for (const cmd of ["analyze", "doctor", "summarize", "status"]) {
      await (app[cmd as keyof App] as (args: string[]) => Promise<number>)([]);
    }

    // sync needs a loadable Standards Package so the app can snapshot
    // destinations; the spy engine records the pipeline without executing it.
    const repo = await tmp();
    const pkg = await tmp();
    await writePackage(pkg);
    await app.sync([repo, pkg]);

    const executed = calls.map((c) => c.steps);
    expect(executed).toEqual([
      ["analyzeStep", "saveAnalysisStep"],
      ["validateStep", "reportStep"],
      ["resolveVariablesStep", "renderStep", "mergeStep", "validateStep", "writeStep"],
      ["analyzeStep", "reportStep"],
      [
        "loadStateStep",
        "loadStep",
        "resolveVariablesStep",
        "renderStep",
        "mergeStep",
        "validateStep",
        "writeStep",
      ],
    ]);
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

    for (const cmd of ["analyze", "doctor", "status"]) {
      await (app[cmd as keyof App] as (args: string[]) => Promise<number>)([]);
    }

    for (const call of calls) {
      expect(call.steps).not.toContain("writeStep");
    }
  });

  it("doctor and status are scaffolding until implemented", async () => {
    const dir = await tmp();
    const app = new App(new Engine(), buildDeps().deps);
    for (const cmd of ["doctor", "status"]) {
      const method = app[cmd as keyof App].bind(app) as (args: string[]) => Promise<number>;
      await expect(method([dir])).rejects.toBeInstanceOf(NotImplementedError);
    }
  });
});
