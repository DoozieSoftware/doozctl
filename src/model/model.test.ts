import { describe, expect, it } from "vitest";
import type { Manifest, Session, StandardsPackage } from "./model.js";

describe("model", () => {
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
