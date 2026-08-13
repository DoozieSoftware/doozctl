/**
 * Repository-local workflow adoption for DoozCTL v2.
 *
 * WORKFLOW-SPEC.md: a repository adopts workflow methods by copying their
 * Markdown documents into `.dooz/workflows/adopted/`; project-specific methods
 * live in `.dooz/workflows/project/`. Adoption is file presence — a method is
 * adopted iff its document exists. There is no registry, no schema, and no
 * inheritance engine; the engine reads only each document's id from its
 * `## Metadata` section.
 *
 * A method id must be adopted in exactly one place. The same id in both
 * `adopted/` and `project/` is ambiguous and fails loudly; the engine never
 * guesses which document wins.
 */

import { Storage } from "../store/storage.js";

/**
 * The default plan method, per WORKFLOW-SPEC.md: `standard` "When to Use —
 * Default. Use when no specialized method applies."
 */
export const DEFAULT_METHOD = "standard";

/** A workflow method id: lowercase kebab-case, mirroring plan ids. */
const METHOD_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Whether `id` is a valid workflow method id. */
export function isValidWorkflowMethodId(id: string): boolean {
  return METHOD_ID_PATTERN.test(id);
}

/** The workflow document filename for a method id. Expects a validated id. */
export function workflowFilename(id: string): string {
  return `${id}.md`;
}

/** A resolved, validated adopted workflow method document. */
export interface AdoptedWorkflow {
  readonly id: string;
  /** Which control-plane directory the document came from. */
  readonly source: "adopted" | "project";
  readonly content: string;
}

/**
 * Resolve a workflow method id against the repository control plane.
 *
 * The id is validated before any filesystem access, so it can never carry a
 * path (traversal, absolute paths, hostile filenames). Discovery is
 * deterministic: both `adopted/` and `project/` are inspected, and the same id
 * in both fails loudly rather than guessing. A missing method fails loudly
 * with no fallback, and a document whose declared id does not match its
 * filename is rejected as malformed.
 */
export async function resolveAdoptedWorkflow(root: string, id: string): Promise<AdoptedWorkflow> {
  if (!isValidWorkflowMethodId(id)) {
    throw new Error(`invalid workflow method id: ${id}`);
  }
  const filename = workflowFilename(id);
  const storage = new Storage(root);
  const adoptedPath = [".dooz", "workflows", "adopted", filename];
  const projectPath = [".dooz", "workflows", "project", filename];
  const adopted = await storage.exists(...adoptedPath);
  const project = await storage.exists(...projectPath);
  if (adopted && project) {
    throw new Error(`duplicate workflow method: ${id} (adopted/ and project/ both define it)`);
  }
  if (!adopted && !project) {
    throw new Error(`workflow method not adopted: ${id}`);
  }
  const parts = adopted ? adoptedPath : projectPath;
  const content = await storage.read(...parts);
  const declared = parseWorkflowMethodId(content);
  if (declared === undefined || declared !== id) {
    throw new Error(`workflow method asset is malformed: ${id}`);
  }
  return { id, source: adopted ? "adopted" : "project", content };
}

/** The `- id:` value inside the `## Metadata` section, if present. */
function parseWorkflowMethodId(content: string): string | undefined {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const metaIndex = lines.findIndex((line) => /^##\s+Metadata\s*$/.test(line));
  if (metaIndex === -1) {
    return undefined;
  }
  for (let i = metaIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (/^##\s/.test(line)) {
      break;
    }
    const match = /^-\s*id:\s*(.*?)\s*$/.exec(line);
    if (match !== null) {
      return (match[1] ?? "").trim();
    }
  }
  return undefined;
}
