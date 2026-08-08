import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { App, type AppDeps } from "../../src/app/app.js";
import { runCli } from "../../src/cli/cli.js";
import { Dispatcher } from "../../src/dispatcher/dispatcher.js";
import { Engine } from "../../src/engine/engine.js";
import {
  builtinMergers,
  DefaultAnalyzer,
  DefaultRenderer,
  DefaultStandardsLoader,
  DefaultValidator,
} from "../../src/engine/contracts.js";
import { GitService } from "../../src/infra/git/git.js";
import { RepositoryStore } from "../../src/store/repository-store.js";
import { Storage } from "../../src/store/storage.js";

/**
 * End-to-end smoke tests: exercise the full CLI wiring (composition root →
 * dispatcher → app → engine) without a real repository. Each command is
 * currently scaffolding, so these tests assert contract-level behavior.
 */

function buildDeps(): AppDeps {
  return {
    git: new GitService(),
    fs: new Storage(process.cwd()),
    store: new RepositoryStore(),
    analyzer: new DefaultAnalyzer(),
    loader: new DefaultStandardsLoader(),
    renderer: new DefaultRenderer(),
    validator: new DefaultValidator(),
    mergers: builtinMergers(),
  };
}

function buildDispatcher(): Dispatcher {
  const app = new App(new Engine(), buildDeps());
  return new Dispatcher()
    .register("init", app.init.bind(app))
    .register("analyze", app.analyze.bind(app))
    .register("sync", app.sync.bind(app))
    .register("doctor", app.doctor.bind(app))
    .register("summarize", app.summarize.bind(app))
    .register("status", app.status.bind(app));
}

/** Captures stdout/stderr writes for assertions. */
function capture(): { stdout: Writable; stderr: Writable; out: () => string; err: () => string } {
  let outBuf = "";
  let errBuf = "";
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      outBuf += chunk.toString();
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      errBuf += chunk.toString();
      cb();
    },
  });
  return {
    stdout,
    stderr,
    out: () => outBuf,
    err: () => errBuf,
  };
}

describe("doozctl CLI (integration)", () => {
  it("exposes the six core commands", () => {
    expect(buildDispatcher().commands()).toEqual([
      "analyze",
      "doctor",
      "init",
      "status",
      "summarize",
      "sync",
    ]);
  });

  it("registers every command on the CLI and dispatches", async () => {
    const dispatcher = buildDispatcher();
    // Scaffolding commands reject until a later phase; the CLI maps that to exit 1.
    for (const cmd of ["init", "analyze", "doctor", "summarize", "status", "sync"]) {
      const code = await runCli([cmd], dispatcher);
      expect(code).toBe(1);
    }
  });

  it("renders a deterministic help snapshot", async () => {
    const streams = capture();
    const code = await runCli(["--help"], buildDispatcher(), streams);
    expect(code).toBe(0);
    expect(streams.out()).toMatchSnapshot();
  });

  it("renders a deterministic version snapshot", async () => {
    const streams = capture();
    const code = await runCli(["--version"], buildDispatcher(), streams);
    expect(code).toBe(0);
    expect(streams.out()).toMatchSnapshot();
  });
});
