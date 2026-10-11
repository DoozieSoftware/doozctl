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

  it("reports the short HEAD commit the state describes", async () => {
    const dir = makeRepo();
    tempDirs.push(dir);
    const info = await new GitService().detect(dir);
    const expected = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir })
      .toString()
      .trim();
    expect(info?.commit).toMatch(/^[0-9a-f]+$/);
    expect(info?.commit).toBe(expected);
    cleanup();
  });

  it("reports a commit even on a detached HEAD", async () => {
    const dir = makeRepo();
    tempDirs.push(dir);
    execFileSync("git", ["checkout", "--detach"], { cwd: dir });
    const info = await new GitService().detect(dir);
    expect(info?.branch).toBeNull();
    expect(info?.commit).toMatch(/^[0-9a-f]+$/);
    cleanup();
  });

  it("reports no commit in a repository without commits", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "doozctl-git-empty-"));
    tempDirs.push(dir);
    execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
    const info = await new GitService().detect(dir);
    // An unborn HEAD has no commit yet and no resolvable branch (git itself
    // errors on both reads) — the service reports null for each.
    expect(info).not.toBeNull();
    expect(info?.branch).toBeNull();
    expect(info?.commit).toBeNull();
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

  it("reports HEAD as untagged on a fresh repository", async () => {
    const dir = makeRepo();
    tempDirs.push(dir);
    await expect(new GitService().headTagged(dir)).resolves.toBe(false);
    cleanup();
  });

  it("reports HEAD as tagged after tagging it", async () => {
    const dir = makeRepo();
    tempDirs.push(dir);
    execFileSync("git", ["tag", "v1.0.0"], { cwd: dir });
    await expect(new GitService().headTagged(dir)).resolves.toBe(true);
    cleanup();
  });

  it("reports no tag outside a repository", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "doozctl-git-norepo-"));
    tempDirs.push(dir);
    await expect(new GitService().headTagged(dir)).resolves.toBe(false);
    cleanup();
  });
});

describe("GitService integrity primitives (v3 P06)", () => {
  /** Create a repo, then commit a second change: modify a.txt and add b.txt. */
  function repoWithSecondCommit(): { dir: string; first: string } {
    const dir = makeRepo();
    tempDirs.push(dir);
    const first = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
    writeFileSync(path.join(dir, "a.txt"), "changed");
    writeFileSync(path.join(dir, "b.txt"), "new");
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "second"], { cwd: dir });
    return { dir, first };
  }

  it("resolves short hashes and HEAD to full commit hashes", async () => {
    const { dir, first } = repoWithSecondCommit();
    const git = new GitService();
    const head = await git.revParse(dir, "HEAD");
    const full = await git.revParse(dir, first);
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(full).toMatch(/^[0-9a-f]{40}$/);
    expect(full).not.toBe(head); // HEAD moved past the first commit
    cleanup();
  });

  it("returns null for unresolvable revisions", async () => {
    const dir = makeRepo();
    tempDirs.push(dir);
    await expect(new GitService().revParse(dir, "deadbeefdeadbeef")).resolves.toBeNull();
    cleanup();
  });

  it("reports ancestry through merge-base", async () => {
    const { dir, first } = repoWithSecondCommit();
    const git = new GitService();
    await expect(git.isAncestor(dir, first)).resolves.toBe(true);
    await expect(git.isAncestor(dir, (await git.revParse(dir, "HEAD")) ?? "")).resolves.toBe(true);
    await expect(git.isAncestor(dir, "0000000000000000000000000000000000000000")).resolves.toBe(
      false,
    );
    cleanup();
  });

  it("lists exactly the paths changed since an older commit", async () => {
    const { dir, first } = repoWithSecondCommit();
    const git = new GitService();
    const changed = await git.changedPathsSince(dir, first, []);
    expect(changed).toContain("a.txt");
    expect(changed).toContain("b.txt");
    expect(changed).toHaveLength(2);
    cleanup();
  });

  it("restricts the diff to the declared scope paths", async () => {
    const { dir, first } = repoWithSecondCommit();
    const git = new GitService();
    const changed = await git.changedPathsSince(dir, first, ["b.txt"]);
    expect(changed).toEqual(["b.txt"]);
    expect(await git.changedPathsSince(dir, first, ["unrelated/"]).then((c) => c.length)).toBe(0);
    cleanup();
  });

  it("reports whether a path exists at HEAD", async () => {
    const { dir } = repoWithSecondCommit();
    const git = new GitService();
    await expect(git.pathExistsAtHead(dir, "a.txt")).resolves.toBe(true);
    await expect(git.pathExistsAtHead(dir, "missing/file.ts")).resolves.toBe(false);
    cleanup();
  });
});
