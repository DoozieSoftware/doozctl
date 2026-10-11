/**
 * Scope: the machine-checkable `## Baseline` scope declaration (V3-P05).
 *
 * CONTEXT-SPEC §6 and decision D5 freeze the first-cut scope syntax to exact
 * repository-relative paths and directory prefixes (a trailing `/` means the
 * whole subtree) — no glob syntax. Every declaration maps 1:1 to a git
 * pathspec, so the future integrity engine runs its staleness diffs inside git
 * itself with no matcher and no dependency.
 *
 * Scope paths are declared as repeated `- scope-path: <path>` lines inside an
 * artifact's `## Baseline` section (CONTEXT-SPEC §5.2, v3 A-4). The engine
 * renders the initial baseline at creation; agents and engineers author
 * `scope-path` lines, which this module validates (v3 A-6).
 *
 * Everything here is pure and deterministic: no clocks, no filesystem, no
 * git. Validation mirrors the existing workflow path rule (`isSafeRelativePath`,
 * WORKFLOW-SPEC path-bound evidence) — non-empty, forward slashes, no `..`
 * segments, no absolute or backslash forms — and extends it with the D5
 * rules: no glob characters and no git pathspec magic. The frozen plan
 * metadata parser is untouched; scope is read only through the `## Baseline`
 * grammar.
 */
import { parseBaseline } from "./baseline.js";

/** Characters that turn a git pathspec into a wildcard match. */
const GLOB_CHARACTERS = new Set(["*", "?", "[", "]", "{", "}"]);

/** The parsed scope declaration of an artifact document. */
export interface Scope {
  /**
   * Whether the artifact declares machine scope at all. False for documents
   * without a valid `## Baseline` (pre-v3 artifacts) and for baselines with
   * no `scope-path` lines — evaluation then falls back to repository
   * granularity (CONTEXT-SPEC §6.1, conservative).
   */
  readonly declared: boolean;
  /** Validated repo-relative scope paths, in declaration order. */
  readonly paths: string[];
  /** Declared scope paths that failed validation, in declaration order. */
  readonly invalid: Array<{ readonly value: string; readonly reason: string }>;
}

/** Whether `path` is a valid first-cut scope declaration (D5). */
export function isValidScopePath(path: string): boolean {
  return scopePathError(path) === null;
}

/** Whether `path` declares a whole subtree (a trailing `/` directory prefix). */
export function isDirectoryScope(path: string): boolean {
  return path.endsWith("/");
}

/**
 * The deterministic validation error for `path`, or null when it is a valid
 * scope declaration. Rules, in check order:
 *
 * 1. not empty and not `"."`
 * 2. not absolute (leading `/`) and not a Windows/backslash form
 * 3. no `..` segment (no traversal out of the repository)
 * 4. no glob characters (`* ? [ ] { }`)
 * 5. no leading `:` (git pathspec magic such as `:(glob)`)
 * 6. no empty segments other than a single trailing `/` (no `//`, no bare
 *    double separators)
 */
export function scopePathError(path: string): string | null {
  if (path === "") {
    return "scope path must not be empty";
  }
  if (path === ".") {
    return "scope path must not be '.'";
  }
  if (path.startsWith("/")) {
    return "scope path must be relative to the repository root";
  }
  if (path.includes("\\")) {
    return "scope path must use forward slashes";
  }
  if (path.split("/").includes("..")) {
    return "scope path must not traverse outside the repository";
  }
  if (path.startsWith(":")) {
    return "scope path must not use git pathspec magic";
  }
  for (const char of path) {
    if (GLOB_CHARACTERS.has(char)) {
      return "scope path must not contain glob characters";
    }
  }
  const segments = path.split("/");
  if (path.endsWith("/")) {
    segments.pop();
  }
  if (segments.length === 0 || segments.some((segment) => segment === "")) {
    return "scope path must not contain empty segments";
  }
  return null;
}

/**
 * Extract the validated scope from an artifact document's `## Baseline`
 * section. Deterministic: the same document always yields the same Scope.
 * The raw `scope-path` lines are parsed by the shared baseline grammar; only
 * content validation happens here, so the frozen metadata and baseline field
 * contracts are untouched.
 */
export function scopeFromBaseline(content: string): Scope {
  const parsed = parseBaseline(content);
  if (!parsed.present || !parsed.valid) {
    return { declared: false, paths: [], invalid: [] };
  }
  const paths: string[] = [];
  const invalid: Array<{ value: string; reason: string }> = [];
  for (const value of parsed.fields.scopePaths ?? []) {
    const reason = scopePathError(value);
    if (reason === null) {
      paths.push(value);
    } else {
      invalid.push({ value, reason });
    }
  }
  return { declared: (parsed.fields.scopePaths ?? []).length > 0, paths, invalid };
}
