import { NotImplementedError } from "../errors.js";
import type { Analysis, Manifest, Session } from "../model/model.js";
import { parseJson, serializeJson } from "./json.js";
import { Storage } from "./storage.js";

/**
 * Repository Store: owns the engine's generated state under `.dooz/` and `.ai/`:
 *
 *   .dooz/manifest.json
 *   .ai/repository-analysis.json
 *   .ai/current-context.md
 *   .ai/sessions/
 *
 * These files belong to the engine and are regenerated as required. Writes are
 * atomic and deterministic (canonical JSON). Context and session operations are
 * scaffolding until a later phase implements them.
 */
export class RepositoryStore {
  /** Load the manifest. */
  async loadManifest(dir: string): Promise<Manifest> {
    const raw = await new Storage(dir).read(".dooz", "manifest.json");
    return parseJson<Manifest>(raw);
  }

  /** Save the manifest. */
  async saveManifest(dir: string, manifest: Manifest): Promise<void> {
    await new Storage(dir).atomicWrite(serializeJson(manifest), ".dooz", "manifest.json");
  }

  /** Load the repository analysis. */
  async loadAnalysis(dir: string): Promise<Analysis> {
    const raw = await new Storage(dir).read(".ai", "repository-analysis.json");
    return parseJson<Analysis>(raw);
  }

  /** Save the repository analysis. */
  async saveAnalysis(dir: string, analysis: Analysis): Promise<void> {
    await new Storage(dir).atomicWrite(serializeJson(analysis), ".ai", "repository-analysis.json");
  }

  /** Read the current context. */
  readContext(_dir: string): Promise<string> {
    return Promise.reject(new NotImplementedError("store.context"));
  }

  /** Replace the current context. */
  updateContext(_dir: string, _content: string): Promise<void> {
    return Promise.reject(new NotImplementedError("store.context"));
  }

  /** Create an immutable session summary. */
  createSession(_dir: string, _summary: string): Promise<Session> {
    return Promise.reject(new NotImplementedError("store.session"));
  }

  /** List sessions, newest first. */
  listSessions(_dir: string): Promise<Session[]> {
    return Promise.reject(new NotImplementedError("store.session"));
  }
}
