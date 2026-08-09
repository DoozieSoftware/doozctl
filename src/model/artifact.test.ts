import { describe, expect, it } from "vitest";
import {
  artifactEquals,
  createArtifact,
  type Artifact,
  type MergeStrategy,
  type Workflow,
} from "./artifact.js";

/** Build an artifact with a stable default shape. */
function artifact(id: string, overrides: Partial<Omit<Artifact, "id">> = {}): Artifact {
  return createArtifact({
    id,
    source: { path: `templates/${id}.hbs`, format: "handlebars" },
    destination: { path: `${id}.md` },
    mergeStrategy: "managed-blocks",
    lifecycle: ["init", "sync"],
    variables: { language: "typescript" },
    ...overrides,
  });
}

describe("Artifact", () => {
  it("describes every spec field without rendered content", () => {
    const a = createArtifact({
      id: "agents",
      source: { path: "templates/AGENTS.md.hbs", format: "handlebars" },
      destination: { path: "AGENTS.md" },
      mergeStrategy: "managed-blocks",
      lifecycle: ["init", "sync"],
      variables: { language: "typescript" },
      schema: "schemas/agents.json",
      metadata: { description: "agent instructions" },
    });
    expect(a.id).toBe("agents");
    expect(a.source.path).toBe("templates/AGENTS.md.hbs");
    expect(a.source.format).toBe("handlebars");
    expect(a.destination.path).toBe("AGENTS.md");
    expect(a.mergeStrategy).toBe("managed-blocks");
    expect(a.lifecycle).toEqual(["init", "sync"]);
    expect(a.variables).toEqual({ language: "typescript" });
    expect(a.schema).toBe("schemas/agents.json");
    expect(a.metadata).toEqual({ description: "agent instructions" });
    expect("content" in a).toBe(false);
  });

  it("defaults optional fields when omitted", () => {
    const a = createArtifact({
      id: "minimal",
      source: { path: "t.hbs" },
      destination: { path: "out.md" },
      mergeStrategy: "append",
      lifecycle: ["summarize"],
    });
    expect(a.variables).toEqual({});
    expect(a.metadata).toEqual({});
    expect(a.schema).toBeUndefined();
    expect(a.source.format).toBeUndefined();
  });

  it("is deeply frozen", () => {
    const a = artifact("agents");
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.source)).toBe(true);
    expect(Object.isFrozen(a.destination)).toBe(true);
    expect(Object.isFrozen(a.lifecycle)).toBe(true);
    expect(Object.isFrozen(a.variables)).toBe(true);
    expect(Object.isFrozen(a.metadata)).toBe(true);
    expect(() => {
      (a as { id: string }).id = "mutated";
    }).toThrow();
  });

  it("serializes to plain JSON without losing data", () => {
    const a = artifact("agents", {
      schema: "schemas/agents.json",
      metadata: { description: "agent instructions" },
    });
    const revived = JSON.parse(JSON.stringify(a)) as Artifact;
    expect(revived).toEqual(a);
    expect(Object.isFrozen(revived)).toBe(false);
  });
});

describe("MergeStrategy", () => {
  it("supports all four merge strategies as concepts", () => {
    const strategies: MergeStrategy[] = [
      "managed-blocks",
      "replace-generated",
      "overwrite",
      "append",
    ];
    expect(strategies).toHaveLength(4);
  });
});

describe("Workflow", () => {
  it("supports the three workflows as concepts", () => {
    const workflows: Workflow[] = ["init", "sync", "summarize"];
    expect(workflows).toHaveLength(3);
  });
});

describe("artifactEquals", () => {
  it("is true for structurally identical artifacts", () => {
    expect(artifactEquals(artifact("a"), artifact("a"))).toBe(true);
  });

  it("is false when ids differ", () => {
    expect(artifactEquals(artifact("a"), artifact("b"))).toBe(false);
  });

  it("is false when variables differ", () => {
    const a = artifact("a");
    const b = artifact("a", { variables: { language: "go" } });
    expect(artifactEquals(a, b)).toBe(false);
  });

  it("is false when metadata differs", () => {
    const a = artifact("a");
    const b = artifact("a", { metadata: { description: "other" } });
    expect(artifactEquals(a, b)).toBe(false);
  });

  it("is false when schema differs", () => {
    const a = artifact("a");
    const b = artifact("a", { schema: "schemas/agents.json" });
    expect(artifactEquals(a, b)).toBe(false);
  });

  it("is false when lifecycle differs", () => {
    const a = artifact("a");
    const b = artifact("a", { lifecycle: ["summarize"] });
    expect(artifactEquals(a, b)).toBe(false);
  });
});
