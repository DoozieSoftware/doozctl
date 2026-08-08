import { merge } from "./merge.js";
import { RepositoryAnalyzer, type GitDetector } from "./repository-analyzer.js";
import { StandardsPackageLoader } from "./standards-loader.js";
import type {
  Analysis,
  Artifact,
  MergeStrategy,
  RenderedArtifact,
  StandardsPackage,
  Variables,
} from "../model/model.js";

/**
 * Extension point contracts.
 *
 * These interfaces are the seams the spec's extensibility requires: custom
 * analyzers, loaders, merge strategies, and validators plug in here. Real
 * runtime plugin discovery is deferred until it is needed; the default
 * implementations below delegate to the built-in engine implementations.
 *
 * The default renderer is not exposed here: templates live inside the Standards
 * Package, whose root is known only per run, so the render step constructs the
 * built-in ArtifactRenderer against the run's package directory.
 */

/** Repository Analyzer: produces factual repository metadata. */
export interface Analyzer {
  analyze(dir: string): Promise<Analysis>;
}

/** Standards Loader: loads a Standards Package manifest. */
export interface StandardsLoader {
  load(dir: string): Promise<StandardsPackage>;
}

/** Artifact Renderer: turns a template into content using resolved variables. */
export interface Renderer {
  render(artifact: Artifact, variables: Variables): Promise<RenderedArtifact>;
}

/** Merge strategy: combines rendered content with existing on-disk content. */
export interface StrategyMerger {
  merge(artifact: Artifact, rendered: string, existing: string | null): Promise<string>;
}

/** Validator: checks artifact content against an optional schema. */
export interface Validator {
  validate(content: string, schema: string | null): Promise<void>;
}

/** Default Analyzer implementation backed by the repository analyzer. */
export class DefaultAnalyzer implements Analyzer {
  private readonly impl: Analyzer;

  constructor(git: GitDetector) {
    this.impl = new RepositoryAnalyzer({ git });
  }

  analyze(dir: string): Promise<Analysis> {
    return this.impl.analyze(dir);
  }
}

/** Default Standards Loader implementation backed by the package loader. */
export class DefaultStandardsLoader implements StandardsLoader {
  private readonly impl = new StandardsPackageLoader();

  load(dir: string): Promise<StandardsPackage> {
    return this.impl.load(dir);
  }
}

/**
 * Default Validator implementation. Schema validation is a later phase; the
 * built-in validator currently accepts any content so the pipeline completes.
 */
export class DefaultValidator implements Validator {
  validate(_content: string, _schema: string | null): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Merge engine adapter: applies the frozen merge semantics from merge.ts.
 * Each strategy resolves to a deterministic, text-only transformation.
 */
class MergeEngineStrategy implements StrategyMerger {
  constructor(private readonly strategy: MergeStrategy) {}
  merge(_artifact: Artifact, rendered: string, existing: string | null): Promise<string> {
    // A missing destination is written directly; merge only applies to files
    // that already exist (frozen merge rule).
    if (existing === null) {
      return Promise.resolve(rendered);
    }
    return Promise.resolve(merge(this.strategy, existing, rendered));
  }
}

/** Maps every built-in merge strategy to its real merge-engine implementation. */
export function builtinMergers(): Record<MergeStrategy, StrategyMerger> {
  return {
    "managed-blocks": new MergeEngineStrategy("managed-blocks"),
    "replace-generated": new MergeEngineStrategy("replace-generated"),
    overwrite: new MergeEngineStrategy("overwrite"),
    append: new MergeEngineStrategy("append"),
  };
}
