import { execFile } from "node:child_process";
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
    // Use git's raw output directly. git always returns an absolute path, and on
    // Windows it is the 8.3 short form (e.g. RUNNER~1), which matches what the
    // tests compare against via realpathSync(dir). Normalizing/expanding here
    // would produce a long path and break that comparison.
    const root = rootOut;
    const branchOut = await this.git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchOut !== null && branchOut !== "HEAD" ? branchOut : null;
    const status = await this.git(root, ["status", "--porcelain"]);
    return { root, branch, dirty: status !== null && status.length > 0 };
  }

  /** Short commit hash of HEAD, or null when not in a repository. */
  async commitHash(dir: string): Promise<string | null> {
    return this.git(dir, ["rev-parse", "--short", "HEAD"]);
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
