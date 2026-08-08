import { promises as fs } from "node:fs";
import path from "node:path";
import { createArtifact, MERGE_STRATEGIES } from "../model/artifact.js";
import type { Artifact, MergeStrategy, StandardsPackage } from "../model/model.js";
import type { StandardsLoader } from "./contracts.js";

/**
 * Standards Package Loader: loads a package exactly as specified in SPEC.md.
 *
 * Reads the manifest, validates only what the contract requires (package
 * exists, JSON valid, artifact source exists, merge strategy valid, supported
 * format), and returns the declared artifacts. It knows nothing about artifact
 * names, AGENTS.md, rendering, or variables. Artifact source paths are kept
 * inside the package directory so a package can never reference files outside
 * itself.
 */

const MANIFEST_FILE = "package.json";
const SUPPORTED_FORMAT = 1;

/** The raw manifest as parsed from package.json. */
interface ManifestJson {
  format?: unknown;
  name?: unknown;
  version?: unknown;
  engine?: unknown;
  artifacts?: unknown;
}

/** Loads a Standards Package from a plain directory. */
export class StandardsPackageLoader implements StandardsLoader {
  async load(dir: string): Promise<StandardsPackage> {
    const manifestPath = path.join(dir, MANIFEST_FILE);
    const manifest = await this.readManifest(manifestPath);
    const format = this.assertFormat(manifest.format, dir);
    return {
      format,
      name: this.string(manifest.name, "name"),
      version: this.string(manifest.version, "version"),
      engine: this.string(manifest.engine, "engine"),
      artifacts: await this.loadArtifacts(dir, manifest.artifacts),
    };
  }

  private async readManifest(manifestPath: string): Promise<ManifestJson> {
    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, "utf-8");
    } catch {
      throw new Error(`standards package not found: ${manifestPath}`);
    }
    try {
      return JSON.parse(raw) as ManifestJson;
    } catch (error) {
      throw new Error(`invalid standards package: ${manifestPath}: invalid JSON`, {
        cause: error,
      });
    }
  }

  private assertFormat(format: unknown, dir: string): number {
    if (format !== SUPPORTED_FORMAT) {
      throw new Error(`invalid standards package: ${dir}: unsupported format: ${String(format)}`);
    }
    return SUPPORTED_FORMAT;
  }

  private async loadArtifacts(dir: string, rawArtifacts: unknown): Promise<Artifact[]> {
    if (!Array.isArray(rawArtifacts)) {
      throw new Error(`invalid standards package: ${dir}: artifacts must be an array`);
    }
    const artifacts: Artifact[] = [];
    for (const entry of rawArtifacts) {
      artifacts.push(await this.loadArtifact(dir, entry));
    }
    return artifacts;
  }

  private async loadArtifact(dir: string, raw: unknown): Promise<Artifact> {
    const json = this.record(raw);
    if (json === null) {
      throw new Error(`invalid standards package: ${dir}: artifact must be an object`);
    }
    const id = this.string(json.id, "id");
    const source = this.string(json.source, "source");
    const destination = this.string(json.destination, "destination");
    const merge = this.string(json.merge, "merge");
    this.assertMergeStrategy(merge);
    await this.assertSourceExists(dir, source);
    return createArtifact({
      id,
      source: { path: source },
      destination: { path: destination },
      mergeStrategy: merge as MergeStrategy,
    });
  }

  private assertMergeStrategy(merge: string): void {
    if (!(MERGE_STRATEGIES as readonly string[]).includes(merge)) {
      throw new Error(`invalid standards package: unsupported merge strategy: ${merge}`);
    }
  }

  private async assertSourceExists(dir: string, source: string): Promise<void> {
    const sourcePath = this.withinPackage(dir, source);
    try {
      await fs.access(sourcePath);
    } catch {
      throw new Error(`invalid standards package: artifact source not found: ${source}`);
    }
  }

  /** Resolve a manifest-relative path, rejecting any that escapes the package. */
  private withinPackage(dir: string, rel: string): string {
    const joined = path.join(dir, rel);
    const resolved = path.resolve(joined);
    const base = path.resolve(dir);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
      throw new Error(`invalid standards package: artifact source escapes package: ${rel}`);
    }
    return resolved;
  }

  private string(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`invalid standards package: missing ${field}`);
    }
    return value;
  }

  private record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
