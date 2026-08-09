import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
 * End-to-end init tests: run the full init pipeline against a temporary
 * repository and Standards Package, asserting the frozen merge behavior and
 * the generated state (`.dooz/manifest.json`, `.ai/repository-analysis.json`).
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
    now: () => new Date(2026, 7, 9, 9, 30, 0),
  };
}

function app(): App {
  return new App(new Engine(), buildDeps());
}

/** The canonical managed artifact used across these tests. */
const MANAGED_TEMPLATE = [
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

/** Create a Standards Package declaring one managed-blocks artifact. */
async function writePackage(pkg: string, template: string = MANAGED_TEMPLATE): Promise<void> {
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
  await writeFile(path.join(pkg, "artifacts", "AGENTS.md"), template, "utf-8");
}

/** A repository that the analyzer sees as TypeScript (stable, non-git). */
async function writeRepo(repo: string): Promise<void> {
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "src", "main.ts"), "export {};\n", "utf-8");
}

describe("doozctl init (integration)", () => {
  it("renders, writes and tracks the artifact", async () => {
    const repo = await tmp("doozctl-init-repo-");
    const pkg = await tmp("doozctl-init-pkg-");
    await writeRepo(repo);
    await writePackage(pkg);

    let printed = "";
    const run = new App(
      new Engine(),
      buildDeps((message) => (printed += message + "\n")),
    );
    await expect(run.init([repo, pkg])).resolves.toBe(0);

    expect(printed).toContain("Repository initialized:");
    expect(printed).toContain("- AGENTS.md");
    expect(printed).toContain(".dooz/manifest.json");
    expect(printed).toContain(".ai/repository-analysis.json");

    await expect(readFile(path.join(repo, "AGENTS.md"), "utf-8")).resolves.toContain(
      "Lang: TypeScript",
    );
    await expect(readFile(path.join(repo, "AGENTS.md"), "utf-8")).resolves.toContain(
      "Manual notes live here.",
    );
    const manifest = JSON.parse(
      await readFile(path.join(repo, ".dooz", "manifest.json"), "utf-8"),
    ) as { version: number; artifacts: string[] };
    expect(manifest).toEqual({ version: 1, artifacts: ["agents"] });
    const analysis = JSON.parse(
      await readFile(path.join(repo, ".ai", "repository-analysis.json"), "utf-8"),
    ) as { languages: string[] };
    expect(analysis.languages).toEqual(["TypeScript"]);
  });

  it("merges into an existing managed file and preserves user content", async () => {
    const repo = await tmp("doozctl-init-repo-");
    const pkg = await tmp("doozctl-init-pkg-");
    await writeRepo(repo);
    await writePackage(pkg);
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

    await expect(app().init([repo, pkg])).resolves.toBe(0);

    const merged = await readFile(path.join(repo, "AGENTS.md"), "utf-8");
    expect(merged).toContain("My precious notes.");
    expect(merged).toContain("Lang: TypeScript");
    expect(merged).not.toContain("STALE GENERATED");
  });

  it("never overwrites an unmanaged file", async () => {
    const repo = await tmp("doozctl-init-repo-");
    const pkg = await tmp("doozctl-init-pkg-");
    await writeRepo(repo);
    await writePackage(pkg);
    await writeFile(path.join(repo, "AGENTS.md"), "Hand-written, no markers.\n", "utf-8");

    await expect(app().init([repo, pkg])).rejects.toThrow(/managed block/);

    await expect(readFile(path.join(repo, "AGENTS.md"), "utf-8")).resolves.toBe(
      "Hand-written, no markers.\n",
    );
    await expect(readdir(path.join(repo, ".dooz"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("is idempotent: init twice produces byte-identical output", async () => {
    const repo = await tmp("doozctl-init-repo-");
    const pkg = await tmp("doozctl-init-pkg-");
    await writeRepo(repo);
    await writePackage(pkg);

    const run = app();
    await run.init([repo, pkg]);
    const first = await readFile(path.join(repo, "AGENTS.md"), "utf-8");
    await run.init([repo, pkg]);
    const second = await readFile(path.join(repo, "AGENTS.md"), "utf-8");

    expect(second).toBe(first);
    await expect(readFile(path.join(repo, ".dooz", "manifest.json"), "utf-8")).resolves.toBe(
      await readFile(path.join(repo, ".dooz", "manifest.json"), "utf-8"),
    );
    await expect(
      readFile(path.join(repo, ".ai", "repository-analysis.json"), "utf-8"),
    ).resolves.toBe(await readFile(path.join(repo, ".ai", "repository-analysis.json"), "utf-8"));
  });
});
