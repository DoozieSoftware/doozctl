import { NotImplementedError } from "../errors.js";
import type {
  Analysis,
  Artifact,
  MergeStrategy,
  StandardsPackage,
  Variables,
} from "../model/model.js";

/**
 * Extension point contracts.
 *
 * These interfaces are the seams the spec's extensibility requires: custom
 * analyzers, loaders, renderers, merge strategies, and validators plug in here.
 * Real runtime plugin discovery is deferred until it is needed; the default
 * implementations below are scaffolding that throw NotImplementedError.
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
  render(artifact: Artifact, variables: Variables): Promise<string>;
}

/** Merge strategy: combines rendered content with existing on-disk content. */
export interface StrategyMerger {
  merge(artifact: Artifact, rendered: string, existing: string | null): Promise<string>;
}

/** Validator: checks artifact content against an optional schema. */
export interface Validator {
  validate(content: string, schema: string | null): Promise<void>;
}

const notImplemented =
  (name: string) =>
  (..._args: unknown[]): Promise<never> =>
    Promise.reject(new NotImplementedError(name));

/** Default Analyzer implementation (scaffolding). */
export class DefaultAnalyzer implements Analyzer {
  analyze(_dir: string): Promise<Analysis> {
    return notImplemented("analyzer")();
  }
}

/** Default Standards Loader implementation (scaffolding). */
export class DefaultStandardsLoader implements StandardsLoader {
  load(_dir: string): Promise<StandardsPackage> {
    return notImplemented("loader")();
  }
}

/** Default Renderer implementation (scaffolding). */
export class DefaultRenderer implements Renderer {
  render(_artifact: Artifact, _variables: Variables): Promise<string> {
    return notImplemented("renderer")();
  }
}

/** Default Validator implementation (scaffolding). */
export class DefaultValidator implements Validator {
  validate(_content: string, _schema: string | null): Promise<void> {
    return notImplemented("validator")();
  }
}

/**
 * Default merge strategy (scaffolding). Each strategy has its own instance so
 * that distinct merge behavior can be attached per strategy without the engine
 * special-casing any artifact.
 */
class StubStrategyMerger implements StrategyMerger {
  merge(_artifact: Artifact, _rendered: string, _existing: string | null): Promise<string> {
    return notImplemented("merger")();
  }
}

/** Maps every built-in merge strategy to its merger implementation. */
export function builtinMergers(): Record<MergeStrategy, StrategyMerger> {
  return {
    "managed-blocks": new StubStrategyMerger(),
    "replace-generated": new StubStrategyMerger(),
    overwrite: new StubStrategyMerger(),
    append: new StubStrategyMerger(),
  };
}
