import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Sandboxed file system access layer for the engine.
 *
 * All paths are resolved relative to a configured root directory, guarding
 * against path traversal so the engine never reads or writes outside the
 * repository it operates on.
 */
export class FileSystem {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /**
   * Join parts onto the sandbox root, rejecting any path that escapes it.
   * @throws if the resolved path escapes the root.
   */
  resolve(...parts: string[]): string {
    const joined = path.join(this.root, ...parts);
    const rel = path.relative(this.root, joined);
    if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
      throw new Error(`path escapes sandbox root: ${joined}`);
    }
    return joined;
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
    await fs.mkdir(this.resolve(...parts), { recursive: true });
  }

  /** Read the full contents of the file at the relative path. */
  async read(...parts: string[]): Promise<string> {
    return fs.readFile(this.resolve(...parts), "utf-8");
  }

  /** Write content to the file at the relative path, creating parents. */
  async write(content: string, ...parts: string[]): Promise<void> {
    const p = this.resolve(...parts);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, "utf-8");
  }
}
