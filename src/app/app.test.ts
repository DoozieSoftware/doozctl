import { mkdtemp, rm } from "node:fs/promises";
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

function buildDeps(): AppDeps {
  const git = new GitService();
  return {
    git,
    store: new RepositoryStore(),
    analyzer: new DefaultAnalyzer(git),
    loader: new DefaultStandardsLoader(),
    validator: new DefaultValidator(),
    mergers: builtinMergers(),
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
  it("routes init through the full seven-stage pipeline", async () => {
    const { engine, calls } = spyEngine();
    const app = new App(engine, buildDeps());
    const code = await app.init(["/tmp/repo"]);
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
  });

  it("routes each command to its own pipeline", async () => {
    const { engine, calls } = spyEngine();
    const app = new App(engine, buildDeps());

    const commands: Array<keyof App> = ["analyze", "sync", "doctor", "summarize", "status"];
    for (const cmd of commands) {
      await (app[cmd] as (args: string[]) => Promise<number>)([]);
    }

    const executed = calls.map((c) => c.steps);
    expect(executed).toEqual([
      ["analyzeStep", "saveAnalysisStep"],
      ["loadStep", "resolveVariablesStep", "renderStep", "mergeStep", "validateStep", "writeStep"],
      ["validateStep", "reportStep"],
      ["resolveVariablesStep", "renderStep", "mergeStep", "validateStep", "writeStep"],
      ["analyzeStep", "reportStep"],
    ]);
  });

  it("never sends a write step to read-only commands", async () => {
    const { engine, calls } = spyEngine();
    const app = new App(engine, buildDeps());

    for (const cmd of ["analyze", "doctor", "status"]) {
      await (app[cmd as keyof App] as (args: string[]) => Promise<number>)([]);
    }

    for (const call of calls) {
      expect(call.steps).not.toContain("writeStep");
    }
  });

  it("doctor and status are scaffolding until implemented", async () => {
    const dir = await tmp();
    const app = new App(new Engine(), buildDeps());
    for (const cmd of ["doctor", "status"]) {
      const method = app[cmd as keyof App].bind(app) as (args: string[]) => Promise<number>;
      await expect(method([dir])).rejects.toBeInstanceOf(NotImplementedError);
    }
  });
});
