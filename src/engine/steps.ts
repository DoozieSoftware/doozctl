import { NotImplementedError } from "../errors.js";
import type { GitService } from "../infra/git/git.js";
import type { RenderedArtifact } from "../model/model.js";
import type { MergeStrategy } from "../model/model.js";
import type { RepositoryStore } from "../store/repository-store.js";
import { Storage } from "../store/storage.js";
import { ArtifactRenderer } from "./artifact-renderer.js";
import type { Analyzer, StandardsLoader, StrategyMerger, Validator } from "./contracts.js";
import type { ExecutionContext, PipelineStep } from "./engine.js";
import { resolveVariables } from "./variable-resolver.js";

/**
 * Pipeline steps. Each step is an independent function operating on the shared
 * ExecutionContext. Steps are built by factories that receive their
 * infrastructure dependencies via constructor injection.
 *
 * Analyzer, loader and store methods take the directory at call time; Storage
 * is sandboxed to a root, so filesystem-backed steps construct it per run from
 * the execution context (the repository and package roots are per-run values).
 */

const stub = (name: string): PipelineStep => {
  const step: PipelineStep = async (_ctx: ExecutionContext): Promise<void> => {
    throw new NotImplementedError(`engine.${name}`);
  };
  Object.defineProperty(step, "name", { value: `${name}Step`, configurable: true });
  return step;
};

/** Give a step its stable function name, which pipeline tests rely on. */
function named(name: string, step: PipelineStep): PipelineStep {
  Object.defineProperty(step, "name", { value: `${name}Step`, configurable: true });
  return step;
}

/** Read a file relative to a Storage root, or null when it does not exist. */
async function readOrNull(repo: Storage, dest: string): Promise<string | null> {
  try {
    return await repo.read(dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** Dependencies for the analyze step. */
export interface AnalyzeDeps {
  git: GitService;
  analyzer: Analyzer;
}

/** Analyze: produce factual repository metadata. */
export function analyzeStep(deps: AnalyzeDeps): PipelineStep {
  return named("analyze", async (ctx) => {
    ctx.analysis = await deps.analyzer.analyze(ctx.root);
  });
}

/** Dependencies for the load step. */
export interface LoadDeps {
  loader: StandardsLoader;
}

/** Load: load the Standards Package manifest. */
export function loadStep(deps: LoadDeps): PipelineStep {
  return named("load", async (ctx) => {
    const pkg = await deps.loader.load(ctx.standardsDir);
    ctx.standards = pkg;
    ctx.artifacts = pkg.artifacts;
  });
}

/** Resolve Variables: derive render variables from the analysis. */
export function resolveVariablesStep(): PipelineStep {
  return named("resolveVariables", async (ctx) => {
    if (ctx.analysis === null) {
      throw new Error("no repository analysis available; run analyze before resolving variables");
    }
    ctx.variables = resolveVariables(ctx.analysis);
  });
}

/** Render: render each artifact from its source template. */
export function renderStep(): PipelineStep {
  return named("render", async (ctx) => {
    const renderer = new ArtifactRenderer(new Storage(ctx.standardsDir));
    const rendered: RenderedArtifact[] = [];
    for (const artifact of ctx.artifacts) {
      rendered.push(await renderer.render(artifact, ctx.variables));
    }
    ctx.rendered = rendered;
  });
}

/** Dependencies for the merge step. */
export interface MergeDeps {
  mergers: Record<MergeStrategy, StrategyMerger>;
}

/** Merge: combine rendered content with existing files per merge strategy. */
export function mergeStep(deps: MergeDeps): PipelineStep {
  return named("merge", async (ctx) => {
    const repo = new Storage(ctx.root);
    const merged: RenderedArtifact[] = [];
    for (const rendered of ctx.rendered) {
      const artifact = rendered.artifact;
      const existing = await readOrNull(repo, artifact.destination.path);
      const content = await deps.mergers[artifact.mergeStrategy].merge(
        artifact,
        rendered.content,
        existing,
      );
      merged.push({ artifact, content });
    }
    ctx.merged = merged;
  });
}

/** Dependencies for the validate step. */
export interface ValidateDeps {
  validator: Validator;
}

/** Validate: check rendered artifacts against their optional schemas. */
export function validateStep(deps: ValidateDeps): PipelineStep {
  return named("validate", async (ctx) => {
    for (const rendered of ctx.rendered) {
      const schema = rendered.artifact.schema;
      if (schema === undefined) {
        continue;
      }
      await deps.validator.validate(rendered.content, schema);
    }
  });
}

/** Dependencies for the write step. */
export interface WriteDeps {
  store: RepositoryStore;
}

/**
 * Write: persist merged artifacts, then regenerate the engine's generated
 * state — the manifest (`.dooz/manifest.json`) and repository analysis
 * (`.ai/repository-analysis.json`). A destination is written only when its
 * content differs from what is already on disk, so re-running init is a no-op.
 */
export function writeStep(deps: WriteDeps): PipelineStep {
  return named("write", async (ctx) => {
    const repo = new Storage(ctx.root);
    for (const merged of ctx.merged) {
      const dest = merged.artifact.destination.path;
      const current = await readOrNull(repo, dest);
      if (current === merged.content) {
        continue;
      }
      await repo.write(merged.content, dest);
    }
    await deps.store.saveManifest(ctx.root, {
      version: 1,
      artifacts: ctx.merged.map((m) => m.artifact.id),
    });
    if (ctx.analysis !== null) {
      await deps.store.saveAnalysis(ctx.root, ctx.analysis);
    }
  });
}

/** Dependencies for the save-analysis step. */
export interface SaveAnalysisDeps {
  store: RepositoryStore;
}

/** Save Analysis: persist repository analysis (read-only command). */
export function saveAnalysisStep(deps: SaveAnalysisDeps): PipelineStep {
  return named("saveAnalysis", async (ctx) => {
    if (ctx.analysis === null) {
      throw new Error("no repository analysis available; run analyze before saving analysis");
    }
    await deps.store.saveAnalysis(ctx.root, ctx.analysis);
  });
}

/** Report: produce a human-readable report for read-only commands. */
export function reportStep(): PipelineStep {
  return stub("report");
}
