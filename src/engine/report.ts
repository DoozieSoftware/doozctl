import type { Analysis, Manifest } from "../model/model.js";
import type { ExecutionContext } from "./engine.js";
import { validateManagedBlocks } from "./merge.js";
import { Storage } from "../store/storage.js";

/**
 * Report builders for the read-only commands.
 *
 * status reports what DoozCTL understands about the repository (the analysis).
 * doctor validates the repository's health and reports problems. Both produce
 * plain text only — no formatting state, no opinions.
 */

const check = (ok: boolean, label: string): string => `${ok ? "✓" : "✗"} ${label}`;

function describeGit(analysis: Analysis | null): string {
  const git = analysis?.git;
  if (git === undefined || !git.isRepository) {
    return "Git: not a repository";
  }
  const state = git.dirty ? "uncommitted changes" : "clean";
  const branch = git.branch === null ? "detached HEAD" : git.branch;
  return `Git: ${branch} (${state})`;
}

/** Human-readable summary of what DoozCTL understands about a repository. */
export function buildStatusReport(ctx: ExecutionContext): string {
  const analysis = ctx.analysis;
  const lines: string[] = [formatTitle("Repository", ctx.root)];

  if (analysis === null) {
    lines.push("No repository analysis available. Run doozctl analyze or doozctl init first.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push(describeGit(analysis));
  if (analysis.languages.length > 0) {
    lines.push(`Languages: ${analysis.languages.join(", ")}`);
  }
  if (analysis.frameworks.length > 0) {
    lines.push(`Frameworks: ${analysis.frameworks.join(", ")}`);
  }
  if (analysis.buildSystem !== null) {
    lines.push(`Build system: ${analysis.buildSystem}`);
  }
  if (analysis.packageManager !== null) {
    lines.push(`Package manager: ${analysis.packageManager}`);
  }
  if (analysis.testFramework !== null) {
    lines.push(`Test framework: ${analysis.testFramework}`);
  }
  if (analysis.ci.length > 0) {
    lines.push(`CI: ${analysis.ci.join(", ")}`);
  }
  if (analysis.docker) {
    lines.push("Docker: present");
  }
  lines.push(
    `Files: ${analysis.statistics.totalFiles} total · ${analysis.statistics.sourceFiles} source · ${analysis.statistics.testFiles} test`,
  );
  return lines.join("\n");
}

/**
 * Health check: verify initialization, package validity, artifact coverage,
 * artifact existence and managed-block integrity. Returns the human-readable
 * report plus the list of problems (empty when healthy).
 */
export async function buildDoctorReport(
  ctx: ExecutionContext,
  manifest: Manifest | null,
): Promise<{ report: string; problems: string[] }> {
  const repo = new Storage(ctx.root);
  const problems: string[] = [];
  const lines: string[] = [formatTitle("Checking repository", ctx.root), ""];

  lines.push(check(true, "Initialized — .dooz/manifest.json"));
  lines.push(check(true, "Repository memory — .ai/repository-analysis.json"));

  if (ctx.standards !== null) {
    lines.push(check(true, `Standards package — ${ctx.standards.name} ${ctx.standards.version}`));
  }

  // Only artifacts that init or sync persist are expected in the manifest;
  // summarize-only artifacts are recorded later, by summarize.
  const persistable = ctx.artifacts.filter(
    (artifact) => artifact.lifecycle.includes("init") || artifact.lifecycle.includes("sync"),
  );
  const expected = persistable.map((artifact) => artifact.id);
  lines.push(check(true, `Artifacts — ${ctx.artifacts.length} declared`));

  const recorded = new Set(
    (manifest?.artifacts ?? []).map((entry) => (typeof entry === "string" ? entry : entry.id)),
  );
  const missing = expected.filter((id) => !recorded.has(id));
  if (missing.length === 0) {
    lines.push(check(true, `Generated artifacts recorded — ${recorded.size} in manifest`));
  } else {
    problems.push(
      `Artifacts not recorded in the manifest: ${missing.join(", ")}. Re-run doozctl init or doozctl sync to repair.`,
    );
    lines.push(
      check(
        false,
        `Generated artifacts recorded — ${recorded.size} of ${expected.length} in manifest`,
      ),
    );
  }

  for (const artifact of persistable) {
    let content: string;
    try {
      content = await repo.read(artifact.destination.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        problems.push(
          `Generated artifact missing: ${artifact.destination.path} (artifact "${artifact.id}"). Re-run doozctl init or doozctl sync.`,
        );
        lines.push(check(false, `Artifact ${artifact.id} — ${artifact.destination.path} exists`));
        continue;
      }
      throw error;
    }
    lines.push(check(true, `Artifact ${artifact.id} — ${artifact.destination.path} exists`));
    if (artifact.mergeStrategy === "managed-blocks") {
      try {
        validateManagedBlocks(content);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        problems.push(
          `Managed-block markers malformed in ${artifact.destination.path}: ${detail}. DoozCTL never repairs malformed files; fix the markers by hand, then run doozctl sync.`,
        );
        lines.push(check(false, `Managed blocks in ${artifact.destination.path} are well-formed`));
      }
    }
  }

  lines.push(describeGit(ctx.analysis));
  if (ctx.analysis?.git.isRepository === true && ctx.analysis.git.dirty) {
    problems.push("Working tree has uncommitted changes. Commit before summarizing.");
  }

  lines.push("");
  if (problems.length === 0) {
    lines.push("Repository is healthy.");
  } else {
    lines.push("Problems found:");
    for (const problem of problems) {
      lines.push(`  ✗ ${problem}`);
    }
  }
  return { report: lines.join("\n"), problems };
}

function formatTitle(label: string, subject: string): string {
  return `${label}: ${subject}`;
}
