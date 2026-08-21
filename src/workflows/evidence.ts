/**
 * Canonical evidence categories for DoozCTL v2.
 *
 * WORKFLOW-SPEC.md v1.1.0: a workflow declares machine-checkable required
 * evidence with Markdown checklist items (`- [ ] <category>`) in its
 * `## Required Evidence` section, where `<category>` is one of the closed
 * vocabulary below. Plain bullets remain human requirements; a checklist item
 * naming an unknown category is an invalid evidence requirement and fails
 * clearly — it is never guessed and never skipped.
 *
 * This module is pure: parsing only, no filesystem, no clocks.
 */

/** The closed vocabulary of canonical evidence categories, sorted. */
export const EVIDENCE_CATEGORIES = [
  "acceptance-criteria",
  "commit",
  "git-state",
  "release",
  "tests",
  "verification",
] as const;

export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

/** Whether `value` is exactly a canonical evidence category. */
export function isEvidenceCategory(value: string): value is EvidenceCategory {
  return (EVIDENCE_CATEGORIES as readonly string[]).includes(value);
}

/** The parsed `## Required Evidence` section of a workflow document. */
export interface EvidenceRequirements {
  /** Machine-checkable categories, first-declaration order, deduplicated. */
  readonly requirements: EvidenceCategory[];
  /**
   * Human requirements: plain bullets, trimmed, in document order,
   * deduplicated. Reported as manual evidence — never machine-checked.
   */
  readonly manual: string[];
  /**
   * Checklist items naming an unknown category, in document order. Any entry
   * here makes the workflow's evidence declarations invalid.
   */
  readonly invalid: string[];
}

/**
 * Parse the `## Required Evidence` section of a workflow document.
 *
 * Rules (WORKFLOW-SPEC.md v1.1.0):
 * - matching is exact lowercase kebab-case after trimming the checkbox
 * - the checkbox state (`[ ]` vs `[x]`) is not meaningful
 * - duplicate declarations collapse — requirements are a set
 * - an empty or missing section declares no requirements
 * - a checklist item with an empty label declares nothing and is ignored
 * - plain bullets are human requirements; other lines are prose
 */
export function parseEvidenceRequirements(content: string): EvidenceRequirements {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const sectionIndex = lines.findIndex((line) => /^##\s+Required Evidence\s*$/.test(line));
  if (sectionIndex === -1) {
    return { requirements: [], manual: [], invalid: [] };
  }

  const requirements: EvidenceCategory[] = [];
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
      if (isEvidenceCategory(token)) {
        if (!requirements.includes(token)) {
          requirements.push(token);
        }
      } else if (!invalid.includes(token)) {
        invalid.push(token);
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
