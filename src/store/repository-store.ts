import type { Analysis, Manifest } from "../model/model.js";
import { parseJson, serializeJson } from "./json.js";
import { Storage } from "./storage.js";

/**
 * Repository Store: owns the engine's generated state under `.dooz/` and `.ai/`:
 *
 *   .dooz/manifest.json
 *   .ai/repository-analysis.json
 *
 * `.ai/current-context.md` and `.ai/sessions/` are artifacts declared by the
 * Standards Package (the summarize lifecycle), not engine-internal state.
 * Writes are atomic and deterministic (canonical JSON).
 */
export class RepositoryStore {
  /** Load the manifest. */
  async loadManifest(dir: string): Promise<Manifest> {
    const raw = await new Storage(dir).read(".dooz", "manifest.json");
    return parseJson<Manifest>(raw);
  }

  /**
   * Save the manifest. A byte-identical manifest is left untouched so
   * idempotent runs (repeated init, sync) cause no unnecessary writes or
   * timestamp changes.
   */
  async saveManifest(dir: string, manifest: Manifest): Promise<void> {
    const storage = new Storage(dir);
    const serialized = serializeJson(manifest);
    if (await this.readMatches(storage, serialized, ".dooz", "manifest.json")) {
      return;
    }
    await storage.atomicWrite(serialized, ".dooz", "manifest.json");
  }

  /** Load the repository analysis. */
  async loadAnalysis(dir: string): Promise<Analysis> {
    const raw = await new Storage(dir).read(".ai", "repository-analysis.json");
    return parseJson<Analysis>(raw);
  }

  /**
   * Save the repository analysis. A byte-identical analysis is left untouched
   * so idempotent runs cause no unnecessary writes or timestamp changes.
   */
  async saveAnalysis(dir: string, analysis: Analysis): Promise<void> {
    const storage = new Storage(dir);
    const serialized = serializeJson(analysis);
    if (await this.readMatches(storage, serialized, ".ai", "repository-analysis.json")) {
      return;
    }
    await storage.atomicWrite(serialized, ".ai", "repository-analysis.json");
  }

  /** Whether the file at the given parts already holds exactly `expected`. */
  private async readMatches(
    storage: Storage,
    expected: string,
    ...parts: string[]
  ): Promise<boolean> {
    try {
      return (await storage.read(...parts)) === expected;
    } catch {
      return false;
    }
  }
}
