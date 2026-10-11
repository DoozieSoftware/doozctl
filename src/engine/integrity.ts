/**
 * Integrity Engine (V3-P06): deterministic freshness/staleness evaluation.
 *
 * The engine decides whether an artifact's provenance still grounds in the
 * current repository. Evaluation is a pure function of three inputs — the
 * artifact's `## Baseline` (P04), its declared scope (P05), and read-only git
 * facts — computed in signal order (CONTEXT-SPEC §9.2, v3 A-5):
 *
 *   0  metadata validity (pure)            — no baseline → UNKNOWN; malformed
 *                                            grammar or invalid scope → INVALID
 *   1  S1 commit moved                     — baseline resolved hash vs HEAD
 *   2  reachability probe                  — merge-base --is-ancestor; a
 *                                            baseline outside current history
 *                                            is INVALID, not STALE
 *   3  S2 scoped paths changed             — diff --name-only base..HEAD over
 *                                            the declared scope paths
 *   4  S3 declared scope path missing      — ls-tree HEAD empty for a scope path
 *   5  S5 evidence order                   — verify rows only; deferred (the
 *                                            P10 contract ships qualifiers and
 *                                            S4 on `## Commit` rows, not S5)
 *
 * Trust states derive from the freshness outcome (CONTEXT-SPEC §10.2):
 * CURRENT → TRUSTED, STALE → STALE, no baseline → UNKNOWN, malformed or
 * unreachable metadata → INVALID. TRUSTED means "grounded per deterministic
 * checks", never "correct" (CONTEXT-SPEC §10.1).
 *
 * This module is strictly read-only and introduces no storage, registry,
 * cache or dependency. Presentation (`context validate`), status/verify
 * consumers, plan drift and handover belong to P07–P11, not here.
 */
import type { RepositoryInfo } from "../infra/git/git.js";
import { parseBaseline, type BaselineParse } from "../model/baseline.js";
import { scopeFromBaseline, type Scope } from "../model/scope.js";

/** Freshness states (CONTEXT-SPEC §9.1; UNTRACKED classes are never evaluated). */
export type FreshnessState = "CURRENT" | "STALE" | "UNKNOWN" | "INVALID";

/** Trust states (CONTEXT-SPEC §10.1). */
export type TrustState = "TRUSTED" | "STALE" | "UNKNOWN" | "INVALID";

/** The §6.3 report line for a CURRENT artifact under a moved, out-of-scope tip. */
export const MOVED_OUTSIDE_SCOPE_NOTE = "repository moved outside described scope";

/** One artifact's integrity verdict. Deterministic for the same inputs. */
export interface IntegrityResult {
  readonly freshness: FreshnessState;
  readonly trust: TrustState;
  /**
   * The outside-scope note when the artifact is CURRENT/TRUSTED but the tip
   * moved outside its described scope; null otherwise. Both facts are always
   * reported; they never collapse into one (§6.3).
   */
  readonly note: string | null;
  /** Deterministic reason lines for STALE and INVALID verdicts. */
  readonly reasons: string[];
}

/**
 * The read-only git surface the integrity engine needs. GitService satisfies
 * this structurally; tests supply fakes — the engine never runs writes.
 */
export interface IntegrityGit {
  detect(dir: string): Promise<RepositoryInfo | null>;
  /** Resolve a revision expression to its full commit hash, or null. */
  revParse(dir: string, rev: string): Promise<string | null>;
  /** Whether `hash` is an ancestor of HEAD (HEAD itself included). */
  isAncestor(dir: string, hash: string): Promise<boolean>;
  /** Paths changed between `fromHash` and HEAD restricted to scope paths. */
  changedPathsSince(dir: string, fromHash: string, scopePaths: string[]): Promise<string[]>;
  /** Whether an exact path or directory prefix exists at HEAD. */
  pathExistsAtHead(dir: string, path: string): Promise<boolean>;
}

/** The discrete facts the pure classifier decides on. */
export interface ClassificationFacts {
  /** Whether the artifact declares a baseline at all. */
  readonly hasBaseline: boolean;
  /** Grammar failure reason when a baseline section is present but invalid. */
  readonly baselineError: string | null;
  /** The declared scope (P05): validated paths + any invalid declarations. */
  readonly scope: Scope;
  /** The raw baseline commit value (short or full, as authored). */
  readonly baselineCommit: string | null;
  /** Full resolved hash of the baseline commit, or null when unresolvable. */
  readonly baselineHash: string | null;
  /** Full resolved hash of current HEAD, or null when unavailable. */
  readonly headHash: string | null;
  /** Whether the baseline is an ancestor-or-equal of HEAD (S4 probe). */
  readonly reachable: boolean;
  /** Scope paths changed between baseline and HEAD (S2). */
  readonly changedPaths: string[];
  /** Declared scope paths absent at HEAD (S3). */
  readonly missingPaths: string[];
}

/**
 * The pure classification decision table (v3 A-5, CONTEXT-SPEC §10). No git,
 * no filesystem, no clocks — unit-testable over discrete facts.
 */
export function classifyIntegrity(facts: ClassificationFacts): IntegrityResult {
  if (!facts.hasBaseline) {
    // Pre-v3 artifact: no claim made. Never INVALID (CONTEXT-SPEC §18.3).
    return { freshness: "UNKNOWN", trust: "UNKNOWN", note: null, reasons: [] };
  }
  if (facts.baselineError !== null) {
    return { freshness: "INVALID", trust: "INVALID", note: null, reasons: [facts.baselineError] };
  }
  if (facts.scope.declared && facts.scope.invalid.length > 0) {
    // Declared-but-invalid scope is metadata that cannot be evaluated: never
    // silently fall back to the valid subset or to repository granularity.
    const reasons = facts.scope.invalid.map(
      (entry) => `invalid scope path '${entry.value}': ${entry.reason}`,
    );
    return { freshness: "INVALID", trust: "INVALID", note: null, reasons };
  }
  if (facts.headHash === null) {
    // Baseline present but the current repository state cannot be resolved:
    // no determination is possible.
    return { freshness: "UNKNOWN", trust: "UNKNOWN", note: null, reasons: [] };
  }
  if (facts.baselineHash === null) {
    return {
      freshness: "INVALID",
      trust: "INVALID",
      note: null,
      reasons: [`baseline commit '${facts.baselineCommit}' cannot be resolved in this repository`],
    };
  }
  if (facts.baselineHash === facts.headHash) {
    return { freshness: "CURRENT", trust: "TRUSTED", note: null, reasons: [] };
  }
  if (!facts.reachable) {
    return {
      freshness: "INVALID",
      trust: "INVALID",
      note: null,
      reasons: [
        `baseline commit '${facts.baselineCommit}' is not in the current repository history`,
      ],
    };
  }
  if (!facts.scope.declared) {
    // Reachable but moved, no scope: conservative repository granularity.
    return {
      freshness: "STALE",
      trust: "STALE",
      note: null,
      reasons: [`repository moved since baseline '${facts.baselineCommit}'`],
    };
  }
  const reasons: string[] = [];
  for (const path of facts.changedPaths) {
    reasons.push(`${path} changed since baseline '${facts.baselineCommit}'`);
  }
  for (const path of facts.missingPaths) {
    reasons.push(`scope path '${path}' does not exist at HEAD`);
  }
  if (reasons.length > 0) {
    return { freshness: "STALE", trust: "STALE", note: null, reasons };
  }
  // Grounded: the tip moved but only outside the described area. Both facts
  // are reported — grounded, and outside-scope.
  return { freshness: "CURRENT", trust: "TRUSTED", note: MOVED_OUTSIDE_SCOPE_NOTE, reasons: [] };
}

/**
 * Evaluate a Markdown artifact whose provenance is a `## Baseline` block
 * (plans, sessions, current context). Parses the baseline grammar and scope,
 * gathers the read-only git facts in signal order, and classifies. Never
 * writes; `root` must be inside a git repository.
 */
export async function evaluateDocumentIntegrity(
  content: string,
  root: string,
  git: IntegrityGit,
): Promise<IntegrityResult> {
  const baseline = parseBaseline(content);
  const scope = scopeFromBaseline(content);
  if (!baseline.present || !baseline.valid) {
    return classifyIntegrity({
      hasBaseline: baseline.present,
      baselineError: baseline.present && !baseline.valid ? baseline.reason : null,
      scope,
      baselineCommit: null,
      baselineHash: null,
      headHash: null,
      reachable: false,
      changedPaths: [],
      missingPaths: [],
    });
  }
  if (scope.declared && scope.invalid.length > 0) {
    // Metadata validity decides before any git probe (signal order 0): a
    // declared-but-invalid scope is INVALID, never evaluated over its valid
    // subset.
    return classifyIntegrity({
      hasBaseline: true,
      baselineError: null,
      scope,
      baselineCommit: baseline.fields.commit,
      baselineHash: null,
      headHash: null,
      reachable: false,
      changedPaths: [],
      missingPaths: [],
    });
  }
  return classifyIntegrity(await gatherFacts(baseline, scope, root, git));
}

/**
 * Evaluate a generated git-facts artifact (`.ai/repository-analysis.json`),
 * whose provenance is the `git.commit` JSON field, not the `## Baseline`
 * grammar, and which can never declare scope (unscoped → conservative
 * repository-granularity evaluation).
 */
export async function evaluateGitFactsIntegrity(
  commit: string | null,
  root: string,
  git: IntegrityGit,
): Promise<IntegrityResult> {
  if (commit === null) {
    return classifyIntegrity({
      hasBaseline: false,
      baselineError: null,
      scope: { declared: false, paths: [], invalid: [] },
      baselineCommit: null,
      baselineHash: null,
      headHash: null,
      reachable: false,
      changedPaths: [],
      missingPaths: [],
    });
  }
  return classifyIntegrity(
    await gatherFacts(
      {
        present: true,
        valid: true,
        fields: { commit, branch: "", dirty: "no" },
      },
      { declared: false, paths: [], invalid: [] },
      root,
      git,
    ),
  );
}

/**
 * Gather the read-only git facts needed past the pure metadata checks: resolve
 * baseline and HEAD to full hashes, probe reachability (S4), then, for scoped
 * artifacts under a moved reachable baseline, run S2 (scoped diff) and S3
 * (scope paths still present at HEAD).
 */
async function gatherFacts(
  baseline: Extract<BaselineParse, { present: true; valid: true }>,
  scope: Scope,
  root: string,
  git: IntegrityGit,
): Promise<ClassificationFacts> {
  const baselineCommit = baseline.fields.commit;
  const gitInfo = await git.detect(root);
  if (gitInfo === null || gitInfo.commit === null) {
    // No resolvable current state (not a repository, or HEAD has no commit).
    return {
      hasBaseline: true,
      baselineError: null,
      scope,
      baselineCommit,
      baselineHash: null,
      headHash: null,
      reachable: false,
      changedPaths: [],
      missingPaths: [],
    };
  }
  const headHash = await git.revParse(root, "HEAD");
  const baselineHash = headHash === null ? null : await git.revParse(root, baselineCommit);

  let reachable = false;
  let changedPaths: string[] = [];
  const missingPaths: string[] = [];
  if (headHash !== null && baselineHash !== null && baselineHash !== headHash) {
    reachable = await git.isAncestor(root, baselineHash);
    if (reachable && scope.declared) {
      changedPaths = await git.changedPathsSince(root, baselineHash, scope.paths);
      if (changedPaths.length === 0) {
        for (const path of scope.paths) {
          if (!(await git.pathExistsAtHead(root, path))) {
            missingPaths.push(path);
          }
        }
      }
    }
  }

  return {
    hasBaseline: true,
    baselineError: null,
    scope,
    baselineCommit,
    baselineHash,
    headHash,
    reachable,
    changedPaths,
    missingPaths,
  };
}
