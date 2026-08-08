import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createArtifact, type Artifact } from "../model/artifact.js";
import { Storage } from "../store/storage.js";
import { ArtifactRenderer, renderTemplate } from "./artifact-renderer.js";

describe("renderTemplate", () => {
  it("substitutes a single variable", () => {
    expect(renderTemplate("Hello {{name}}.", { name: "world" })).toBe("Hello world.");
  });

  it("substitutes nested dotted paths", () => {
    const variables = { analysis: { language: "php" }, build: { packageManager: "composer" } };
    expect(renderTemplate("{{analysis.language}} with {{build.packageManager}}", variables)).toBe(
      "php with composer",
    );
  });

  it("renders missing variables as empty strings", () => {
    expect(renderTemplate("a{{missing}}b{{also.missing}}c", {})).toBe("abc");
  });

  it("renders missing intermediate paths as empty strings", () => {
    expect(renderTemplate("[{{repository.git.branch}}]", { repository: {} })).toBe("[]");
  });

  it("renders numbers and booleans", () => {
    expect(
      renderTemplate("counts: {{stats.sourceFiles}}, docker: {{build.docker}}", {
        stats: { sourceFiles: 10 },
        build: { docker: false },
      }),
    ).toBe("counts: 10, docker: false");
  });

  it("renders arrays comma-joined", () => {
    expect(
      renderTemplate("{{framework.frameworks}}", { framework: { frameworks: ["React", "Vue"] } }),
    ).toBe("React,Vue");
  });

  it("preserves UTF-8 content", () => {
    expect(renderTemplate("{{greeting}} 🎉 日本語", { greeting: "Olá" })).toBe("Olá 🎉 日本語");
  });

  it("normalizes CRLF and CR line endings to LF", () => {
    expect(renderTemplate("a\r\nb\rc", {})).toBe("a\nb\nc");
  });

  it("does not HTML-escape substituted values", () => {
    expect(renderTemplate("{{html}}", { html: "<b>&</b>" })).toBe("<b>&</b>");
  });

  it("renders unsupported tags as empty strings", () => {
    expect(renderTemplate("x{{#section}}{{/section}}y", {})).toBe("xy");
  });

  it("is deterministic for identical input", () => {
    const template = "{{a.b}} and {{a.c}}";
    const variables = { a: { b: "1", c: "2" } };
    expect(renderTemplate(template, variables)).toBe(renderTemplate(template, variables));
  });
});

describe("ArtifactRenderer", () => {
  const dirs: string[] = [];

  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tmp(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "doozctl-render-"));
    dirs.push(dir);
    return dir;
  }

  function artifact(source: string): Artifact {
    return createArtifact({
      id: "agents",
      source: { path: source },
      destination: { path: "AGENTS.md" },
      mergeStrategy: "managed-blocks",
    });
  }

  it("renders the artifact source from the package and returns the original artifact", async () => {
    const dir = await tmp();
    const templates = new Storage(dir);
    await templates.write("Languages: {{analysis.language}}", "artifacts", "AGENTS.md");

    const renderer = new ArtifactRenderer(templates);
    const input = artifact("artifacts/AGENTS.md");
    const rendered = await renderer.render(input, { analysis: { language: "TypeScript" } });

    expect(rendered.artifact).toBe(input);
    expect(rendered.content).toBe("Languages: TypeScript");
  });

  it("never writes files", async () => {
    const dir = await tmp();
    const templates = new Storage(dir);
    await templates.write("{{x}}", "templates", "a.md");

    const renderer = new ArtifactRenderer(templates);
    await renderer.render(artifact("templates/a.md"), { x: "v" });

    await expect(templates.exists("AGENTS.md")).resolves.toBe(false);
  });

  it("rejects when the source template does not exist", async () => {
    const dir = await tmp();
    const renderer = new ArtifactRenderer(new Storage(dir));
    await expect(renderer.render(artifact("missing/x.md"), {})).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
