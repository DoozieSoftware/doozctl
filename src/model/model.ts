/**
 * Domain types shared across the DoozCTL engine.
 *
 * The canonical Artifact model lives in artifact.ts; it is re-exported here
 * for consumers that import the domain types from this module.
 */

export type {
  Artifact,
  ArtifactDestination,
  ArtifactInput,
  ArtifactMetadata,
  ArtifactSource,
  MergeStrategy,
  Variables,
  artifactEquals,
  createArtifact,
} from "./artifact.js";

import type { Artifact, Variables } from "./artifact.js";

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
