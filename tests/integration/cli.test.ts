import { Writable } from "node:stream";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { App, type AppDeps } from "../../src/app/app.js";
import { runCli } from "../../src/cli/cli.js";
import { Dispatcher } from "../../src/dispatcher/dispatcher.js";
import { Engine } from "../../src/engine/engine.js";
import {
  builtinMergers,
  DefaultAnalyzer,
  DefaultStandardsLoader,
  DefaultValidator,
} from "../../src/engine/contracts.js";
import { GitService } from "../../src/infra/git/git.js";
import { RepositoryStore } from "../../src/store/repository-store.js";

/**
 * End-to-end smoke tests: exercise the full CLI wiring (composition root →
 * dispatcher → app → engine) against a temporary repository and Standards
 * Package.
 */

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** Create a temp repo and a temp Standards Package with one managed artifact. */
async function makeRepoAndPackage(): Promise<{ repo: string; pkg: string }> {
  const repo = await mkdtemp(path.join(tmpdir(), "doozctl-cli-repo-"));
  const pkg = await mkdtemp(path.join(tmpdir(), "doozctl-cli-pkg-"));
  tempDirs.push(repo, pkg);
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
  await mkdir(path.join(pkg, "artifacts"));
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
  );
  return { repo, pkg };
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
    print: () => {},
    now: () => new Date(2026, 7, 9, 9, 30, 0),
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
    const { repo, pkg } = await makeRepoAndPackage();

    // init, sync, analyze, doctor and status succeed against a real package.
    expect(await runCli(["init", repo, pkg], dispatcher)).toBe(0);
    expect(await runCli(["sync", repo, pkg], dispatcher)).toBe(0);
    expect(await runCli(["analyze", repo], dispatcher)).toBe(0);
    expect(await runCli(["doctor", repo, pkg], dispatcher)).toBe(0);
    expect(await runCli(["status", repo], dispatcher)).toBe(0);

    // summarize without a session file exits 1 with usage guidance.
    expect(await runCli(["summarize", repo, pkg], dispatcher)).toBe(1);
  });

  it("doctor prints a health report to stdout", async () => {
    const { repo, pkg } = await makeRepoAndPackage();
    const streams = capture();
    const app = new App(new Engine(), {
      ...buildDeps(),
      print: (message) => streams.stdout.write(message + "\n"),
    });
    const dispatcher = new Dispatcher()
      .register("init", app.init.bind(app))
      .register("doctor", app.doctor.bind(app));

    await runCli(["init", repo, pkg], dispatcher, streams);
    const code = await runCli(["doctor", repo, pkg], dispatcher, streams);

    expect(code).toBe(0);
    expect(streams.out()).toContain("Repository is healthy.");
    expect(streams.out()).toContain("✓ Standards package — @dooziesoft/standards 1.0.0");
  });

  it("status prints an analysis report to stdout", async () => {
    const { repo, pkg } = await makeRepoAndPackage();
    await mkdir(path.join(repo, "src"), { recursive: true });
    await writeFile(path.join(repo, "src", "main.ts"), "export {};\n");
    const streams = capture();
    const app = new App(new Engine(), {
      ...buildDeps(),
      print: (message) => streams.stdout.write(message + "\n"),
    });
    const dispatcher = new Dispatcher().register("status", app.status.bind(app));

    const code = await runCli(["status", repo], dispatcher, streams);

    expect(code).toBe(0);
    expect(streams.out()).toContain("Repository: " + repo);
    expect(streams.out()).toContain("Languages: TypeScript");
  });

  it("renders a deterministic help snapshot", async () => {
    const streams = capture();
    const code = await runCli(["--help"], buildDispatcher(), streams);
    expect(code).toBe(0);
    expect(streams.out()).toMatchSnapshot();
  });

  it("prints the version from package.json", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf-8"),
    ) as { version: string };
    const streams = capture();
    const code = await runCli(["--version"], buildDispatcher(), streams);
    expect(code).toBe(0);
    expect(streams.out()).toBe(`${manifest.version}\n`);
  });

  it("documents init usage and an example in its help", async () => {
    const streams = capture();
    const code = await runCli(["init", "--help"], buildDispatcher(), streams);
    expect(code).toBe(0);
    expect(streams.out()).toContain("doozctl init <repo> <package>");
    expect(streams.out()).toContain("Example: doozctl init . ./standards");
  });

  it("prints a success report to stdout after a successful init", async () => {
    const { repo, pkg } = await makeRepoAndPackage();
    const streams = capture();
    const app = new App(new Engine(), {
      ...buildDeps(),
      print: (message) => streams.stdout.write(message + "\n"),
    });
    const dispatcher = new Dispatcher().register("init", app.init.bind(app));

    const code = await runCli(["init", repo, pkg], dispatcher, streams);
    expect(code).toBe(0);
    expect(streams.out()).toContain("Repository initialized:");
    expect(streams.out()).toContain("- AGENTS.md");
    expect(streams.out()).toContain(".dooz/manifest.json");
  });

  it("prints a synchronization summary to stdout after a successful sync", async () => {
    const { repo, pkg } = await makeRepoAndPackage();
    const streams = capture();
    const app = new App(new Engine(), {
      ...buildDeps(),
      print: (message) => streams.stdout.write(message + "\n"),
    });
    const dispatcher = new Dispatcher()
      .register("init", app.init.bind(app))
      .register("sync", app.sync.bind(app));

    await runCli(["init", repo, pkg], dispatcher, streams);
    const code = await runCli(["sync", repo, pkg], dispatcher, streams);

    expect(code).toBe(0);
    expect(streams.out()).toContain("Synchronizing repository...");
    expect(streams.out()).toContain("✓ Repository already up to date.");
    expect(streams.out()).toContain("No changes required.");
  });

  it("rejects init with missing arguments and prints usage guidance", async () => {
    const streams = capture();
    const code = await runCli(["init"], buildDispatcher(), streams);
    expect(code).toBe(1);
    expect(streams.err()).toContain("Usage:   doozctl init <repo> <package>");
  });

  it("humanizes a missing-standards-package error", async () => {
    const { repo } = await makeRepoAndPackage();
    const streams = capture();
    const code = await runCli(
      ["init", repo, path.join(repo, "does-not-exist")],
      buildDispatcher(),
      streams,
    );
    expect(code).toBe(1);
    expect(streams.err()).toContain("Standards package not found");
    expect(streams.err()).toContain("Pass a directory that contains a standards package");
  });
});
