import { Writable } from "node:stream";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { App, type AppDeps } from "../../src/app/app.js";
import { planCommandHelp, runCli } from "../../src/cli/cli.js";
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
import { DEFAULT_METHOD } from "../../src/workflows/adoption.js";

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

function buildDispatcher(print: (message: string) => void = () => {}): Dispatcher {
  const app = new App(new Engine(), { ...buildDeps(), print });
  return new Dispatcher()
    .register("init", app.init.bind(app))
    .register("analyze", app.analyze.bind(app))
    .register("sync", app.sync.bind(app))
    .register("doctor", app.doctor.bind(app))
    .register("summarize", app.summarize.bind(app))
    .register("status", app.status.bind(app))
    .register("plan", app.plan.bind(app));
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
  it("exposes the seven core commands", () => {
    expect(buildDispatcher().commands()).toEqual([
      "analyze",
      "doctor",
      "init",
      "plan",
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
    // plan requires an adopted workflow (the default method must be adopted).
    await mkdir(path.join(repo, ".dooz", "workflows", "adopted"), { recursive: true });
    await writeFile(
      path.join(repo, ".dooz", "workflows", "adopted", "standard.md"),
      [
        "# Standard",
        "",
        "## Metadata",
        "",
        "- id: standard",
        "",
        "## Purpose",
        "",
        "Test method.",
      ].join("\n"),
      "utf-8",
    );
    expect(await runCli(["plan", repo], dispatcher)).toBe(0);

    // summarize without a session file exits 2 with usage guidance.
    expect(await runCli(["summarize", repo, pkg], dispatcher)).toBe(2);
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

  it("doctor exits 1 when the repository has problems", async () => {
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
    await rm(path.join(repo, "AGENTS.md"));

    const code = await runCli(["doctor", repo, pkg], dispatcher, streams);
    expect(code).toBe(1);
    expect(streams.out()).toContain("Problems found:");
    expect(streams.out()).toContain("Generated artifact missing: AGENTS.md");
  });

  it("doctor exits 2 when arguments are missing", async () => {
    const streams = capture();
    const code = await runCli(["doctor"], buildDispatcher(), streams);
    expect(code).toBe(2);
    expect(streams.err()).toContain("Usage:   doozctl doctor <repo> <package>");
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
    const code = await runCli(["--help"], buildDispatcher(), {
      ...streams,
      help: { plan: planCommandHelp(DEFAULT_METHOD) },
    });
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
    expect(code).toBe(2);
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

describe("doozctl plan (integration)", () => {
  const planHelp = () => ({ plan: planCommandHelp(DEFAULT_METHOD) });
  const active = (dir: string) => path.join(dir, ".dooz", "plans", "active");
  const listActive = async (dir: string): Promise<string[]> => readdir(active(dir)).catch(() => []);
  /** A plan-only dispatcher whose app prints to the captured stdout. */
  const planDispatcher = (streams: { stdout: Writable }) =>
    buildDispatcher((message) => streams.stdout.write(message + "\n"));
  /** Adopt a workflow document into the temp repository's control plane. */
  const adoptWorkflow = async (
    repo: string,
    id: string,
    place: "adopted" | "project" = "adopted",
    content: string = [
      `# ${id}`,
      "",
      "## Metadata",
      "",
      `- id: ${id}`,
      "",
      "## Purpose",
      "",
      "Test method.",
    ].join("\n"),
  ): Promise<void> => {
    const base = path.join(repo, ".dooz", "workflows", place);
    await mkdir(base, { recursive: true });
    await writeFile(path.join(base, `${id}.md`), content, "utf-8");
  };

  it("creates a valid plan at the right location with the default method", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "doozctl-plan-repo-"));
    await adoptWorkflow(repo, "standard");
    tempDirs.push(repo);
    const streams = capture();

    const code = await runCli(["plan", repo], planDispatcher(streams), {
      ...streams,
      help: planHelp(),
    });

    expect(code).toBe(0);
    expect(streams.out()).toContain("Created plan:");
    expect(streams.out()).toContain("ID: standard");
    expect(streams.out()).toContain("Path: .dooz/plans/active/2026-08-09-standard.md");

    const file = path.join(active(repo), "2026-08-09-standard.md");
    const content = await readFile(file, "utf-8");
    expect(content).toContain("# Standard");
    expect(content).toContain("- id: standard");
    expect(content).toContain("- method: standard");
    expect(content).toContain("- status: PLANNED");
    expect(content).toContain("- created: 2026-08-09");
    // Canonical workflow body from the frozen template.
    expect(content).toContain("## Objective");
    expect(content).toContain("## Context");
    expect(content).toContain("## Scope");
    expect(content).toContain("## Acceptance Criteria");
    expect(content).toContain("## Plan");
    expect(content).toContain("## Verification");
  });

  it("creates a plan with an explicit method and the correct workflow body", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "doozctl-plan-repo-"));
    await adoptWorkflow(repo, "bug-fix");
    tempDirs.push(repo);
    const streams = capture();

    const code = await runCli(["plan", repo, "--method", "bug-fix"], planDispatcher(streams), {
      help: planHelp(),
    });

    expect(code).toBe(0);
    const file = path.join(active(repo), "2026-08-09-bug-fix.md");
    const content = await readFile(file, "utf-8");
    expect(content).toContain("- method: bug-fix");
    expect(content).toContain("## Next Action");
  });

  it("does not overwrite a duplicate plan and exits non-zero", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "doozctl-plan-repo-"));
    await adoptWorkflow(repo, "standard");
    tempDirs.push(repo);
    const streams = capture();
    const dispatcher = planDispatcher(streams);

    expect(await runCli(["plan", repo], dispatcher)).toBe(0);
    const file = path.join(active(repo), "2026-08-09-standard.md");
    const before = await readFile(file, "utf-8");

    const second = capture();
    const code = await runCli(["plan", repo], planDispatcher(second), second);
    expect(code).toBe(1);
    expect(second.err()).toContain("Plan already exists: standard");
    expect(second.err()).toContain("left untouched");
    expect(await readFile(file, "utf-8")).toBe(before);
    expect(await listActive(repo)).toEqual(["2026-08-09-standard.md"]);
  });

  it("derives the id from a title and creates it under .dooz", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "doozctl-plan-repo-"));
    await adoptWorkflow(repo, "feature");
    tempDirs.push(repo);

    const code = await runCli(
      ["plan", repo, "--method", "feature", "--title", "attendance punch sync"],
      buildDispatcher(),
    );
    expect(code).toBe(0);
    const file = path.join(active(repo), "2026-08-09-attendance-punch-sync.md");
    expect(await readFile(file, "utf-8")).toContain("# attendance punch sync");
  });

  it("cannot escape .dooz through a hostile title", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "doozctl-plan-repo-"));
    await adoptWorkflow(repo, "standard");
    tempDirs.push(repo);

    const code = await runCli(["plan", repo, "--title", "../../../escape"], buildDispatcher());
    expect(code).toBe(0);
    expect(await listActive(repo)).toEqual(["2026-08-09-escape.md"]);
  });

  it("rejects an invalid method with a usage error and exits 2", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "doozctl-plan-repo-"));
    tempDirs.push(repo);
    const streams = capture();

    const code = await runCli(["plan", repo, "--method", "nope"], buildDispatcher(), streams);
    expect(code).toBe(2);
    expect(streams.err()).toContain("unknown plan method: nope");
    expect(await listActive(repo)).toEqual([]);
  });

  it("rejects the unadopted default method with guidance", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "doozctl-plan-repo-"));
    await adoptWorkflow(repo, "bug-fix");
    tempDirs.push(repo);
    const streams = capture();

    const code = await runCli(["plan", repo], buildDispatcher(), streams);
    expect(code).toBe(2);
    expect(streams.err()).toContain("unknown plan method: standard");
    expect(streams.err()).toContain(".dooz/workflows/adopted/");
    expect(await listActive(repo)).toEqual([]);
  });

  it("creates a plan using a project-local workflow", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "doozctl-plan-repo-"));
    await adoptWorkflow(repo, "client-release", "project");
    tempDirs.push(repo);

    const code = await runCli(
      ["plan", repo, "--method", "client-release", "--title", "client release cut"],
      buildDispatcher(),
    );
    expect(code).toBe(0);
    const file = path.join(active(repo), "2026-08-09-client-release-cut.md");
    expect(await readFile(file, "utf-8")).toContain("- method: client-release");
  });

  it("fails clearly on a method adopted in both places", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "doozctl-plan-repo-"));
    await adoptWorkflow(repo, "standard", "adopted");
    await adoptWorkflow(repo, "standard", "project");
    tempDirs.push(repo);
    const streams = capture();

    const code = await runCli(["plan", repo], buildDispatcher(), streams);
    expect(code).toBe(1);
    expect(streams.err()).toContain("Duplicate workflow method: standard");
    expect(await listActive(repo)).toEqual([]);
  });

  it("fails clearly on an invalid adopted workflow document", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "doozctl-plan-repo-"));
    await adoptWorkflow(repo, "standard", "adopted", "# Standard\n\nNo metadata here.");
    tempDirs.push(repo);
    const streams = capture();

    const code = await runCli(["plan", repo], buildDispatcher(), streams);
    expect(code).toBe(1);
    expect(streams.err()).toContain("Workflow method document is malformed: standard");
    expect(await listActive(repo)).toEqual([]);
  });

  it("is deterministic under repeated invocation", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "doozctl-plan-repo-"));
    await adoptWorkflow(repo, "standard");
    tempDirs.push(repo);
    const dispatcher = buildDispatcher();

    expect(await runCli(["plan", repo], dispatcher)).toBe(0);
    expect(await runCli(["plan", repo], dispatcher)).toBe(1);
    const file = path.join(active(repo), "2026-08-09-standard.md");
    expect(await readFile(file, "utf-8")).toContain("- status: PLANNED");
  });

  it("documents the plan command in --help with adoption and examples", async () => {
    const streams = capture();
    const code = await runCli(["plan", "--help"], buildDispatcher(), {
      ...streams,
      help: planHelp(),
    });
    expect(code).toBe(0);
    expect(streams.out()).toContain("Create a repository-local engineering Plan");
    expect(streams.out()).toContain(".dooz/plans/active/");
    expect(streams.out()).toContain(".dooz/workflows/adopted/");
    expect(streams.out()).toContain(".dooz/workflows/project/");
    expect(streams.out()).toContain("(standard) is used");
    expect(streams.out()).toContain("doozctl plan --method bug-fix");
  });
});
