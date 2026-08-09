import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RepositoryAnalyzer } from "../../src/engine/repository-analyzer.js";
import { GitService } from "../../src/infra/git/git.js";

/**
 * Integration tests: RepositoryAnalyzer against a real git repository with
 * real git detection. Requires the git binary; offline and deterministic.
 */

/**
 * Two paths point at the same directory even when their string forms differ
 * (Windows 8.3 short names, `/var` vs `/private/var` symlinks, separator or
 * case differences). Accept equality under realpath or under a resolved,
 * case-insensitive, forward-slash comparison.
 */
function sameDirectory(a: string, b: string): boolean {
  try {
    if (realpathSync(a) === realpathSync(b)) return true;
  } catch {
    // fall through to the resolved comparison below
  }
  const norm = (p: string): string => path.resolve(p).toLowerCase().replace(/\\/g, "/");
  return norm(a) === norm(b);
}

const tempDirs: string[] = [];
function cleanup(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Create a committed temp git repository containing a small Node project. */
function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "doozctl-analyzer-"));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ dependencies: { express: "^4.19.0" }, scripts: { build: "node build.js" } }),
  );
  writeFileSync(path.join(dir, "package-lock.json"), "{}");
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "index.js"), "module.exports = {};");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

describe("RepositoryAnalyzer (integration)", () => {
  it("detects git facts from a real repository", async () => {
    const dir = makeRepo();
    const analysis = await new RepositoryAnalyzer({ git: new GitService() }).analyze(dir);
    expect(analysis.git).toEqual({ isRepository: true, branch: "main", dirty: false });
    expect(sameDirectory(analysis.root, dir)).toBe(true);
    cleanup();
  });

  it("detects a dirty working tree", async () => {
    const dir = makeRepo();
    writeFileSync(path.join(dir, "untracked.txt"), "new");
    const analysis = await new RepositoryAnalyzer({ git: new GitService() }).analyze(dir);
    expect(analysis.git.isRepository).toBe(true);
    expect(analysis.git.dirty).toBe(true);
    cleanup();
  });

  it("produces language, framework and statistics from the repo contents", async () => {
    const dir = makeRepo();
    const analysis = await new RepositoryAnalyzer({ git: new GitService() }).analyze(dir);
    expect(analysis.languages).toEqual(["JavaScript"]);
    expect(analysis.frameworks).toEqual(["Express"]);
    expect(analysis.packageManager).toBe("npm");
    expect(analysis.buildSystem).toBe("npm");
    expect(analysis.statistics).toEqual({ totalFiles: 3, sourceFiles: 1, testFiles: 0 });
    cleanup();
  });
});
