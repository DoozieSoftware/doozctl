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
  RenderedArtifact,
  Variables,
  Workflow,
  artifactEquals,
  createArtifact,
} from "./artifact.js";

import type { Artifact } from "./artifact.js";

/** Git facts about the analyzed repository. */
export interface GitFacts {
  /** Whether dir is inside a git repository. */
  isRepository: boolean;
  /** Current branch, or null when not a repository or detached HEAD. */
  branch: string | null;
  /** Whether the working tree differs from HEAD. */
  dirty: boolean;
  /**
   * Short HEAD hash the analysis describes, or null when not a repository,
   * the repository has no commits yet, or the read failed. v3 baseline
   * (CONTEXT-SPEC §5). v2-era analysis files without this key parse without
   * it; readers tolerate absence with `?? null` and treat the artifact as
   * having no baseline (never INVALID).
   */
  commit: string | null;
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
}

/**
 * A loaded Standards Package. The engine loads a package by its manifest —
 * it never scans directories or invents artifacts.
 */
export interface StandardsPackage {
  /** Package structure format version, read by the loader. */
  format: number;
  /** Package name. */
  name: string;
  /** Version of the standards package itself. */
  version: string;
  /** Required engine version range. Metadata only; not enforced. */
  engine: string;
  /** The artifacts the package declares. */
  artifacts: Artifact[];
}

/** One generated artifact record in the engine manifest. */
export interface ManifestEntry {
  /** Stable artifact id, matching the Standards Package declaration. */
  id: string;
  /** Repository-relative destination the artifact was written to. */
  destination: string;
}

/** Records which artifacts the engine has generated. */
export interface Manifest {
  /** Format version. */
  version: number;
  /**
   * Records of generated artifacts (id + destination). Legacy records from
   * manifests written before the destination binding are plain ids; they are
   * tolerated on read but grant no overwrite ownership.
   */
  artifacts: Array<ManifestEntry | string>;
}

/**
 * Input for creating a session during summarize. The id and date are derived
 * from the clock by the app layer; content is the AI-authored session summary.
 */
export interface SessionInput {
  /** Session file id, `YYYY-MM-DD_HHMMSS`. */
  id: string;
  /** Local ISO timestamp with offset, recorded in the session front-matter. */
  date: string;
  /** The AI-authored session summary content. */
  content: string;
  /** Tool that produced the session, or "". */
  tool: string;
  /** Model that produced the session, or "". */
  model: string;
  /** User who ran the session, or "". */
  user: string;
  /**
   * v3 provenance: the plan id the session was written against, or "" when
   * no single active plan exists. Resolved by the app layer (which knows the
   * active plan) and exposed to templates as `session.source` =
   * `plan:<id>` / "" (CONTEXT-SPEC §5.2, v3 A-3).
   */
  sourcePlan: string;
  /**
   * v3 (P11, A-6): the active plan's validated scope paths, carried forward
   * into the session/current-context baseline blocks so the handover chain
   * inherits the plan's described scope, or [] when no single active plan
   * exists or the plan declares none. Pure parse of the plan document — no
   * evaluation.
   */
  planScopePaths: string[];
  /**
   * v3 (P11, §13): the active plan's P06 trust state token, or "" when no
   * single active plan exists or it cannot be evaluated. Drives the
   * stale-context qualifier at handover. Consumed read-only — the existing
   * integrity evaluation, never a new one.
   */
  planTrust: string;
  /** v3 (P11): the plan's deterministic drift reasons when trust is STALE. */
  planDrift: string[];
}
