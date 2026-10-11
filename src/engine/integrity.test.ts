import { describe, expect, it } from "vitest";
import type { RepositoryInfo } from "../infra/git/git.js";
import { renderPlan } from "../model/plan.js";
import type { Scope } from "../model/scope.js";
import {
  classifyIntegrity,
  evaluateDocumentIntegrity,
  evaluateGitFactsIntegrity,
  MOVED_OUTSIDE_SCOPE_NOTE,
  type ClassificationFacts,
  type IntegrityGit,
} from "./integrity.js";

/**
 * V3-P06 unit tests: the pure classification table (S1–S5 in A-5 order) and
 * the read-only document/git-facts evaluation over P04 baselines and P05
 * scope. Deterministic, offline: git behavior is supplied by fakes.
 */

/** A valid, unscoped fact set on a moved but reachable baseline. */
function facts(overrides: Partial<ClassificationFacts> = {}): ClassificationFacts {
  return {
    hasBaseline: true,
    baselineError: null,
    scope: { declared: false, paths: [], invalid: [] },
    baselineCommit: "a1b2c3d",
    baselineHash: "base-full",
    headHash: "head-full",
    reachable: true,
    changedPaths: [],
    missingPaths: [],
    ...overrides,
  };
}

const scoped: Scope = { declared: true, paths: ["src/attendance/"], invalid: [] };

function scopedFacts(overrides: Partial<ClassificationFacts> = {}): ClassificationFacts {
  return facts({ scope: scoped, ...overrides });
}

/** A plan document with a baseline and the given scope paths. */
function planWithScope(scopePaths: string[]): string {
  return renderPlan({ id: "attendance-punch-sync", method: "bug-fix" }, "2026-08-13", {
    commit: "a1b2c3d",
    branch: "main",
    dirty: "no",
    source: "none",
    ownership: "mixed",
    scopePaths,
  });
}

/** A fake git satisfying IntegrityGit; records the calls it receives. */
class FakeGit implements IntegrityGit {
  readonly calls: string[] = [];
  constructor(
    private readonly opts: {
      repo?: RepositoryInfo | null;
      headFull?: string | null;
      resolve?: Record<string, string | null>;
      ancestor?: boolean;
      changed?: string[];
      exists?: (path: string) => boolean;
    } = {},
  ) {}

  async detect(): Promise<RepositoryInfo | null> {
    this.calls.push("detect");
    return this.opts.repo ?? { root: "/repo", branch: "main", dirty: false, commit: "h" };
  }

  async revParse(_dir: string, rev: string): Promise<string | null> {
    this.calls.push(`revParse:${rev}`);
    if (rev === "HEAD") {
      return this.opts.headFull === undefined ? "head-full" : this.opts.headFull;
    }
    const resolved = this.opts.resolve?.[rev];
    return resolved === undefined ? "base-full" : resolved;
  }

  async isAncestor(): Promise<boolean> {
    this.calls.push("isAncestor");
    return this.opts.ancestor ?? true;
  }

  async changedPathsSince(): Promise<string[]> {
    this.calls.push("changedPathsSince");
    return this.opts.changed ?? [];
  }

  async pathExistsAtHead(_dir: string, path: string): Promise<boolean> {
    this.calls.push(`pathExistsAtHead:${path}`);
    return this.opts.exists?.(path) ?? true;
  }
}

describe("classifyIntegrity — classification table", () => {
  it("classifies an artifact without a baseline as UNKNOWN, never INVALID", () => {
    const result = classifyIntegrity(facts({ hasBaseline: false }));
    expect(result).toEqual({
      freshness: "UNKNOWN",
      trust: "UNKNOWN",
      note: null,
      reasons: [],
    });
  });

  it("classifies a malformed baseline grammar as INVALID with the parse reason", () => {
    const result = classifyIntegrity(
      facts({ baselineError: "baseline is missing required field: branch" }),
    );
    expect(result.freshness).toBe("INVALID");
    expect(result.trust).toBe("INVALID");
    expect(result.reasons).toEqual(["baseline is missing required field: branch"]);
  });

  it("classifies declared-but-invalid scope as INVALID, never evaluating the valid subset", () => {
    const scope: Scope = {
      declared: true,
      paths: ["src/attendance/"],
      invalid: [
        { value: "../escape.ts", reason: "scope path must not traverse outside the repository" },
      ],
    };
    // Even with scoped changes present, invalid scope metadata decides first.
    const result = classifyIntegrity(
      facts({ scope, changedPaths: ["src/attendance/PunchService.php"] }),
    );
    expect(result).toEqual({
      freshness: "INVALID",
      trust: "INVALID",
      note: null,
      reasons: [
        "invalid scope path '../escape.ts': scope path must not traverse outside the repository",
      ],
    });
  });

  it("classifies an artifact grounded at the current tip as CURRENT/TRUSTED", () => {
    const result = classifyIntegrity(
      scopedFacts({ baselineHash: "head-full", headHash: "head-full" }),
    );
    expect(result).toEqual({ freshness: "CURRENT", trust: "TRUSTED", note: null, reasons: [] });
  });

  it("classifies an unresolvable baseline commit as INVALID", () => {
    const result = classifyIntegrity(scopedFacts({ baselineHash: null }));
    expect(result.freshness).toBe("INVALID");
    expect(result.trust).toBe("INVALID");
    expect(result.reasons).toEqual([
      "baseline commit 'a1b2c3d' cannot be resolved in this repository",
    ]);
  });

  it("classifies an unreachable baseline as INVALID, not STALE", () => {
    const result = classifyIntegrity(scopedFacts({ reachable: false }));
    expect(result.freshness).toBe("INVALID");
    expect(result.trust).toBe("INVALID");
    expect(result.reasons).toEqual([
      "baseline commit 'a1b2c3d' is not in the current repository history",
    ]);
  });

  it("classifies an unresolvable current state as UNKNOWN", () => {
    const result = classifyIntegrity(scopedFacts({ headHash: null }));
    expect(result.freshness).toBe("UNKNOWN");
    expect(result.trust).toBe("UNKNOWN");
  });

  it("classifies a moved reachable baseline without scope as STALE (conservative)", () => {
    const result = classifyIntegrity(facts());
    expect(result.freshness).toBe("STALE");
    expect(result.trust).toBe("STALE");
    expect(result.reasons).toEqual(["repository moved since baseline 'a1b2c3d'"]);
  });

  it("Scenario B: an out-of-scope change leaves a scoped artifact TRUSTED with the note", () => {
    const result = classifyIntegrity(scopedFacts());
    expect(result.freshness).toBe("CURRENT");
    expect(result.trust).toBe("TRUSTED");
    expect(result.note).toBe(MOVED_OUTSIDE_SCOPE_NOTE);
    expect(result.reasons).toEqual([]);
  });

  it("Scenario A: an in-scope change makes a scoped artifact STALE with the path reason", () => {
    const result = classifyIntegrity(
      scopedFacts({ changedPaths: ["src/attendance/PunchService.php"] }),
    );
    expect(result.freshness).toBe("STALE");
    expect(result.trust).toBe("STALE");
    expect(result.note).toBeNull();
    expect(result.reasons).toEqual([
      "src/attendance/PunchService.php changed since baseline 'a1b2c3d'",
    ]);
  });

  it("S3: a declared scope path missing at HEAD makes the artifact STALE", () => {
    const result = classifyIntegrity(scopedFacts({ missingPaths: ["src/attendance/"] }));
    expect(result.freshness).toBe("STALE");
    expect(result.reasons).toEqual(["scope path 'src/attendance/' does not exist at HEAD"]);
  });

  it("is deterministic for identical facts", () => {
    const a = classifyIntegrity(scopedFacts({ changedPaths: ["src/attendance/x.ts"] }));
    expect(classifyIntegrity(scopedFacts({ changedPaths: ["src/attendance/x.ts"] }))).toEqual(a);
    expect(classifyIntegrity(facts())).toEqual(classifyIntegrity(facts()));
  });
});

describe("evaluateDocumentIntegrity — baselines and scope over git fakes", () => {
  it("Scenario B: an unrelated change keeps a scoped plan TRUSTED with the note", async () => {
    const content = planWithScope(["src/attendance/"]);
    const git = new FakeGit({
      resolve: { a1b2c3d: "base-full" },
      changed: [],
    });
    const result = await evaluateDocumentIntegrity(content, "/repo", git);
    expect(result).toEqual({
      freshness: "CURRENT",
      trust: "TRUSTED",
      note: MOVED_OUTSIDE_SCOPE_NOTE,
      reasons: [],
    });
    // Read-only ordering: metadata → detect → resolve → reachability → S2/S3.
    expect(git.calls).toEqual([
      "detect",
      "revParse:HEAD",
      "revParse:a1b2c3d",
      "isAncestor",
      "changedPathsSince",
      "pathExistsAtHead:src/attendance/",
    ]);
  });

  it("Scenario A: an in-scope change makes a scoped plan STALE and skips the S3 probe", async () => {
    const content = planWithScope(["src/attendance/"]);
    const git = new FakeGit({ changed: ["src/attendance/PunchService.php"] });
    const result = await evaluateDocumentIntegrity(content, "/repo", git);
    expect(result.freshness).toBe("STALE");
    expect(result.trust).toBe("STALE");
    expect(result.reasons).toEqual([
      "src/attendance/PunchService.php changed since baseline 'a1b2c3d'",
    ]);
    // S2 already decided STALE — S3 existence probing never ran.
    expect(git.calls).not.toContain("pathExistsAtHead:src/attendance/");
  });

  it("S3: a declared scope path deleted at HEAD makes the plan STALE", async () => {
    const content = planWithScope(["src/attendance/"]);
    const git = new FakeGit({ changed: [], exists: () => false });
    const result = await evaluateDocumentIntegrity(content, "/repo", git);
    expect(result.freshness).toBe("STALE");
    expect(result.reasons).toEqual(["scope path 'src/attendance/' does not exist at HEAD"]);
  });

  it("an unscoped plan under a moved reachable baseline is STALE (conservative)", async () => {
    const content = planWithScope([]);
    const result = await evaluateDocumentIntegrity(content, "/repo", new FakeGit());
    expect(result.freshness).toBe("STALE");
    expect(result.trust).toBe("STALE");
    expect(result.reasons).toEqual(["repository moved since baseline 'a1b2c3d'"]);
  });

  it("a plan with declared invalid scope paths is INVALID, not evaluated", async () => {
    const content = planWithScope(["src/attendance/", "/etc/passwd"]);
    const git = new FakeGit();
    const result = await evaluateDocumentIntegrity(content, "/repo", git);
    expect(result.freshness).toBe("INVALID");
    expect(result.trust).toBe("INVALID");
    expect(result.reasons).toEqual([
      "invalid scope path '/etc/passwd': scope path must be relative to the repository root",
    ]);
    // No git facts were gathered: metadata validity decides first.
    expect(result.note).toBeNull();
    expect(git.calls).toEqual([]);
  });

  it("a v2 plan without a baseline is UNKNOWN, never INVALID", async () => {
    const v2Content = renderPlan({ id: "legacy", method: "bug-fix" }, "2026-08-13");
    const result = await evaluateDocumentIntegrity(v2Content, "/repo", new FakeGit());
    expect(result).toEqual({
      freshness: "UNKNOWN",
      trust: "UNKNOWN",
      note: null,
      reasons: [],
    });
  });

  it("a dirty working tree at the same commit is not staleness (N-1 guard)", async () => {
    const content = planWithScope(["src/attendance/"]);
    const git = new FakeGit({
      repo: { root: "/repo", branch: "main", dirty: true, commit: "h" },
      headFull: "base-full", // same commit as the baseline
    });
    const result = await evaluateDocumentIntegrity(content, "/repo", git);
    expect(result).toEqual({ freshness: "CURRENT", trust: "TRUSTED", note: null, reasons: [] });
    // Dirty-at-evaluation never reaches the diff probes.
    expect(git.calls).not.toContain("changedPathsSince");
  });

  it("an unreachable baseline (rewritten history) is INVALID", async () => {
    const content = planWithScope(["src/attendance/"]);
    const git = new FakeGit({ ancestor: false });
    const result = await evaluateDocumentIntegrity(content, "/repo", git);
    expect(result.freshness).toBe("INVALID");
    expect(result.reasons).toEqual([
      "baseline commit 'a1b2c3d' is not in the current repository history",
    ]);
  });

  it("cannot resolve a current state when the repository is absent", async () => {
    const content = planWithScope(["src/attendance/"]);
    const git = new FakeGit({ repo: null, headFull: null });
    const result = await evaluateDocumentIntegrity(content, "/repo", git);
    expect(result.freshness).toBe("UNKNOWN");
    expect(result.trust).toBe("UNKNOWN");
  });

  it("is deterministic for the same document and repository state", async () => {
    const content = planWithScope(["src/attendance/"]);
    const a = await evaluateDocumentIntegrity(content, "/repo", new FakeGit());
    const b = await evaluateDocumentIntegrity(content, "/repo", new FakeGit());
    expect(a).toEqual(b);
  });
});

describe("evaluateGitFactsIntegrity — analysis JSON artifacts (unscoped)", () => {
  it("treats a missing commit as no baseline → UNKNOWN", async () => {
    const result = await evaluateGitFactsIntegrity(null, "/repo", new FakeGit());
    expect(result).toEqual({ freshness: "UNKNOWN", trust: "UNKNOWN", note: null, reasons: [] });
  });

  it("treats a commit at the current tip as CURRENT/TRUSTED", async () => {
    const git = new FakeGit({ resolve: { abc123: "head-full" }, headFull: "head-full" });
    const result = await evaluateGitFactsIntegrity("abc123", "/repo", git);
    expect(result).toEqual({ freshness: "CURRENT", trust: "TRUSTED", note: null, reasons: [] });
  });

  it("treats a reachable older commit as STALE (conservative, no scope possible)", async () => {
    const result = await evaluateGitFactsIntegrity("a1b2c3d", "/repo", new FakeGit());
    expect(result.freshness).toBe("STALE");
    expect(result.reasons).toEqual(["repository moved since baseline 'a1b2c3d'"]);
  });

  it("treats an unresolvable commit as INVALID", async () => {
    const git = new FakeGit({ resolve: { deadbeef: null } });
    const result = await evaluateGitFactsIntegrity("deadbeef", "/repo", git);
    expect(result.freshness).toBe("INVALID");
    expect(result.reasons).toEqual([
      "baseline commit 'deadbeef' cannot be resolved in this repository",
    ]);
  });
});
