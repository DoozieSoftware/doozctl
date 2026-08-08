import type { Analysis, Variables } from "../model/model.js";

/**
 * Variable Resolver: converts repository analysis into named render variables.
 *
 * Analysis facts become the `analysis` namespace available to templates, so
 * artifacts can reference them (for example `{{analysis.language}}` or
 * `{{analysis.tests}}`). Pure and deterministic: the same analysis always
 * yields identical variables.
 */
export function resolveVariables(analysis: Analysis): Variables {
  return {
    analysis: {
      language: analysis.languages,
      framework: analysis.frameworks,
      tests: analysis.testFramework,
      root: analysis.root,
      git: analysis.git,
      buildSystem: analysis.buildSystem,
      packageManager: analysis.packageManager,
      ci: analysis.ci,
      docker: analysis.docker,
      statistics: analysis.statistics,
      aiFiles: analysis.aiFiles,
    },
  };
}
