import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createArtifact } from "../model/artifact.js";
import type { Analysis } from "../model/model.js";
import { RepositoryStore } from "../store/repository-store.js";
import { builtinMergers } from "./contracts.js";
import type { Validator } from "./contracts.js";
import { Engine } from "./engine.js";
import type { ExecutionContext, PipelineStep } from "./engine.js";
import { StandardsPackageLoader } from "./standards-loader.js";
import {
  analyzeStep,
  lifecycleStep,
  loadStep,
  mergeStep,
  renderStep,
  reportStep,
  resolveDestinationStep,
  resolveVariablesStep,
  saveAnalysisStep,
  sessionStep,
  validateStep,
  writeStep,
} from "./steps.js";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "doozctl-steps-"));
  dirs.push(dir);
  return dir;
}

/** Write a Standards Package manifest plus optional package files. */
async function writePackage(
  dir: string,
  manifest: unknown,
  files: Record<string, string>,
): Promise<void> {
  await writeFile(path.join(dir, "package.json"), JSON.stringify(manifest), "utf-8");
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, content, "utf-8");
  }
}

const validManifest = {
  format: 2,
  name: "@dooziesoft/standards",
  version: "1.0.0",
  engine: ">=1.0.0",
  artifacts: [
    {
      id: "agents",
      source: "artifacts/AGENTS.md",
      destination: "AGENTS.md",
      merge: "managed-blocks",
      lifecycle: ["init", "sync"],
    },
  ],
};

function minimalAnalysis(root: string): Analysis {
  return {
    root,
    git: { isRepository: false, branch: null, dirty: false },
    languages: [],
    frameworks: [],
    buildSystem: null,
    packageManager: null,
    testFramework: null,
    ci: [],
    docker: false,
    statistics: { totalFiles: 0, sourceFiles: 0, testFiles: 0 },
    aiFiles: [],
  };
}

/** Run steps, then return the resulting execution context. */
async function runSteps(
  steps: PipelineStep[],
  opts: { root?: string; standardsDir?: string } = {},
): Promise<ExecutionContext> {
  let ctx!: ExecutionContext;
  await new Engine().run({ root: opts.root ?? ".", standardsDir: opts.standardsDir ?? "" }, [
    ...steps,
    async (c) => {
      ctx = c;
    },
  ]);
  return ctx;
}

describe("pipeline steps", () => {
  it("analyze step delegates to the analyzer and fills the analysis", async () => {
    const dir = await tmp();
    const analysis = minimalAnalysis(dir);
    const ctx = await runSteps(
      [analyzeStep({ git: {} as never, analyzer: { analyze: async () => analysis } })],
      { root: dir },
    );
    expect(ctx.analysis).toEqual(analysis);
  });

  it("load step loads the standards package into the context", async () => {
    const pkg = await tmp();
    await writePackage(pkg, validManifest, { "artifacts/AGENTS.md": "x" });
    const ctx = await runSteps([loadStep({ loader: new StandardsPackageLoader() })], {
      standardsDir: pkg,
    });
    expect(ctx.standards?.name).toBe("@dooziesoft/standards");
    expect(ctx.artifacts).toHaveLength(1);
    expect(ctx.artifacts[0]?.id).toBe("agents");
  });

  it("lifecycle step keeps only artifacts in the workflow lifecycle", async () => {
    const initOnly = createArtifact({
      id: "gitignore",
      source: { path: "a.md" },
      destination: { path: "a.md" },
      mergeStrategy: "overwrite",
      lifecycle: ["init"],
    });
    const both = createArtifact({
      id: "agents",
      source: { path: "b.md" },
      destination: { path: "b.md" },
      mergeStrategy: "managed-blocks",
      lifecycle: ["init", "sync"],
    });
    const summarizeOnly = createArtifact({
      id: "session",
      source: { path: "c.md" },
      destination: { path: "c.md" },
      mergeStrategy: "append",
      lifecycle: ["summarize"],
    });
    const ctx = await runSteps([
      async (c) => {
        c.artifacts = [initOnly, both, summarizeOnly];
      },
      lifecycleStep("sync"),
    ]);
    expect(ctx.artifacts.map((a) => a.id)).toEqual(["agents"]);
  });

  it("lifecycle step keeps every artifact when all participate in the workflow", async () => {
    const ctx = await runSteps([
      async (c) => {
        c.artifacts = [
          createArtifact({
            id: "a",
            source: { path: "a.md" },
            destination: { path: "a.md" },
            mergeStrategy: "overwrite",
            lifecycle: ["init", "sync"],
          }),
        ];
      },
      lifecycleStep("init"),
    ]);
    expect(ctx.artifacts).toHaveLength(1);
  });

  it("resolveVariables step throws without an analysis", async () => {
    await expect(runSteps([resolveVariablesStep()])).rejects.toThrow(/analysis/);
  });

  it("resolveVariables step derives variables from the analysis", async () => {
    const ctx = await runSteps([
      async (c) => {
        c.analysis = minimalAnalysis("/repo");
      },
      resolveVariablesStep(),
    ]);
    expect(ctx.variables["analysis"]).toEqual({ language: [], framework: [], tests: null });
    expect(ctx.variables["repository"]).toMatchObject({
      git: { isRepository: false, branch: null, dirty: false },
    });
  });

  it("render step renders every artifact from the package templates", async () => {
    const pkg = await tmp();
    await writePackage(pkg, validManifest, {
      "artifacts/AGENTS.md": "Lang: {{analysis.language}}",
    });
    const artifact = createArtifact({
      id: "agents",
      source: { path: "artifacts/AGENTS.md" },
      destination: { path: "AGENTS.md" },
      mergeStrategy: "managed-blocks",
      lifecycle: ["init", "sync"],
    });
    const ctx = await runSteps(
      [
        async (c) => {
          c.artifacts = [artifact];
          c.variables = { analysis: { language: "TypeScript" } };
        },
        renderStep(),
      ],
      { standardsDir: pkg },
    );
    expect(ctx.rendered).toEqual([{ artifact, content: "Lang: TypeScript" }]);
  });

  it("merge step writes rendered content directly when the destination is missing", async () => {
    const repo = await tmp();
    const artifact = createArtifact({
      id: "agents",
      source: { path: "artifacts/AGENTS.md" },
      destination: { path: "AGENTS.md" },
      mergeStrategy: "managed-blocks",
      lifecycle: ["init", "sync"],
    });
    const ctx = await runSteps(
      [
        async (c) => {
          c.rendered = [{ artifact, content: "hello" }];
        },
        mergeStep({ mergers: builtinMergers() }),
      ],
      { root: repo },
    );
    expect(ctx.merged).toEqual([{ artifact, content: "hello" }]);
  });

  it("merge step preserves user content outside managed blocks", async () => {
    const repo = await tmp();
    await writeFile(
      path.join(repo, "AGENTS.md"),
      [
        "user",
        "<!-- DOOZCTL:BEGIN:v1 repo -->",
        "old",
        "<!-- DOOZCTL:END:v1 repo -->",
        "user",
      ].join("\n"),
      "utf-8",
    );
    const artifact = createArtifact({
      id: "agents",
      source: { path: "artifacts/AGENTS.md" },
      destination: { path: "AGENTS.md" },
      mergeStrategy: "managed-blocks",
      lifecycle: ["init", "sync"],
    });
    const rendered = ["<!-- DOOZCTL:BEGIN:v1 repo -->", "new", "<!-- DOOZCTL:END:v1 repo -->"].join(
      "\n",
    );
    const ctx = await runSteps(
      [
        async (c) => {
          c.rendered = [{ artifact, content: rendered }];
        },
        mergeStep({ mergers: builtinMergers() }),
      ],
      { root: repo },
    );
    expect(ctx.merged[0]?.content).toBe(
      [
        "user",
        "<!-- DOOZCTL:BEGIN:v1 repo -->",
        "new",
        "<!-- DOOZCTL:END:v1 repo -->",
        "user",
      ].join("\n"),
    );
  });

  it("validate step skips artifacts without a schema", async () => {
    const calls: Array<[string, string | null]> = [];
    const validator: Validator = {
      validate: async (content, schema) => {
        calls.push([content, schema]);
      },
    };
    const artifact = createArtifact({
      id: "a",
      source: { path: "a.md" },
      destination: { path: "a.md" },
      mergeStrategy: "managed-blocks",
      lifecycle: ["init", "sync"],
    });
    await runSteps([
      async (c) => {
        c.rendered = [{ artifact, content: "x" }];
      },
      validateStep({ validator }),
    ]);
    expect(calls).toEqual([]);
  });

  it("validate step calls the validator when a schema is present", async () => {
    const calls: Array<[string, string | null]> = [];
    const validator: Validator = {
      validate: async (content, schema) => {
        calls.push([content, schema]);
      },
    };
    const artifact = createArtifact({
      id: "a",
      source: { path: "a.md" },
      destination: { path: "a.md" },
      mergeStrategy: "managed-blocks",
      lifecycle: ["init", "sync"],
      schema: "schemas/a.json",
    });
    await runSteps([
      async (c) => {
        c.rendered = [{ artifact, content: "x" }];
      },
      validateStep({ validator }),
    ]);
    expect(calls).toEqual([["x", "schemas/a.json"]]);
  });

  it("write step persists changed artifacts, the manifest and the analysis", async () => {
    const repo = await tmp();
    const artifact = createArtifact({
      id: "agents",
      source: { path: "artifacts/AGENTS.md" },
      destination: { path: "docs/AGENTS.md" },
      mergeStrategy: "managed-blocks",
      lifecycle: ["init", "sync"],
    });
    await runSteps(
      [
        async (c) => {
          c.merged = [{ artifact, content: "rendered" }];
          c.analysis = minimalAnalysis(repo);
        },
        writeStep({ store: new RepositoryStore() }),
      ],
      { root: repo },
    );
    await expect(readFile(path.join(repo, "docs/AGENTS.md"), "utf-8")).resolves.toBe("rendered");
    await expect(readFile(path.join(repo, ".dooz/manifest.json"), "utf-8")).resolves.toContain(
      '"agents"',
    );
    await expect(
      readFile(path.join(repo, ".ai/repository-analysis.json"), "utf-8"),
    ).resolves.toContain('"root"');
  });

  it("write step preserves artifact ids recorded by other workflows in the manifest", async () => {
    const repo = await tmp();
    await mkdir(path.join(repo, ".dooz"), { recursive: true });
    await writeFile(
      path.join(repo, ".dooz", "manifest.json"),
      JSON.stringify({ version: 1, artifacts: ["gitignore"] }),
      "utf-8",
    );
    const artifact = createArtifact({
      id: "agents",
      source: { path: "artifacts/AGENTS.md" },
      destination: { path: "docs/AGENTS.md" },
      mergeStrategy: "managed-blocks",
      lifecycle: ["sync"],
    });
    await runSteps(
      [
        async (c) => {
          c.merged = [{ artifact, content: "rendered" }];
          c.analysis = minimalAnalysis(repo);
        },
        writeStep({ store: new RepositoryStore() }),
      ],
      { root: repo },
    );
    const manifest = JSON.parse(
      await readFile(path.join(repo, ".dooz", "manifest.json"), "utf-8"),
    ) as { artifacts: string[] };
    expect(manifest.artifacts).toEqual(["gitignore", "agents"]);
  });

  it("session step parses content, carries forward context and records git facts", async () => {
    const repo = await tmp();
    await mkdir(path.join(repo, ".ai"), { recursive: true });
    await writeFile(
      path.join(repo, ".ai", "current-context.md"),
      "# Current Objective\nOld goal.\n\n# Open Questions\nWho owns it?\n",
      "utf-8",
    );
    const sessionArtifact = createArtifact({
      id: "session",
      source: { path: "templates/session.md" },
      destination: { path: ".ai/sessions/{{session.id}}.md" },
      mergeStrategy: "append",
      lifecycle: ["summarize"],
    });
    const ctx = await runSteps(
      [
        async (c) => {
          c.artifacts = [sessionArtifact];
          c.analysis = minimalAnalysis(repo);
        },
        sessionStep(
          {
            git: {
              commitHash: async () => "abc123",
            } as never,
          },
          {
            id: "2026-08-09_093000",
            date: "2026-08-09T09:30:00+08:00",
            content: "## Summary\nBuilt the widget.\n",
            tool: "claude",
            model: "opus",
            user: "akshay",
          },
        ),
      ],
      { root: repo },
    );
    expect(ctx.variables.session).toMatchObject({
      id: "2026-08-09_093000",
      date: "2026-08-09T09:30:00+08:00",
      tool: "claude",
      model: "opus",
      user: "akshay",
      commit: "abc123",
      objective: "Old goal.",
      summary: "Built the widget.",
      openQuestions: "Who owns it?",
    });
  });

  it("session step refuses to overwrite an existing immutable session file", async () => {
    const repo = await tmp();
    await mkdir(path.join(repo, ".ai", "sessions"), { recursive: true });
    await writeFile(
      path.join(repo, ".ai", "sessions", "2026-08-09_093000.md"),
      "existing",
      "utf-8",
    );
    const sessionArtifact = createArtifact({
      id: "session",
      source: { path: "templates/session.md" },
      destination: { path: ".ai/sessions/{{session.id}}.md" },
      mergeStrategy: "append",
      lifecycle: ["summarize"],
    });
    await expect(
      runSteps(
        [
          async (c) => {
            c.artifacts = [sessionArtifact];
          },
          sessionStep(
            {
              git: {
                commitHash: async () => null,
              } as never,
            },
            {
              id: "2026-08-09_093000",
              date: "2026-08-09T09:30:00+08:00",
              content: "## Summary\nx\n",
              tool: "",
              model: "",
              user: "",
            },
          ),
        ],
        { root: repo },
      ),
    ).rejects.toThrow(/session file already exists and is immutable/);
  });

  it("resolveDestination step materializes session destinations", async () => {
    const sessionArtifact = createArtifact({
      id: "session",
      source: { path: "templates/session.md" },
      destination: { path: ".ai/sessions/{{session.id}}.md" },
      mergeStrategy: "append",
      lifecycle: ["summarize"],
    });
    const ctx = await runSteps([
      async (c) => {
        c.artifacts = [sessionArtifact];
        c.variables = { session: { id: "2026-08-09_093000" } };
      },
      resolveDestinationStep(),
    ]);
    expect(ctx.artifacts[0]?.destination.path).toBe(".ai/sessions/2026-08-09_093000.md");
  });

  it("resolveDestination step leaves destinations without references unchanged", async () => {
    const artifact = createArtifact({
      id: "agents",
      source: { path: "a.md" },
      destination: { path: "AGENTS.md" },
      mergeStrategy: "managed-blocks",
      lifecycle: ["init", "sync"],
    });
    const ctx = await runSteps([
      async (c) => {
        c.artifacts = [artifact];
        c.variables = {};
      },
      resolveDestinationStep(),
    ]);
    expect(ctx.artifacts[0]).toBe(artifact);
  });

  it("saveAnalysis step persists the analysis", async () => {
    const repo = await tmp();
    await runSteps(
      [
        async (c) => {
          c.analysis = minimalAnalysis(repo);
        },
        saveAnalysisStep({ store: new RepositoryStore() }),
      ],
      { root: repo },
    );
    await expect(
      readFile(path.join(repo, ".ai/repository-analysis.json"), "utf-8"),
    ).resolves.toContain('"root"');
  });

  it("saveAnalysis step throws without an analysis", async () => {
    await expect(runSteps([saveAnalysisStep({ store: new RepositoryStore() })])).rejects.toThrow(
      /analysis/,
    );
  });

  it("status report step prints what DoozCTL understands about the repository", async () => {
    const printed: string[] = [];
    await runSteps(
      [
        async (c) => {
          c.analysis = minimalAnalysis("/repo");
        },
        reportStep({ print: (m) => printed.push(m), store: new RepositoryStore() }, "status"),
      ],
      { root: "/repo" },
    );
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain("Repository: /repo");
    expect(printed[0]).toContain("Git: not a repository");
    expect(printed[0]).toContain("Files: 0 total · 0 source · 0 test");
  });

  it("doctor report step reports a healthy repository", async () => {
    const printed: string[] = [];
    await runSteps([
      async (c) => {
        c.manifest = { version: 1, artifacts: ["agents"] };
        c.standards = {
          format: 2,
          name: "@dooziesoft/standards",
          version: "1.0.0",
          engine: ">=1.0.0",
          artifacts: [],
        };
        c.artifacts = [
          createArtifact({
            id: "agents",
            source: { path: "a.md" },
            destination: { path: "AGENTS.md" },
            mergeStrategy: "managed-blocks",
            lifecycle: ["init", "sync"],
          }),
        ];
      },
      reportStep({ print: (m) => printed.push(m), store: new RepositoryStore() }, "doctor"),
    ]);
    expect(printed[0]).toContain("Repository is healthy.");
    expect(printed[0]).toContain("✓ Initialized — .dooz/manifest.json");
    expect(printed[0]).toContain("✓ Generated artifacts recorded — 1 in manifest");
  });

  it("doctor report step flags artifacts missing from the manifest", async () => {
    const printed: string[] = [];
    await runSteps([
      async (c) => {
        c.manifest = { version: 1, artifacts: [] };
        c.artifacts = [
          createArtifact({
            id: "agents",
            source: { path: "a.md" },
            destination: { path: "AGENTS.md" },
            mergeStrategy: "managed-blocks",
            lifecycle: ["init", "sync"],
          }),
        ];
      },
      reportStep({ print: (m) => printed.push(m), store: new RepositoryStore() }, "doctor"),
    ]);
    expect(printed[0]).toContain("Problems found:");
    expect(printed[0]).toContain("Artifacts not recorded in the manifest: agents");
    expect(printed[0]).not.toContain("Repository is healthy.");
  });
});
