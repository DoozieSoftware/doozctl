/**
 * Domain types shared across the DoozCTL engine.
 *
 * The Artifact is the single core abstraction. Everything the engine renders,
 * merges, validates and writes is an Artifact: wrapper files (AGENTS.md etc.),
 * current context, session summaries, generated state — all treated
 * identically. Nothing is special-cased by file name or purpose.
 */

/** Variables resolved from repository analysis, available during rendering. */
export type Variables = Record<string, unknown>;

/** Controls how a generated artifact combines with existing on-disk content. */
export type MergeStrategy =
  /** Update managed sections only; preserve everything else. */
  | "managed-blocks"
  /** Replace previously generated files. */
  | "replace-generated"
  /** Replace the entire artifact. Used for generated state. */
  | "overwrite"
  /** Create new immutable artifacts. Used for session summaries. */
  | "append";

/**
 * A single generated artifact. Every command in the engine operates on this
 * type: rendered from a source template, merged per mergeStrategy, validated
 * against an optional schema, and written to destination.
 */
export interface Artifact {
  /** Stable identifier, used for manifest tracking and deduplication. */
  id: string;
  /** Template location within the Standards Package. */
  source: string;
  /** Target location inside the repository. */
  destination: string;
  /** Values substituted while rendering. */
  variables: Variables;
  /** Merge behavior. */
  mergeStrategy: MergeStrategy;
  /** Optional schema used during validation. */
  schema?: string;
}

/** Git facts about the analyzed repository. */
export interface GitFacts {
  /** Whether dir is inside a git repository. */
  isRepository: boolean;
  /** Current branch, or null when not a repository or detached HEAD. */
  branch: string | null;
  /** Whether the working tree differs from HEAD. */
  dirty: boolean;
}

/** File counts used to size the repository. */
export interface RepositoryStatistics {
  totalFiles: number;
  sourceFiles: number;
  testFiles: number;
}

/**
 * Factual repository metadata. No recommendations, no opinions.
 * Repository analysis becomes variables available during rendering.
 */
export interface Analysis {
  /** Absolute path of the analyzed repository root. */
  root: string;
  git: GitFacts;
  /** Detected programming languages, sorted. */
  languages: string[];
  /** Detected frameworks, sorted. */
  frameworks: string[];
  /** Detected build system, or null when none is recognized. */
  buildSystem: string | null;
  /** Detected package manager, or null when none is recognized. */
  packageManager: string | null;
  /** Detected test framework, or null when none is recognized. */
  testFramework: string | null;
  /** Detected CI providers, sorted. */
  ci: string[];
  /** Whether a Docker configuration is present. */
  docker: boolean;
  statistics: RepositoryStatistics;
  /** AI-related files present in the repository, detected only. */
  aiFiles: string[];
}

/**
 * A Standards Package manifest. The engine loads a package by its manifest —
 * it never scans directories or invents artifacts.
 */
export interface StandardsPackage {
  /** Package version. */
  version: string;
  /** Package-level variables applied to every artifact. */
  variables: Variables;
  /** The artifacts the package declares. */
  artifacts: Artifact[];
  /** Schemas referenced by artifacts, keyed by id. */
  schemas: Record<string, string>;
}

/** Records which artifacts the engine has generated. */
export interface Manifest {
  /** Format version. */
  version: number;
  /** Ids of generated artifacts. */
  artifacts: string[];
}

/** An immutable session summary. */
export interface Session {
  id: string;
  createdAt: Date;
  summary: string;
}

/** A loaded extension. */
export interface Plugin {
  name: string;
  version: string;
}
