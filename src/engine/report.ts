import type { Analysis, Manifest } from "../model/model.js";
import type { ExecutionContext } from "./engine.js";

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
  if (analysis.aiFiles.length > 0) {
    lines.push(`AI files: ${analysis.aiFiles.join(", ")}`);
  }
  return lines.join("\n");
}

/** Health check: verify initialization, package, artifacts and manifest coverage. */
export function buildDoctorReport(ctx: ExecutionContext, manifest: Manifest | null): string {
  const lines: string[] = [formatTitle("Checking repository", ctx.root), ""];
  const problems: string[] = [];

  lines.push(check(true, "Initialized — .dooz/manifest.json"));
  lines.push(check(true, "Repository memory — .ai/repository-analysis.json"));

  if (ctx.standards !== null) {
    lines.push(check(true, `Standards package — ${ctx.standards.name} ${ctx.standards.version}`));
  }

  // Only artifacts that init or sync persist are expected to be in the manifest.
  // summarize-only artifacts are recorded later, by summarize, so a healthy
  // repository that has only been initialized or synced must not be flagged for
  // them. Comparing against every declared artifact would produce a false
  // "problems found" report on the canonical all-strategies package.
  const expected = ctx.artifacts
    .filter(
      (artifact) => artifact.lifecycle.includes("init") || artifact.lifecycle.includes("sync"),
    )
    .map((artifact) => artifact.id);
  lines.push(check(true, `Artifacts — ${ctx.artifacts.length} declared`));

  const recorded = new Set(manifest?.artifacts ?? []);
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
  return lines.join("\n");
}

function formatTitle(label: string, subject: string): string {
  return `${label}: ${subject}`;
}
