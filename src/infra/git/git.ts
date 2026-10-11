import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Describes a discovered git repository. */
export interface RepositoryInfo {
  /** Absolute path to the repository root. */
  root: string;
  /** Current branch, or null when HEAD is detached. */
  branch: string | null;
  /** Whether the working tree differs from HEAD. */
  dirty: boolean;
  /**
   * Short HEAD hash, or null when HEAD has no commit yet (an empty
   * repository) or the read failed. The repository state an artifact's
   * baseline describes (CONTEXT-SPEC §5, v3 A-2).
   */
  commit: string | null;
}

/**
 * Git Service: infrastructure bridge to the local git repository.
 *
 * Uses read-only git commands. Offline, deterministic and cross-platform;
 * git is a prerequisite of the tool.
 */
export class GitService {
  /** Detect whether dir is inside a git repository. */
  async detect(dir: string): Promise<RepositoryInfo | null> {
    const rootOut = await this.git(dir, ["rev-parse", "--show-toplevel"]);
    if (rootOut === null) {
      return null;
    }
    // Canonicalize the path (resolves separators and any 8.3 short names on
    // Windows) so the reported root is a stable, long form on every platform.
    const root = path.resolve(rootOut);
    const branchOut = await this.git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchOut !== null && branchOut !== "HEAD" ? branchOut : null;
    const status = await this.git(root, ["status", "--porcelain"]);
    const commit = await this.git(root, ["rev-parse", "--short", "HEAD"]);
    return { root, branch, dirty: status !== null && status.length > 0, commit };
  }

  /** Short commit hash of HEAD, or null when not in a repository. */
  async commitHash(dir: string): Promise<string | null> {
    return this.git(dir, ["rev-parse", "--short", "HEAD"]);
  }

  /**
   * Resolve any revision expression (full/short hash, `HEAD`, a ref) to its
   * full commit hash, or null when it cannot be resolved unambiguously.
   * Read-only. The integrity engine compares full hashes so short-hash
   * baselines compare safely (v3 A-5, P06).
   */
  async revParse(dir: string, rev: string): Promise<string | null> {
    return this.git(dir, ["rev-parse", "--verify", rev]);
  }

  /**
   * Whether `hash` is an ancestor of HEAD (HEAD itself included). Read-only.
   * Returns false on any git failure — the integrity engine classifies an
   * unresolvable or non-ancestor baseline as INVALID either way (v3 A-5),
   * so exit 1 (not an ancestor) and git errors need not be distinguished.
   */
  async isAncestor(dir: string, hash: string): Promise<boolean> {
    const result = await this.git(dir, ["merge-base", "--is-ancestor", hash, "HEAD"]);
    return result !== null;
  }

  /**
   * Paths changed between `fromHash` and HEAD, restricted to `scopePaths`
   * (each an exact path or directory prefix — git runs the match, no
   * matcher, v3 D5). Empty when the commits are equal or nothing scoped
   * changed. Read-only.
   */
  async changedPathsSince(dir: string, fromHash: string, scopePaths: string[]): Promise<string[]> {
    const out = await this.git(dir, [
      "diff",
      "--name-only",
      `${fromHash}..HEAD`,
      "--",
      ...scopePaths,
    ]);
    if (out === null) {
      return [];
    }
    return out.split("\n").filter((line) => line !== "");
  }

  /**
   * Whether `path` (exact file path or directory prefix) exists at HEAD.
   * Read-only — the S3 scope-missing probe (v3 A-5).
   */
  async pathExistsAtHead(dir: string, path: string): Promise<boolean> {
    const out = await this.git(dir, ["ls-tree", "HEAD", "--", path]);
    return out !== null && out.length > 0;
  }

  /**
   * Whether HEAD carries a git tag (lightweight or annotated). Read-only;
   * false outside a repository. This is the generic check behind the
   * `release` evidence category (WORKFLOW-SPEC v1.1.0).
   */
  async headTagged(dir: string): Promise<boolean> {
    const root = await this.git(dir, ["rev-parse", "--show-toplevel"]);
    if (root === null) {
      return false;
    }
    const tags = await this.git(root, ["tag", "--points-at", "HEAD"]);
    return tags !== null && tags.length > 0;
  }

  /** Run a read-only git command, returning trimmed stdout or null on error. */
  private async git(cwd: string, args: string[]): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
      return stdout.trim();
    } catch {
      return null;
    }
  }
}
