/**
 * Canonical Artifact model.
 *
 * Everything DoozCTL produces or maintains is an Artifact. The engine operates
 * only on this model and never special-cases file names such as AGENTS.md,
 * CLAUDE.md, manifest.json or current-context.md — those are implementation
 * details supplied by an external Standards Package.
 *
 * The model carries specification, not content. An Artifact never contains
 * rendered output; rendering, merging, validation and persistence happen
 * downstream against this frozen shape.
 */

/** Named variables available during rendering. Resolution is out of scope here. */
export type Variables = Readonly<Record<string, unknown>>;

/**
 * How generated content combines with existing on-disk content.
 * Concept only — merge logic is implemented by the merge engine.
 */
export type MergeStrategy =
  /** Update managed sections only; preserve everything else. */
  | "managed-blocks"
  /** Replace previously generated files. */
  | "replace-generated"
  /** Replace the entire artifact. Used for generated state. */
  | "overwrite"
  /** Create new immutable artifacts. Used for session summaries. */
  | "append";

/** All supported merge strategies, in deterministic (alphabetical) order. */
export const MERGE_STRATEGIES: readonly MergeStrategy[] = [
  "append",
  "managed-blocks",
  "overwrite",
  "replace-generated",
];

/** Where an artifact's template originates inside the Standards Package. */
export interface ArtifactSource {
  /** Path to the source template within the Standards Package. */
  readonly path: string;
  /** Optional renderer format hint (for example "handlebars", "plain"). */
  readonly format?: string;
}

/** Where an artifact lands inside the repository. */
export interface ArtifactDestination {
  /** Path relative to the repository root. */
  readonly path: string;
}

/** Extensible metadata attached to an artifact. */
export interface ArtifactMetadata {
  /** Optional human-readable description. */
  readonly description?: string;
  /** Extension metadata, preserved verbatim by the engine. */
  readonly [key: string]: unknown;
}

/** A single generated artifact specification. Never contains rendered content. */
export interface Artifact {
  /** Stable identifier, used for manifest tracking and deduplication. */
  readonly id: string;
  /** Where the template lives inside the Standards Package. */
  readonly source: ArtifactSource;
  /** Where the artifact is written inside the repository. */
  readonly destination: ArtifactDestination;
  /** How generated content combines with existing content. */
  readonly mergeStrategy: MergeStrategy;
  /** Values substituted during rendering. */
  readonly variables: Variables;
  /** Optional schema reference used during validation. */
  readonly schema?: string;
  /** Extensible metadata. */
  readonly metadata: ArtifactMetadata;
}

/** Input for createArtifact; optional fields receive defaults. */
export interface ArtifactInput {
  readonly id: string;
  readonly source: ArtifactSource;
  readonly destination: ArtifactDestination;
  readonly mergeStrategy: MergeStrategy;
  readonly variables?: Variables;
  readonly schema?: string;
  readonly metadata?: ArtifactMetadata;
}

/** Deeply freeze a value and its nested objects, returning it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** Create a deeply frozen, immutable artifact. */
export function createArtifact(input: ArtifactInput): Artifact {
  const artifact: Artifact = {
    id: input.id,
    source: input.source,
    destination: input.destination,
    mergeStrategy: input.mergeStrategy,
    variables: input.variables ?? {},
    metadata: input.metadata ?? {},
    ...(input.schema !== undefined ? { schema: input.schema } : {}),
  };
  return deepFreeze(artifact);
}

/** Structural equality over plain values (records, arrays, primitives). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  ) {
    return false;
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Structural equality between two artifacts. */
export function artifactEquals(a: Artifact, b: Artifact): boolean {
  return (
    a.id === b.id &&
    a.source.path === b.source.path &&
    a.source.format === b.source.format &&
    a.destination.path === b.destination.path &&
    a.mergeStrategy === b.mergeStrategy &&
    a.schema === b.schema &&
    deepEqual(a.variables, b.variables) &&
    deepEqual(a.metadata, b.metadata)
  );
}
