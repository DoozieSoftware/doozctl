/**
 * Plan domain for DoozCTL v2.
 *
 * A Plan is Markdown. Only the four metadata fields frozen by PLAN-SPEC.md are
 * parsed: id, method, status, created. Everything else is opaque content,
 * preserved verbatim. All functions here are pure and deterministic: no
 * clocks, no filesystem, no git.
 */

/** The canonical lifecycle, in forward-only order. */
export const PLAN_LIFECYCLE = [
  "PLANNED",
  "EXECUTING",
  "VERIFIED",
  "TESTED",
  "COMMITTED",
  "MERGED",
  "COMPLETED",
] as const;

export type PlanStatus = (typeof PLAN_LIFECYCLE)[number];

/**
 * ABANDONED is a recognized terminal status in PLAN-SPEC. Phase 2.2 defines no
 * transitions to or from it: an abandoned plan is preserved in place, using
 * its status only. No archive directory behavior is defined yet.
 */
export const PLAN_ABANDONED = "ABANDONED" as const;

export type PlanAnyStatus = PlanStatus | typeof PLAN_ABANDONED;

/** Every status the Plan contract recognizes: the lifecycle plus ABANDONED. */
export const PLAN_STATUSES: readonly PlanAnyStatus[] = [...PLAN_LIFECYCLE, PLAN_ABANDONED];

/** Whether `value` is a status the Plan contract recognizes. */
export function isPlanStatus(value: string): value is PlanAnyStatus {
  return PLAN_STATUSES.includes(value as PlanAnyStatus);
}

/** A parsed Plan. `content` is the full Markdown document, verbatim. */
export interface Plan {
  readonly id: string;
  readonly method: string;
  readonly status: PlanAnyStatus;
  /** Creation date, `YYYY-MM-DD`. */
  readonly created: string;
  /** The canonical Markdown document. */
  readonly content: string;
}

/** Kebab-case plan id: lowercase letters and digits separated by single dashes. */
const PLAN_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** `YYYY-MM-DD` structural shape; calendar correctness is checked separately. */
const PLAN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `id` is a valid kebab-case plan id. */
export function isValidPlanId(id: string): boolean {
  return PLAN_ID_PATTERN.test(id);
}

/** Whether `value` is a real calendar date in `YYYY-MM-DD` form. */
export function isValidPlanDate(value: string): boolean {
  if (!PLAN_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Local `YYYY-MM-DD` for the given clock instant (matches v1 timestamp conventions). */
export function formatPlanDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The plan filename: `YYYY-MM-DD-<id>.md`. The id is validated before use. */
export function planFilename(created: string, id: string): string {
  return `${created}-${id}.md`;
}

/** The four machine-parsed metadata fields, in canonical order. */
const METADATA_FIELDS = ["id", "method", "status", "created"] as const;

/**
 * Parse a plan document and validate the frozen metadata contract. Throws with
 * a descriptive message on malformed metadata, invalid ids, unknown statuses,
 * invalid dates, missing fields or duplicate fields. Content outside the
 * Metadata section is preserved verbatim.
 */
export function parsePlan(content: string): Plan {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");

  const hasTitle = lines.some((line) => /^#\s+/.test(line));
  if (!hasTitle) {
    throw new Error("plan is missing an H1 title (# ...)");
  }

  const metaIndex = lines.findIndex((line) => /^##\s+Metadata\s*$/.test(line));
  if (metaIndex === -1) {
    throw new Error("plan is missing a ## Metadata section");
  }

  const values: Partial<Record<(typeof METADATA_FIELDS)[number], string>> = {};
  for (let i = metaIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (/^##\s/.test(line)) {
      break;
    }
    const match = /^-\s*(id|method|status|created):\s*(.*?)\s*$/.exec(line);
    if (match === null) {
      continue;
    }
    const key = match[1] as (typeof METADATA_FIELDS)[number];
    const value = (match[2] ?? "").trim();
    if (values[key] !== undefined) {
      throw new Error(`duplicate metadata field: ${key}`);
    }
    values[key] = value;
  }

  for (const key of METADATA_FIELDS) {
    const value = values[key];
    if (value === undefined || value === "") {
      throw new Error(`plan is missing metadata field: ${key}`);
    }
  }

  const id = values.id as string;
  const method = values.method as string;
  const status = values.status as string;
  const created = values.created as string;

  if (!isValidPlanId(id)) {
    throw new Error(`invalid plan id: ${id}`);
  }
  if (!isPlanStatus(status)) {
    throw new Error(`unknown plan status: ${status}`);
  }
  if (!isValidPlanDate(created)) {
    throw new Error(`invalid created date: ${created}`);
  }

  return { id, method, status, created, content: lines.join("\n") };
}

/** Input for rendering the canonical plan template at creation. */
export interface PlanTemplateInput {
  readonly id: string;
  readonly method: string;
  /** Optional human-readable title; defaults to a titleized id. */
  readonly title?: string;
}

/** Title-case a kebab-case id: `attendance-punch-sync` → `Attendance Punch Sync`. */
function titleize(id: string): string {
  return id
    .split("-")
    .map((word) => (word === "" ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/**
 * Render the canonical plan template. Deterministic for the same input; the
 * creation date is injected by the caller so rendering stays pure.
 */
export function renderPlan(input: PlanTemplateInput, created: string): string {
  return [
    `# ${input.title ?? titleize(input.id)}`,
    "",
    "## Metadata",
    "",
    `- id: ${input.id}`,
    `- method: ${input.method}`,
    `- status: PLANNED`,
    `- created: ${created}`,
    "",
    "## Objective",
    "",
    "## Context",
    "",
    "## Scope",
    "",
    "### In Scope",
    "",
    "### Out of Scope",
    "",
    "## Constraints",
    "",
    "## Acceptance Criteria",
    "",
    "## Plan",
    "",
    "## Verification",
    "",
    "## Test Evidence",
    "",
    "## Decisions",
    "",
    "## Known Limitations",
    "",
    "## Commit",
    "",
    "## Next Action",
    "",
  ].join("\n");
}

/**
 * Return `content` with the status line inside the Metadata section replaced,
 * preserving every other byte. Throws when the status field is absent.
 */
export function setPlanStatus(content: string, status: PlanAnyStatus): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let inMetadata = false;
  let replaced = false;
  const out = lines.map((line) => {
    if (/^##\s+Metadata\s*$/.test(line)) {
      inMetadata = true;
      return line;
    }
    if (inMetadata && /^##\s/.test(line)) {
      inMetadata = false;
      return line;
    }
    if (inMetadata && !replaced && /^-\s*status:/.test(line)) {
      replaced = true;
      return `- status: ${status}`;
    }
    return line;
  });
  if (!replaced) {
    throw new Error("plan is missing metadata field: status");
  }
  return out.join("\n");
}

/**
 * The lifecycle transition rule. Forward-only along the canonical order; a
 * same-status transition is an idempotent no-op. Throws on unknown statuses,
 * backwards transitions, and any transition to or from ABANDONED (which has no
 * defined semantics in Phase 2.2).
 */
export function transitionPlan(from: PlanAnyStatus, to: PlanAnyStatus): PlanAnyStatus {
  if (!isPlanStatus(from)) {
    throw new Error(`unknown plan status: ${from}`);
  }
  if (!isPlanStatus(to)) {
    throw new Error(`unknown plan status: ${to}`);
  }
  if (from === to) {
    return to;
  }
  if (from === PLAN_ABANDONED || to === PLAN_ABANDONED) {
    throw new Error("no transitions to or from ABANDONED are defined");
  }
  const fromIndex = PLAN_LIFECYCLE.indexOf(from as PlanStatus);
  const toIndex = PLAN_LIFECYCLE.indexOf(to as PlanStatus);
  if (toIndex < fromIndex) {
    throw new Error(`backwards plan transition ${from} → ${to} is not allowed`);
  }
  return to;
}
