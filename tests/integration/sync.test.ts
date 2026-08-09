import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { App, type AppDeps } from "../../src/app/app.js";
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
 * End-to-end sync tests: initialize a repository, then verify sync re-renders
 * managed artifacts from the persisted repository state while preserving all
 * user-authored content, and that failures leave the repository unchanged.
 */

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function buildDeps(print: (message: string) => void = () => {}): AppDeps {
  const git = new GitService();
  return {
    git,
    store: new RepositoryStore(),
    analyzer: new DefaultAnalyzer(git),
    loader: new DefaultStandardsLoader(),
    validator: new DefaultValidator(),
    mergers: builtinMergers(),
    print,
  };
}

function app(print: (message: string) => void = () => {}): App {
  return new App(new Engine(), buildDeps(print));
}

/** The canonical managed-blocks artifact used across these tests. */
const MANAGED_SOURCE = [
  "# AGENTS",
  "",
  "Manual notes live here.",
  "",
  "<!-- DOOZCTL:BEGIN:v1 repository-analysis -->",
  "",
  "Lang: {{analysis.language}}",
  "",
  "<!-- DOOZCTL:END:v1 repository-analysis -->",
].join("\n");

/** A repository that the analyzer sees as TypeScript (stable, non-git). */
async function writeRepo(repo: string): Promise<void> {
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "src", "main.ts"), "export {};\n", "utf-8");
}

/** Write a Standards Package declaring the given artifacts and source templates. */
async function writePackage(
  pkg: string,
  artifacts: Array<{
    id: string;
    source: string;
    destination: string;
    merge: "managed-blocks" | "overwrite" | "append" | "replace-generated";
    lifecycle: Array<"init" | "sync" | "summarize">;
  }>,
  templates: Record<string, string>,
): Promise<void> {
  await writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({
      format: 2,
      name: "@dooziesoft/standards",
      version: "1.0.0",
      engine: ">=1.0.0",
      artifacts,
    }),
  );
  await mkdir(path.join(pkg, "artifacts"), { recursive: true });
  for (const [name, content] of Object.entries(templates)) {
    await writeFile(path.join(pkg, "artifacts", name), content, "utf-8");
  }
}

/** A package with one managed-blocks AGENTS.md artifact. */
async function writeManagedPackage(pkg: string, source: string = MANAGED_SOURCE): Promise<void> {
  await writePackage(
    pkg,
    [
      {
        id: "agents",
        source: "artifacts/AGENTS.md",
        destination: "AGENTS.md",
        merge: "managed-blocks",
        lifecycle: ["init", "sync"],
      },
    ],
    { "AGENTS.md": source },
  );
}

describe("doozctl sync (integration)", () => {
  it("is a no-op immediately after init and reports up to date", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    const pkg = await tmp("doozctl-sync-pkg-");
    await writeRepo(repo);
    await writeManagedPackage(pkg);

    const run = app();
    await run.init([repo, pkg]);

    let printed = "";
    const out = app((message) => (printed += message + "\n"));
    await expect(out.sync([repo, pkg])).resolves.toBe(0);

    expect(printed).toContain("Synchronizing repository...");
    expect(printed).toContain("✓ Repository already up to date.");
    expect(printed).toContain("No changes required.");
  });

  it("repeated sync produces byte-identical state and no timestamp churn", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    const pkg = await tmp("doozctl-sync-pkg-");
    await writeRepo(repo);
    await writeManagedPackage(pkg);

    const run = app();
    await run.init([repo, pkg]);
    await run.sync([repo, pkg]);

    const first = await readFile(path.join(repo, "AGENTS.md"), "utf-8");
    const firstManifest = await readFile(path.join(repo, ".dooz", "manifest.json"), "utf-8");
    const firstAnalysis = await readFile(
      path.join(repo, ".ai", "repository-analysis.json"),
      "utf-8",
    );
    const manifestStat = await stat(path.join(repo, ".dooz", "manifest.json"));

    await run.sync([repo, pkg]);

    await expect(readFile(path.join(repo, "AGENTS.md"), "utf-8")).resolves.toBe(first);
    await expect(readFile(path.join(repo, ".dooz", "manifest.json"), "utf-8")).resolves.toBe(
      firstManifest,
    );
    await expect(
      readFile(path.join(repo, ".ai", "repository-analysis.json"), "utf-8"),
    ).resolves.toBe(firstAnalysis);
    await expect(stat(path.join(repo, ".dooz", "manifest.json"))).resolves.toMatchObject({
      mtimeMs: manifestStat.mtimeMs,
    });
  });

  it("updates artifacts when the Standards Package changes", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    const pkg = await tmp("doozctl-sync-pkg-");
    await writeRepo(repo);
    await writeManagedPackage(pkg);

    const run = app();
    await run.init([repo, pkg]);
    await run.sync([repo, pkg]);

    await writeFile(
      path.join(pkg, "artifacts", "AGENTS.md"),
      MANAGED_SOURCE.replace(
        "Lang: {{analysis.language}}",
        "Lang: {{analysis.language}} (updated)",
      ),
      "utf-8",
    );

    let printed = "";
    const out = app((message) => (printed += message + "\n"));
    await expect(out.sync([repo, pkg])).resolves.toBe(0);

    expect(printed).toContain("✓ Rendered 1 artifacts");
    expect(printed).toContain("✓ Updated 1 artifacts");
    expect(printed).toContain("✓ Unchanged 0 artifacts");
    expect(printed).toContain("Repository synchronized successfully.");

    const merged = await readFile(path.join(repo, "AGENTS.md"), "utf-8");
    expect(merged).toContain("Lang: TypeScript (updated)");
    expect(merged).toContain("Manual notes live here.");
  });

  it("updates only managed blocks, preserving user content", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    const pkg = await tmp("doozctl-sync-pkg-");
    await writeRepo(repo);
    await writeManagedPackage(pkg);

    const run = app();
    await run.init([repo, pkg]);

    await writeFile(
      path.join(repo, "AGENTS.md"),
      [
        "# AGENTS",
        "",
        "My precious notes.",
        "",
        "<!-- DOOZCTL:BEGIN:v1 repository-analysis -->",
        "STALE GENERATED",
        "<!-- DOOZCTL:END:v1 repository-analysis -->",
      ].join("\n"),
      "utf-8",
    );

    await expect(run.sync([repo, pkg])).resolves.toBe(0);

    const merged = await readFile(path.join(repo, "AGENTS.md"), "utf-8");
    expect(merged).toContain("My precious notes.");
    expect(merged).toContain("Lang: TypeScript");
    expect(merged).not.toContain("STALE GENERATED");
  });

  it("overwrite replaces the destination entirely", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    const pkg = await tmp("doozctl-sync-pkg-");
    await writeRepo(repo);
    await writePackage(
      pkg,
      [
        {
          id: "state",
          source: "artifacts/state.json",
          destination: ".dooz/state.json",
          merge: "overwrite",
          lifecycle: ["init", "sync"],
        },
      ],
      { "state.json": '{"render":"{{analysis.language}}"}\n' },
    );

    const run = app();
    await run.init([repo, pkg]);
    await expect(readFile(path.join(repo, ".dooz", "state.json"), "utf-8")).resolves.toBe(
      '{"render":"TypeScript"}\n',
    );

    await writeFile(path.join(repo, ".dooz", "state.json"), "STALE\n", "utf-8");
    await expect(run.sync([repo, pkg])).resolves.toBe(0);

    await expect(readFile(path.join(repo, ".dooz", "state.json"), "utf-8")).resolves.toBe(
      '{"render":"TypeScript"}\n',
    );
  });

  it("skips summarize-only append artifacts during init and sync", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    const pkg = await tmp("doozctl-sync-pkg-");
    await writeRepo(repo);
    await writePackage(
      pkg,
      [
        {
          id: "agents",
          source: "artifacts/AGENTS.md",
          destination: "AGENTS.md",
          merge: "managed-blocks",
          lifecycle: ["init", "sync"],
        },
        {
          id: "session",
          source: "artifacts/log.md",
          destination: ".ai/sessions/log.md",
          merge: "append",
          lifecycle: ["summarize"],
        },
      ],
      { "AGENTS.md": MANAGED_SOURCE, "log.md": "session {{analysis.language}}\n" },
    );

    const run = app();
    await run.init([repo, pkg]);
    await run.sync([repo, pkg]);

    await expect(readFile(path.join(repo, "AGENTS.md"), "utf-8")).resolves.toContain(
      "Lang: TypeScript",
    );
    await expect(
      readFile(path.join(repo, ".ai", "sessions", "log.md"), "utf-8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("skips init-only artifacts during sync and preserves them in the manifest", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    const pkg = await tmp("doozctl-sync-pkg-");
    await writeRepo(repo);
    await writePackage(
      pkg,
      [
        {
          id: "gitignore",
          source: "artifacts/gitignore",
          destination: ".gitignore",
          merge: "overwrite",
          lifecycle: ["init"],
        },
        {
          id: "agents",
          source: "artifacts/AGENTS.md",
          destination: "AGENTS.md",
          merge: "managed-blocks",
          lifecycle: ["init", "sync"],
        },
      ],
      { gitignore: "node_modules/\n", "AGENTS.md": MANAGED_SOURCE },
    );

    const run = app();
    await run.init([repo, pkg]);
    const firstInit = await readFile(path.join(repo, ".gitignore"), "utf-8");
    expect(firstInit).toContain("node_modules");

    await writeFile(path.join(repo, ".gitignore"), "node_modules/\n\n# local\n.env\n", "utf-8");

    let printed = "";
    const out = app((message) => (printed += message + "\n"));
    await expect(out.sync([repo, pkg])).resolves.toBe(0);

    expect(printed).toContain("✓ Skipped 1 artifacts (not in sync lifecycle)");
    await expect(readFile(path.join(repo, ".gitignore"), "utf-8")).resolves.toBe(
      "node_modules/\n\n# local\n.env\n",
    );
    const manifest = JSON.parse(
      await readFile(path.join(repo, ".dooz", "manifest.json"), "utf-8"),
    ) as { artifacts: string[] };
    expect(manifest.artifacts).toEqual(["gitignore", "agents"]);
  });

  it("replace-generated rewrites only engine-generated files", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    const pkg = await tmp("doozctl-sync-pkg-");
    await writeRepo(repo);
    await writePackage(
      pkg,
      [
        {
          id: "wrapper",
          source: "artifacts/wrapper.md",
          destination: "wrapper.md",
          merge: "replace-generated",
          lifecycle: ["init", "sync"],
        },
      ],
      { "wrapper.md": "<!-- DOOZCTL:GENERATED:v1 -->\nRead AGENTS.md first.\n" },
    );

    const run = app();
    await run.init([repo, pkg]);
    await expect(readFile(path.join(repo, "wrapper.md"), "utf-8")).resolves.toContain(
      "Read AGENTS.md first.",
    );

    await writeFile(
      path.join(pkg, "artifacts", "wrapper.md"),
      "<!-- DOOZCTL:GENERATED:v1 -->\nRead AGENTS.md and MEMORY.md first.\n",
      "utf-8",
    );
    await expect(run.sync([repo, pkg])).resolves.toBe(0);

    const content = await readFile(path.join(repo, "wrapper.md"), "utf-8");
    expect(content).toContain("MEMORY.md");
    expect(content).toContain("Read AGENTS.md and MEMORY.md first.");
  });

  it("fails without changing the repository when a merge fails", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    const pkg = await tmp("doozctl-sync-pkg-");
    await writeRepo(repo);
    await writeManagedPackage(pkg);

    const run = app();
    await run.init([repo, pkg]);
    const manifestBefore = await readFile(path.join(repo, ".dooz", "manifest.json"), "utf-8");

    await writeFile(
      path.join(repo, "AGENTS.md"),
      ["# AGENTS", "<!-- DOOZCTL:BEGIN:v1 repository-analysis -->", "orphaned"].join("\n"),
      "utf-8",
    );

    await expect(run.sync([repo, pkg])).rejects.toThrow(/BEGIN without END/);

    await expect(readFile(path.join(repo, "AGENTS.md"), "utf-8")).resolves.toContain("orphaned");
    await expect(readFile(path.join(repo, ".dooz", "manifest.json"), "utf-8")).resolves.toBe(
      manifestBefore,
    );
  });

  it("never overwrites an unmanaged file during sync", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    const pkg = await tmp("doozctl-sync-pkg-");
    await writeRepo(repo);
    await writeManagedPackage(pkg);

    const run = app();
    await run.init([repo, pkg]);

    await writeFile(path.join(repo, "AGENTS.md"), "Hand-written, no markers.\n", "utf-8");

    await expect(run.sync([repo, pkg])).rejects.toThrow(/no managed block markers/);

    await expect(readFile(path.join(repo, "AGENTS.md"), "utf-8")).resolves.toBe(
      "Hand-written, no markers.\n",
    );
  });

  it("rejects a malformed manifest without touching anything", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    const pkg = await tmp("doozctl-sync-pkg-");
    await writeRepo(repo);
    await writeManagedPackage(pkg);

    await mkdir(path.join(repo, ".dooz"), { recursive: true });
    await writeFile(path.join(repo, ".dooz", "manifest.json"), "{not json", "utf-8");

    const run = app();
    await expect(run.sync([repo, pkg])).rejects.toThrow(/manifest is malformed/);
  });

  it("rejects a repository that was never initialized", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    const pkg = await tmp("doozctl-sync-pkg-");
    await writeRepo(repo);
    await writeManagedPackage(pkg);

    const run = app();
    await expect(run.sync([repo, pkg])).rejects.toThrow(/not initialized/);
  });

  it("rejects a missing Standards Package", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    await writeRepo(repo);

    const run = app();
    await expect(run.sync([repo, path.join(repo, "does-not-exist")])).rejects.toThrow(
      /standards package not found/,
    );
  });

  it("is deterministic across reruns", async () => {
    const repo = await tmp("doozctl-sync-repo-");
    const pkg = await tmp("doozctl-sync-pkg-");
    await writeRepo(repo);
    await writeManagedPackage(pkg);

    const run = app();
    await run.init([repo, pkg]);
    const first = await readFile(path.join(repo, "AGENTS.md"), "utf-8");

    await run.sync([repo, pkg]);
    await run.sync([repo, pkg]);

    await expect(readFile(path.join(repo, "AGENTS.md"), "utf-8")).resolves.toBe(first);
    await expect(
      readFile(path.join(repo, ".ai", "repository-analysis.json"), "utf-8"),
    ).resolves.toBe(await readFile(path.join(repo, ".ai", "repository-analysis.json"), "utf-8"));
  });
});
