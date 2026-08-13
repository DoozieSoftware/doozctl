import type { MergeStrategy } from "../model/model.js";

/**
 * Merge Engine: combines a rendered artifact with existing repository content.
 *
 * The engine knows only text. It never reads or writes files, never runs Git,
 * and never touches repositories. It transforms strings in memory and returns
 * either the merged content or an explicit error.
 *
 * Semantics are frozen in SPEC.md: exactly four strategies, no extra merging,
 * no conflict resolution, no repair of malformed input. The marker format is
 * frozen forever in the `v1` form.
 */

/** Frozen marker prefix. Do not evolve; a new format requires a new version. */
const BEGIN_PREFIX = "<!-- DOOZCTL:BEGIN:v1";
const END_PREFIX = "<!-- DOOZCTL:END:v1";

/** Any managed-block marker line (BEGIN or END). */
const MANAGED_LINE = /^<!-- DOOZCTL:(BEGIN|END):v1 /;
/** The generated-file marker line. */
const GENERATED_LINE = /^<!-- DOOZCTL:GENERATED:v1 ?-->$/;

/** Whether `content` starts with the engine-generated marker. */
export function isGeneratedFile(content: string): boolean {
  const firstLine = content.split("\n", 1)[0] as string;
  return GENERATED_LINE.test(firstLine);
}

/**
 * Validate that `content` is a well-formed managed-blocks document (markers
 * parse, every BEGIN is matched, names are unique, nothing nests). Throws
 * MergeError when malformed. Used by doctor to check artifact integrity.
 */
export function validateManagedBlocks(content: string): void {
  parseBlocks(content);
}

/** Error thrown for every malformed or impossible merge. */
export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeError";
  }
}

/** A parsed managed block: its name and its exact surrounding line indices. */
interface Block {
  name: string;
  beginIndex: number;
  endIndex: number;
}

/**
 * Parse the managed blocks of `content` into `Block`s, throwing MergeError on
 * any malformed marker. Enforces: markers are well-formed, every BEGIN is
 * matched by an END, section names are unique, and blocks do not nest.
 */
function parseBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];
  const open = new Map<string, number>(); // name -> beginIndex

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const beginMarker = matchMarker(line, BEGIN_PREFIX);
    if (beginMarker !== null) {
      if (beginMarker.name === null) {
        throw new MergeError(`malformed BEGIN marker on line ${i + 1}`);
      }
      if (open.has(beginMarker.name)) {
        throw new MergeError(`nested managed block "${beginMarker.name}"`);
      }
      if (blocks.some((b) => b.name === beginMarker.name)) {
        throw new MergeError(`duplicate managed block "${beginMarker.name}"`);
      }
      open.set(beginMarker.name, i);
      continue;
    }

    const endMarker = matchMarker(line, END_PREFIX);
    if (endMarker !== null) {
      if (endMarker.name === null) {
        throw new MergeError(`malformed END marker on line ${i + 1}`);
      }
      const beginIndex = open.get(endMarker.name);
      if (beginIndex === undefined) {
        throw new MergeError(`END without BEGIN for "${endMarker.name}"`);
      }
      open.delete(endMarker.name);
      blocks.push({ name: endMarker.name, beginIndex, endIndex: i });
      continue;
    }

    // Any line that is clearly an intended managed marker but does not parse
    // is an error. The generated marker is only consulted by replace-generated.
    if (MANAGED_LINE.test(line)) {
      throw new MergeError(`malformed marker on line ${i + 1}`);
    }
  }

  if (open.size > 0) {
    const name = [...open.keys()][0] as string;
    throw new MergeError(`BEGIN without END for "${name}"`);
  }
  return blocks;
}

/**
 * If `line` starts with `prefix`, return the parsed section name, or null as
 * `name` when the marker is malformed. Return null when the line is not a
 * marker of this kind.
 */
function matchMarker(line: string, prefix: string): { name: string | null } | null {
  if (!line.startsWith(prefix)) {
    return null;
  }
  const rest = line.slice(prefix.length);
  // Must be exactly ` name -->` where name has no whitespace or `-->`.
  const match = /^ ([\w.-]+) -->$/.exec(rest);
  if (match === null) {
    return { name: null };
  }
  return { name: match[1] as string };
}

/**
 * Replace the content of each managed block in `existing` with the matching
 * block content from `rendered`. Content outside the blocks is preserved
 * byte-for-byte. The rendered artifact supplies the canonical marker lines and
 * block contents; any block present in one but not the other is an error.
 */
function mergeManagedBlocks(existing: string, rendered: string): string {
  const existingBlocks = parseBlocks(existing);
  const renderedBlocks = parseBlocks(rendered);

  if (existingBlocks.length === 0) {
    throw new MergeError("existing file has no managed block markers");
  }
  if (renderedBlocks.length === 0) {
    throw new MergeError("rendered artifact has no managed block markers");
  }

  const renderedByName = new Map(renderedBlocks.map((b) => [b.name, b]));
  const existingNames = new Set(existingBlocks.map((b) => b.name));

  for (const b of renderedBlocks) {
    if (!existingNames.has(b.name)) {
      throw new MergeError(`managed block "${b.name}" not present in existing file`);
    }
  }
  for (const b of existingBlocks) {
    if (!renderedByName.has(b.name)) {
      throw new MergeError(`managed block "${b.name}" missing from rendered artifact`);
    }
  }

  const existingLines = existing.split("\n");
  const renderedLines = rendered.split("\n");

  // Replace from the end so earlier index stays valid.
  const sorted = [...existingBlocks].sort((a, b) => b.beginIndex - a.beginIndex);
  for (const block of sorted) {
    const renderedBlock = renderedByName.get(block.name) as Block;
    const replacement = renderedLines.slice(renderedBlock.beginIndex, renderedBlock.endIndex + 1);
    existingLines.splice(block.beginIndex, block.endIndex - block.beginIndex + 1, ...replacement);
  }
  return existingLines.join("\n");
}

/** Merge `rendered` into `existing` per the frozen strategy rules. */
export function merge(strategy: MergeStrategy, existing: string, rendered: string): string {
  switch (strategy) {
    case "overwrite":
      return rendered;
    case "append":
      return existing + rendered;
    case "replace-generated": {
      const firstLine = existing.split("\n", 1)[0] as string;
      if (!GENERATED_LINE.test(firstLine)) {
        throw new MergeError(
          "existing file is not engine-generated; refusing replace-generated overwrite",
        );
      }
      return rendered;
    }
    case "managed-blocks":
      return mergeManagedBlocks(existing, rendered);
    default: {
      const neverStrategy: never = strategy;
      throw new MergeError(`unknown merge strategy: ${String(neverStrategy)}`);
    }
  }
}
