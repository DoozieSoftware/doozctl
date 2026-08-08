import { NotImplementedError } from "../../errors.js";

/** Describes a discovered git repository. */
export interface RepositoryInfo {
  /** Absolute path to the repository root. */
  root: string;
  /** Current branch. */
  branch: string;
}

/** Git Service: infrastructure bridge to the local git repository. */
export class GitService {
  /** Detect whether dir is inside a git repository. Scaffolding. */
  detect(_dir: string): Promise<RepositoryInfo | null> {
    return Promise.reject(new NotImplementedError("git"));
  }
}
