/**
 * Canonical evidence categories for DoozCTL v2.
 *
 * WORKFLOW-SPEC.md: a workflow declares machine-checkable required evidence
 * with Markdown checklist items (`- [ ] <category>`) in its `## Required
 * Evidence` section, where `<category>` is one of the closed vocabulary below.
 * Plain bullets remain human requirements; a checklist item naming an unknown
 * category is an invalid evidence requirement and fails clearly — it is never
 * guessed and never skipped.
 *
 * Path-bound categories (`changelog`, `version`) take exactly one
 * repository-relative file path after a colon (`- [ ] version: package.json`),
 * so the file locations live in the workflow document — the standards or
 * project layer owns them, never the engine.
 *
 * This module is pure: parsing only, no filesystem, no clocks.
 */

/** The closed vocabulary of canonical evidence categories, sorted. */
export const EVIDENCE_CATEGORIES = [
  "acceptance-criteria",
  "changelog",
  "commit",
  "git-state",
  "release",
  "tests",
  "verification",
  "version",
] as const;

export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

/** Whether `value` is exactly a canonical evidence category. */
export function isEvidenceCategory(value: string): value is EvidenceCategory {
  return (EVIDENCE_CATEGORIES as readonly string[]).includes(value);
}

/** Categories bound to a repository-relative file path via `category: path`. */
const PATH_BOUND_CATEGORIES: readonly EvidenceCategory[] = ["changelog", "version"];

/** Whether `category` takes a repository-relative path (`category: path`). */
export function isPathBoundCategory(category: EvidenceCategory): boolean {
  return PATH_BOUND_CATEGORIES.includes(category);
}

/**
 * Whether `path` is a safe repository-relative file path: non-empty, forward
 * slashes, no `..` segments, no absolute or Windows-style forms. Paths come
 * from authored workflow documents and are validated before any filesystem
 * use.
 */
export function isSafeRelativePath(path: string): boolean {
  if (path === "" || path === ".") {
    return false;
  }
  if (path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  return !path.split("/").includes("..");
}

/** One machine-checkable evidence requirement declared by a workflow. */
export interface EvidenceRequirement {
  readonly category: EvidenceCategory;
  /** Repository-relative path; always set for path-bound categories. */
  readonly path?: string;
}

/** The parsed `## Required Evidence` section of a workflow document. */
export interface EvidenceRequirements {
  /** Machine-checkable requirements, first-declaration order, deduplicated. */
  readonly requirements: EvidenceRequirement[];
  /**
   * Human requirements: plain bullets, trimmed, in document order,
   * deduplicated. Reported as manual evidence — never machine-checked.
   */
  readonly manual: string[];
  /**
   * Checklist items that are not valid declarations (unknown category, a
   * missing path on a path-bound category, a path on a path-free category, or
   * an unsafe path), in document order. Any entry here makes the workflow's
   * evidence declarations invalid.
   */
  readonly invalid: string[];
}

/**
 * Parse the `## Required Evidence` section of a workflow document.
 *
 * Rules (WORKFLOW-SPEC.md):
 * - matching is exact lowercase kebab-case after trimming the checkbox
 * - the checkbox state (`[ ]` vs `[x]`) is not meaningful
 * - duplicate declarations collapse — requirements are a set
 * - an empty or missing section declares no requirements
 * - a checklist item with an empty label declares nothing and is ignored
 * - path-bound categories take exactly one safe relative path (`cat: path`);
 *   the bare form is invalid, and a path on a path-free category is invalid
 * - plain bullets are human requirements; other lines are prose
 */
export function parseEvidenceRequirements(content: string): EvidenceRequirements {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const sectionIndex = lines.findIndex((line) => /^##\s+Required Evidence\s*$/.test(line));
  if (sectionIndex === -1) {
    return { requirements: [], manual: [], invalid: [] };
  }

  const requirements: EvidenceRequirement[] = [];
  const seen = new Set<string>();
  const manual: string[] = [];
  const invalid: string[] = [];

  for (let i = sectionIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (/^##\s/.test(line)) {
      break;
    }
    const checklist = /^-\s+\[[ xX]\]\s*(.*?)\s*$/.exec(line);
    if (checklist !== null) {
      const token = checklist[1] ?? "";
      if (token === "") {
        continue;
      }
      const requirement = parseRequirementToken(token);
      if (requirement === null) {
        if (!invalid.includes(token)) {
          invalid.push(token);
        }
        continue;
      }
      const key = `${requirement.category}:${requirement.path ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        requirements.push(requirement);
      }
      continue;
    }
    const bullet = /^-\s+(.+)$/.exec(line);
    if (bullet !== null) {
      const text = (bullet[1] ?? "").trim();
      if (text !== "" && !manual.includes(text)) {
        manual.push(text);
      }
    }
  }

  return { requirements, manual, invalid };
}

/** Parse one checklist token, or null when it is not a valid declaration. */
function parseRequirementToken(token: string): EvidenceRequirement | null {
  const colon = token.indexOf(":");
  const categoryPart = (colon === -1 ? token : token.slice(0, colon)).trim();
  const pathPart = colon === -1 ? undefined : token.slice(colon + 1).trim();
  if (!isEvidenceCategory(categoryPart)) {
    return null;
  }
  const category = categoryPart;
  if (pathPart === undefined) {
    return isPathBoundCategory(category) ? null : { category };
  }
  if (!isPathBoundCategory(category) || !isSafeRelativePath(pathPart)) {
    return null;
  }
  return { category, path: pathPart };
}
