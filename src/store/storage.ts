import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Storage: the single, generic filesystem abstraction for the engine.
 *
 * Sandboxed to a root directory so nothing is ever read or written outside
 * the repository it operates on. Higher layers decide where files live (for
 * example `.dooz/manifest.json` or `AGENTS.md`) and what they mean. Storage
 * itself knows nothing about manifests, artifacts, sessions, or AI memory.
 */
export class Storage {
  /** Absolute path of the repository root. */
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Join parts onto the root, rejecting any path that escapes it. */
  resolve(...parts: string[]): string {
    const joined = path.join(this.root, ...parts);
    const rel = path.relative(this.root, joined);
    if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
      throw new Error(`path escapes sandbox root: ${joined}`);
    }
    return joined;
  }

  /**
   * Enforce sandbox containment against real filesystem paths. Lexical checks
   * alone can be bypassed by a symlink inside the root: a destination that
   * resolves (through symlinks) outside the canonical root is rejected. A
   * symlink that cannot be resolved (a dangling link) is also rejected — the
   * engine never operates through a link it cannot prove is contained.
   */
  private async assertContained(target: string): Promise<void> {
    const rootReal = await realpathOf(await deepestExisting(this.root));
    const ancestor = await deepestExisting(path.dirname(target));
    if (!this.isRootedIn(rootReal, await realpathStrict(ancestor, target))) {
      throw new Error(`path escapes sandbox root: ${target}`);
    }
    if (await existsAny(target)) {
      if (!this.isRootedIn(rootReal, await realpathStrict(target, target))) {
        throw new Error(`path escapes sandbox root: ${target}`);
      }
    }
  }

  /** Whether `candidate` is inside `root`, comparing canonical paths. */
  private isRootedIn(root: string, candidate: string): boolean {
    const rel = path.relative(root, candidate);
    return (
      rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel))
    );
  }

  /** Whether the file or directory at the given relative path exists. */
  async exists(...parts: string[]): Promise<boolean> {
    try {
      await fs.access(this.resolve(...parts));
      return true;
    } catch {
      return false;
    }
  }

  /** Create the directory at the given relative path, including parents. */
  async mkdir(...parts: string[]): Promise<void> {
    const p = this.resolve(...parts);
    await this.assertContained(p);
    await fs.mkdir(p, { recursive: true });
  }

  /** Read the full contents of the file at the relative path. */
  async read(...parts: string[]): Promise<string> {
    const p = this.resolve(...parts);
    await this.assertContained(p);
    return fs.readFile(p, "utf-8");
  }

  /** Write content to the file at the relative path, creating parents. */
  async write(content: string, ...parts: string[]): Promise<void> {
    const p = this.resolve(...parts);
    await this.assertContained(p);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, "utf-8");
  }

  /**
   * Atomically write content to the relative path, creating parent
   * directories. Writes to a hidden temp file in the same directory, then
   * renames it over the target so a concurrent reader never sees a partial
   * file. On failure the temp file is removed and the error propagates.
   */
  async atomicWrite(content: string, ...parts: string[]): Promise<void> {
    const target = this.resolve(...parts);
    await this.assertContained(target);
    const dir = path.dirname(target);
    await fs.mkdir(dir, { recursive: true });
    const basename = path.basename(target);
    const temp = path.join(
      dir,
      `.${basename}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
    );
    try {
      await fs.writeFile(temp, content, "utf-8");
      await fs.rename(temp, target);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Delete the file at the relative path; a missing file is a no-op. */
  async delete(...parts: string[]): Promise<void> {
    const p = this.resolve(...parts);
    await this.assertContained(p);
    try {
      await fs.unlink(p);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

/** Whether any filesystem entry exists at `p` (lstat; symlinks included). */
async function existsAny(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** The deepest existing ancestor of `p`, walking up towards the root. */
async function deepestExisting(p: string): Promise<string> {
  let current = path.resolve(p);
  while (!(await existsAny(current))) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return current;
}

/** Canonicalize `p`, resolving symlinks; falls back to `p` when unresolvable. */
async function realpathOf(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return p;
  }
}

/**
 * Canonicalize `p`, throwing the sandbox escape error when the path cannot be
 * resolved. An unresolvable path is a dangling symlink — operating through it
 * could reach anywhere, so it is treated as escaping.
 */
async function realpathStrict(p: string, target: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    throw new Error(`path escapes sandbox root: ${target}`);
  }
}
