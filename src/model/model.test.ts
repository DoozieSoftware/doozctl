import { describe, expect, it } from "vitest";
import type { Artifact, Manifest, MergeStrategy, Session, StandardsPackage } from "./model.js";

describe("model", () => {
  it("models an artifact with every spec field", () => {
    const artifact: Artifact = {
      id: "agents",
      source: "templates/AGENTS.md.hbs",
      destination: "AGENTS.md",
      variables: { language: "typescript" },
      mergeStrategy: "managed-blocks",
    };
    expect(artifact.id).toBe("agents");
    expect(artifact.source).toContain("AGENTS.md");
    expect(artifact.destination).toBe("AGENTS.md");
    expect(artifact.variables).toEqual({ language: "typescript" });
    expect(artifact.mergeStrategy).toBe("managed-blocks");
    expect(artifact.schema).toBeUndefined();
  });

  it("supports all four merge strategies", () => {
    const strategies: MergeStrategy[] = [
      "managed-blocks",
      "replace-generated",
      "overwrite",
      "append",
    ];
    expect(strategies).toHaveLength(4);
  });

  it("models a standards package manifest", () => {
    const pkg: StandardsPackage = {
      version: "1.0.0",
      variables: { org: "doozie" },
      artifacts: [],
      schemas: { agents: "{}" },
    };
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.artifacts).toEqual([]);
  });

  it("models a manifest tracking artifact ids", () => {
    const manifest: Manifest = { version: 1, artifacts: ["agents"] };
    expect(manifest.artifacts).toContain("agents");
  });

  it("models a session summary", () => {
    const session: Session = { id: "s1", createdAt: new Date(0), summary: "done" };
    expect(session.id).toBe("s1");
  });
});
