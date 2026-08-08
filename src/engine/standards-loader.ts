import { createArtifact, MERGE_STRATEGIES } from "../model/artifact.js";
import type { Artifact, MergeStrategy, StandardsPackage } from "../model/model.js";
import { Storage } from "../store/storage.js";
import type { StandardsLoader } from "./contracts.js";

/**
 * Standards Package Loader: loads a package exactly as specified in SPEC.md.
 *
 * Reads the manifest, validates only what the contract requires (package
 * exists, JSON valid, artifact source exists, merge strategy valid, supported
 * format), and returns the declared artifacts. It knows nothing about artifact
 * names, AGENTS.md, rendering, or variables. All filesystem access goes
 * through Storage, which keeps a package from probing paths outside itself.
 * Destination paths are intentionally not validated here — the contract
 * validates sources only; destinations are guarded by Storage when written.
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
    const store = new Storage(dir);
    const manifest = await this.readManifest(store);
    const format = this.assertFormat(manifest.format, store.root);
    return {
      format,
      name: this.string(manifest.name, "name"),
      version: this.string(manifest.version, "version"),
      engine: this.string(manifest.engine, "engine"),
      artifacts: await this.loadArtifacts(store, manifest.artifacts),
    };
  }

  /** Read and parse the manifest, wrapping only the JSON parse failure. */
  private async readManifest(store: Storage): Promise<ManifestJson> {
    let raw: string;
    try {
      raw = await store.read(MANIFEST_FILE);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`standards package not found: ${store.resolve(MANIFEST_FILE)}`);
      }
      throw error;
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(raw);
    } catch (error) {
      throw new Error(`invalid standards package: ${store.resolve(MANIFEST_FILE)}: invalid JSON`, {
        cause: error,
      });
    }
    const parsed = this.record(manifest);
    if (parsed === null) {
      throw new Error("invalid standards package: manifest must be an object");
    }
    return parsed as ManifestJson;
  }

  private assertFormat(format: unknown, dir: string): number {
    if (format !== SUPPORTED_FORMAT) {
      throw new Error(`invalid standards package: ${dir}: unsupported format: ${String(format)}`);
    }
    return SUPPORTED_FORMAT;
  }

  private async loadArtifacts(store: Storage, rawArtifacts: unknown): Promise<Artifact[]> {
    if (!Array.isArray(rawArtifacts)) {
      throw new Error(`invalid standards package: ${store.root}: artifacts must be an array`);
    }
    const artifacts: Artifact[] = [];
    for (const entry of rawArtifacts) {
      artifacts.push(await this.loadArtifact(store, entry));
    }
    return artifacts;
  }

  private async loadArtifact(store: Storage, raw: unknown): Promise<Artifact> {
    const json = this.record(raw);
    if (json === null) {
      throw new Error(`invalid standards package: ${store.root}: artifact must be an object`);
    }
    const id = this.string(json.id, "id");
    const source = this.string(json.source, "source");
    const destination = this.string(json.destination, "destination");
    const merge = this.string(json.merge, "merge");
    this.assertMergeStrategy(merge);
    await this.assertSourceExists(store, source);
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

  private async assertSourceExists(store: Storage, source: string): Promise<void> {
    store.resolve(source); // enforces containment; rejects paths escaping the package
    if (!(await store.exists(source))) {
      throw new Error(`invalid standards package: artifact source not found: ${source}`);
    }
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
