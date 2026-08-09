import type { GitService } from "../infra/git/git.js";
import { createArtifact } from "../model/artifact.js";
import type { Manifest, RenderedArtifact, SessionInput, Workflow } from "../model/model.js";
import type { MergeStrategy } from "../model/model.js";
import type { RepositoryStore } from "../store/repository-store.js";
import { Storage } from "../store/storage.js";
import { ArtifactRenderer } from "./artifact-renderer.js";
import type { Analyzer, StandardsLoader, StrategyMerger, Validator } from "./contracts.js";
import type { PipelineStep } from "./engine.js";
import {
  capField,
  extractPreviousContext,
  parseSessionSections,
  resolveContextFields,
  resolveDestinationTemplate,
} from "./session.js";
import { buildDoctorReport, buildStatusReport } from "./report.js";
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

/**
 * Lifecycle: keep only the artifacts that participate in the current workflow.
 * Artifacts outside the workflow's lifecycle are invisible to it — they are
 * not rendered, merged or written. This is how append-only session artifacts
 * stay untouched by init and sync.
 */
export function lifecycleStep(workflow: Workflow): PipelineStep {
  return named("lifecycle", async (ctx) => {
    ctx.artifacts = ctx.artifacts.filter((artifact) => artifact.lifecycle.includes(workflow));
  });
}

/** Dependencies for the session step. */
export interface SessionDeps {
  git: GitService;
}

/**
 * Session: build the render variables for the summarize command. Parses the
 * AI-authored session content into sections, applies carry-forward from the
 * previous current context (Objective and Open Questions the session did not
 * change), records git facts, and refuses to overwrite an existing immutable
 * session file (a same-second collision).
 */
export function sessionStep(deps: SessionDeps, input: SessionInput): PipelineStep {
  return named("session", async (ctx) => {
    const repo = new Storage(ctx.root);
    const sections = parseSessionSections(input.content);
    const previousRaw = await readOrNull(repo, ".ai/current-context.md");
    const previous = extractPreviousContext(previousRaw ?? "");
    const fields = resolveContextFields(sections, previous);
    const commit = (await deps.git.commitHash(ctx.root)) ?? "";
    const branch = ctx.analysis?.git.branch ?? "";

    ctx.variables = {
      ...ctx.variables,
      session: {
        id: input.id,
        date: input.date,
        tool: input.tool,
        model: input.model,
        user: input.user,
        commit,
        branch,
        content: input.content,
        objective: capField(fields.objective),
        summary: capField(fields.summary),
        decisions: capField(fields.decisions),
        filesChanged: capField(fields.filesChanged),
        nextSteps: capField(fields.nextSteps),
        openQuestions: capField(fields.openQuestions),
      },
    };

    const sessionArtifact = ctx.artifacts.find((artifact) => artifact.mergeStrategy === "append");
    if (sessionArtifact !== undefined) {
      const dest = resolveDestinationTemplate(sessionArtifact.destination.path, ctx.variables);
      if (await repo.exists(dest)) {
        throw new Error(
          `session file already exists and is immutable: ${dest}. Wait one second and run summarize again.`,
        );
      }
    }
  });
}

/**
 * Resolve `{{variable}}` references in artifact destinations against the render
 * variables. Sessions declare their destination as
 * `.ai/sessions/{{session.id}}.md`; this step materializes it to a concrete
 * path before rendering and writing. Artifacts without references are returned
 * unchanged.
 */
export function resolveDestinationStep(): PipelineStep {
  return named("resolveDestination", async (ctx) => {
    ctx.artifacts = ctx.artifacts.map((artifact) => {
      const path = resolveDestinationTemplate(artifact.destination.path, ctx.variables);
      if (path === artifact.destination.path) {
        return artifact;
      }
      return createArtifact({
        id: artifact.id,
        source: artifact.source,
        destination: { path },
        mergeStrategy: artifact.mergeStrategy,
        lifecycle: artifact.lifecycle,
        variables: artifact.variables,
        metadata: artifact.metadata,
        ...(artifact.schema !== undefined ? { schema: artifact.schema } : {}),
      });
    });
  });
}

/** Dependencies for the load-repository-state step. */
export interface LoadStateDeps {
  store: RepositoryStore;
}

/**
 * Load Repository State: verify the repository is initialized and load the
 * persisted engine state (`.dooz/manifest.json` and
 * `.ai/repository-analysis.json`). sync re-renders from the stored analysis —
 * it never re-analyzes, so re-running it is deterministic.
 */
export function loadRepositoryStateStep(deps: LoadStateDeps): PipelineStep {
  return named("loadState", async (ctx) => {
    const repo = new Storage(ctx.root);

    if (!(await repo.exists(".dooz", "manifest.json"))) {
      throw new Error(
        "repository is not initialized: .dooz/manifest.json is missing. Run doozctl init <repo> <package> first.",
      );
    }
    let manifest: Manifest;
    try {
      manifest = await deps.store.loadManifest(ctx.root);
    } catch {
      throw new Error(
        "repository manifest is malformed: .dooz/manifest.json. Re-run doozctl init to repair it.",
      );
    }
    if (manifest.version !== 1) {
      throw new Error(
        `unsupported manifest version ${manifest.version}; expected version 1. Re-run doozctl init to repair it.`,
      );
    }
    ctx.manifest = manifest;

    if (!(await repo.exists(".ai", "repository-analysis.json"))) {
      throw new Error(
        "repository analysis is missing: .ai/repository-analysis.json. Run doozctl init or doozctl analyze first.",
      );
    }
    try {
      ctx.analysis = await deps.store.loadAnalysis(ctx.root);
    } catch {
      throw new Error(
        "repository analysis is malformed: .ai/repository-analysis.json. Re-run doozctl init or doozctl analyze to repair it.",
      );
    }
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
 *
 * The manifest records every artifact the engine has ever generated. Because a
 * workflow only sees its own lifecycle, the manifest is the union of the
 * previously recorded ids and the ids written by this run — otherwise an
 * init-only artifact would disappear from the manifest the first time sync
 * runs.
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
      artifacts: unionIds(
        await readManifestIds(repo),
        ctx.merged.map((m) => m.artifact.id),
      ),
    });
    if (ctx.analysis !== null) {
      await deps.store.saveAnalysis(ctx.root, ctx.analysis);
    }
  });
}

/** Read the artifact ids recorded in the engine manifest, or [] when absent. */
async function readManifestIds(repo: Storage): Promise<string[]> {
  const raw = await readOrNull(repo, ".dooz/manifest.json");
  if (raw === null) {
    return [];
  }
  let manifest: { artifacts?: unknown };
  try {
    manifest = JSON.parse(raw) as { artifacts?: unknown };
  } catch (error) {
    throw new Error("malformed manifest: .dooz/manifest.json", { cause: error });
  }
  if (!Array.isArray(manifest.artifacts)) {
    throw new Error("malformed manifest: .dooz/manifest.json: artifacts must be an array");
  }
  return manifest.artifacts.filter((id): id is string => typeof id === "string");
}

/** Union preserving first-occurrence order, deterministic across runs. */
function unionIds(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((id) => {
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

/** Dependencies for the save-analysis step. */
export interface SaveAnalysisDeps {
  store: RepositoryStore;
}

/** Save Analysis: persist repository analysis to `.ai/repository-analysis.json`. */
export function saveAnalysisStep(deps: SaveAnalysisDeps): PipelineStep {
  return named("saveAnalysis", async (ctx) => {
    if (ctx.analysis === null) {
      throw new Error("no repository analysis available; run analyze before saving analysis");
    }
    await deps.store.saveAnalysis(ctx.root, ctx.analysis);
  });
}

/** Which read-only report to build. */
export type ReportKind = "status" | "doctor";

/** Dependencies for the report step. */
export interface ReportDeps {
  print: (message: string) => void;
  store: RepositoryStore;
}

/**
 * Report: produce a human-readable report for the read-only commands.
 *
 * status describes what DoozCTL understands about the repository (the
 * analysis); doctor validates the repository's health. Both print via the
 * injected printer and never write.
 */
export function reportStep(deps: ReportDeps, kind: ReportKind): PipelineStep {
  return named("report", async (ctx) => {
    if (kind === "status") {
      deps.print(buildStatusReport(ctx));
      return;
    }
    let manifest = ctx.manifest;
    if (manifest === null) {
      manifest = await readManifestOrNull(deps.store, ctx.root);
    }
    deps.print(buildDoctorReport(ctx, manifest));
  });
}

/** Read the engine manifest, or null when it is missing or malformed. */
async function readManifestOrNull(store: RepositoryStore, root: string): Promise<Manifest | null> {
  try {
    return await store.loadManifest(root);
  } catch {
    return null;
  }
}
