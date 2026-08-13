import type { Variables } from "../model/model.js";
import { resolvePath } from "./artifact-renderer.js";

/**
 * Session and context logic for the summarize command.
 *
 * A session is the immutable record of one AI working session. Its sections —
 * Objective, Summary, Decisions, Files Changed, Next Steps, Open Questions —
 * are the frozen contract a session must be understandable on its own, without
 * reading earlier sessions. The current context is the distilled, one-page
 * memory derived from the latest session, carrying forward the Objective and
 * Open Questions the session did not change. Everything here is pure and
 * deterministic: no clocks, no filesystem, no git.
 */

/** Maximum length of a single current-context field (~1 page across five). */
export const MAX_CONTEXT_FIELD_CHARS = 400;

/**
 * Hard budget for a session summary's raw content (~12 KB). Sessions keep a
 * durable engineering record, not a transcript: content beyond the budget is
 * truncated with a notice so the session file cannot grow without bound.
 */
export const SESSION_CONTENT_BUDGET = 12 * 1024;

/** The six sections a session summary may contain, in contract order. */
export const SESSION_SECTIONS = [
  "Objective",
  "Summary",
  "Decisions",
  "Files Changed",
  "Next Steps",
  "Open Questions",
] as const;

/** A parsed session summary. */
export interface SessionSections {
  objective: string;
  summary: string;
  decisions: string;
  filesChanged: string;
  nextSteps: string;
  openQuestions: string;
}

/** The pieces of the previous current context used for carry-forward. */
export interface PreviousContext {
  objective: string;
  openQuestions: string;
}

/** Parse `## Section` blocks out of session content; missing sections become "". */
export function parseSessionSections(content: string): SessionSections {
  const sections = parseSections(content, /^##\s+([^\n]+?)\s*$/);
  const get = (name: string): string => sections.get(name) ?? "";
  return {
    objective: get("Objective"),
    summary: get("Summary"),
    decisions: get("Decisions"),
    filesChanged: get("Files Changed"),
    nextSteps: get("Next Steps"),
    openQuestions: get("Open Questions"),
  };
}

/** Parse the Objective and Open Questions out of the previous current context. */
export function extractPreviousContext(content: string): PreviousContext {
  const sections = parseSections(content, /^#\s+([^\n]+?)\s*$/);
  return {
    objective: sections.get("Current Objective") ?? "",
    openQuestions: sections.get("Open Questions") ?? "",
  };
}

/**
 * Carry forward: a session that does not define an Objective or Open Questions
 * keeps the previous context's values instead of going blank.
 */
export function resolveContextFields(
  sections: SessionSections,
  previous: PreviousContext,
): SessionSections {
  return {
    ...sections,
    objective: sections.objective !== "" ? sections.objective : previous.objective,
    openQuestions: sections.openQuestions !== "" ? sections.openQuestions : previous.openQuestions,
  };
}

/** Truncate a current-context field to the one-page cap. */
export function capField(value: string): string {
  if (value.length <= MAX_CONTEXT_FIELD_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_CONTEXT_FIELD_CHARS).trimEnd()}…`;
}

/**
 * Cap raw session content to the session budget, appending a truncation
 * notice. Content within the budget is returned unchanged.
 */
export function capSessionContent(content: string): string {
  if (content.length <= SESSION_CONTENT_BUDGET) {
    return content;
  }
  const head = content.slice(0, SESSION_CONTENT_BUDGET).trimEnd();
  return [
    head,
    "",
    `…[truncated: session content exceeded the ${SESSION_CONTENT_BUDGET}-character budget; summarize durable context only]`,
  ].join("\n");
}

/** Session file id from a date: `YYYY-MM-DD_HHMMSS`. */
export function formatSessionId(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    p(date.getMonth() + 1),
    "-",
    p(date.getDate()),
    "_",
    p(date.getHours()),
    p(date.getMinutes()),
    p(date.getSeconds()),
  ].join("");
}

/** Local ISO timestamp with offset, for the session front-matter. */
export function toLocalIso(date: Date): string {
  const p = (n: number, width = 2): string => String(n).padStart(width, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return [
    date.getFullYear(),
    "-",
    p(date.getMonth() + 1),
    "-",
    p(date.getDate()),
    "T",
    p(date.getHours()),
    ":",
    p(date.getMinutes()),
    ":",
    p(date.getSeconds()),
    sign,
    p(Math.floor(abs / 60)),
    ":",
    p(abs % 60),
  ].join("");
}

/**
 * Resolve `{{dotted.path}}` references in a destination template against the
 * render variables. Values must be strings; missing or non-string values
 * resolve to the empty string.
 */
export function resolveDestinationTemplate(template: string, variables: Variables): string {
  return template.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_match, tag: string) => {
    const value = resolvePath(variables, tag.trim());
    return typeof value === "string" ? value : "";
  });
}

/** Split content into named sections by the given heading pattern. */
function parseSections(content: string, heading: RegExp): Map<string, string> {
  const sections = new Map<string, string>();
  let current: string | null = null;
  const buffer: string[] = [];
  const flush = (): void => {
    if (current !== null) {
      sections.set(current, buffer.join("\n").trim());
    }
    buffer.length = 0;
  };
  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    const match = heading.exec(line);
    if (match !== null) {
      flush();
      current = match[1] as string;
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}
