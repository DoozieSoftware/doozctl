import type { Artifact, RenderedArtifact, Variables } from "../model/model.js";
import type { Storage } from "../store/storage.js";
import type { Renderer } from "./contracts.js";

/**
 * Artifact Renderer: converts an Artifact plus resolved Variables into a
 * RenderedArtifact.
 *
 * Rendering is the Mustache subset SPEC.md freezes: plain `{{dotted.path}}`
 * placeholders substituted against the variables. The contract forbids every
 * other Mustache feature (sections, partials, helpers, comments, triple
 * mustache), and this renderer supports none of them — any `{{...}}` that does
 * not resolve to a value becomes an empty string. Text is rendered unescaped:
 * artifacts are plain-text/Markdown, not HTML. Output is UTF-8 with LF line
 * endings and deterministic for identical input. Nothing is written to disk.
 */

/** Matches any `{{...}}` placeholder; unsupported tags resolve to empty. */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Render `template` against `variables`; pure and deterministic. */
export function renderTemplate(template: string, variables: Variables): string {
  return template
    .replace(/\r\n?/g, "\n")
    .replace(PLACEHOLDER, (_match, tag: string) => format(resolvePath(variables, tag)));
}

/** Resolve a dotted path against the variables, or undefined when missing. */
function resolvePath(variables: unknown, path: string): unknown {
  let current: unknown = variables;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    const record = current as Record<string, unknown>;
    if (!(part in record)) {
      return undefined;
    }
    current = record[part];
  }
  return current;
}

/** Coerce a resolved value to output text; missing values become empty. */
function format(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(format).join(",");
  }
  return String(value);
}

/** Reads artifact source templates from a package and renders them. */
export class ArtifactRenderer implements Renderer {
  constructor(private readonly templates: Storage) {}

  async render(artifact: Artifact, variables: Variables): Promise<RenderedArtifact> {
    const template = await this.templates.read(artifact.source.path);
    return { artifact, content: renderTemplate(template, variables) };
  }
}
