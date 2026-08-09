import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GitService } from "./git.js";

/**
 * Integration-style tests for GitService using real temporary git
 * repositories. Requires the git binary; offline and deterministic.
 */

/**
 * The repository root git itself reports for `dir`. Comparing GitService's
 * result against git's own output (rather than the OS-provided temp path)
 * avoids Windows 8.3 short-name mismatches and `/var` vs `/private/var`
 * symlink differences, which cannot be reconciled by string normalization.
 */
function gitRoot(dir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir }).toString().trim();
}

/** Create a fresh git repository in a temp dir, returning its path. */
function makeRepo(init: (dir: string) => void = () => {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "doozctl-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(path.join(dir, "file.txt"), "hello");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  init(dir);
  return dir;
}

const tempDirs: string[] = [];
function cleanup(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("GitService", () => {
  it("is constructible", () => {
    expect(new GitService()).toBeDefined();
  });

  it("returns null outside a git repository", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "doozctl-git-norepo-"));
    tempDirs.push(dir);
    await expect(new GitService().detect(dir)).resolves.toBeNull();
    cleanup();
  });

  it("detects the repository root and current branch", async () => {
    const dir = makeRepo();
    tempDirs.push(dir);
    const info = await new GitService().detect(dir);
    expect(info).not.toBeNull();
    expect(path.resolve(info?.root ?? "")).toBe(path.resolve(gitRoot(dir)));
    expect(info?.branch).toBe("main");
    expect(info?.dirty).toBe(false);
    cleanup();
  });

  it("detects a repository from a nested directory", async () => {
    const dir = makeRepo();
    tempDirs.push(dir);
    const nested = path.join(dir, "packages", "app");
    execFileSync("mkdir", ["-p", nested], { cwd: dir });
    const info = await new GitService().detect(nested);
    expect(path.resolve(info?.root ?? "")).toBe(path.resolve(gitRoot(dir)));
    expect(info?.branch).toBe("main");
    cleanup();
  });

  it("reports a detached HEAD without a branch", async () => {
    const dir = makeRepo();
    tempDirs.push(dir);
    execFileSync("git", ["checkout", "--detach"], { cwd: dir });
    const info = await new GitService().detect(dir);
    expect(info?.branch).toBeNull();
    cleanup();
  });

  it("reports the working tree as dirty", async () => {
    const dir = makeRepo();
    tempDirs.push(dir);
    writeFileSync(path.join(dir, "untracked.txt"), "new");
    const info = await new GitService().detect(dir);
    expect(info?.dirty).toBe(true);
    cleanup();
  });

  it("reports a clean working tree after committing", async () => {
    const dir = makeRepo();
    tempDirs.push(dir);
    writeFileSync(path.join(dir, "tracked.txt"), "new");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "add"], { cwd: dir });
    const info = await new GitService().detect(dir);
    expect(info?.dirty).toBe(false);
    cleanup();
  });
});
