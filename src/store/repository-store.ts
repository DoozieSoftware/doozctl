import { NotImplementedError } from "../errors.js";
import type { Analysis, Manifest, Session } from "../model/model.js";

/**
 * Repository Store: owns the engine's generated state under `.ai/`:
 *
 *   manifest.json
 *   repository-analysis.json
 *   current-context.md
 *   sessions/
 *
 * These files belong to the engine and are regenerated as required.
 * Scaffolding until a later phase implements persistence.
 */
export class RepositoryStore {
  /** Load the manifest. */
  loadManifest(_dir: string): Promise<Manifest> {
    return Promise.reject(new NotImplementedError("store.manifest"));
  }

  /** Save the manifest. */
  saveManifest(_dir: string, _manifest: Manifest): Promise<void> {
    return Promise.reject(new NotImplementedError("store.manifest"));
  }

  /** Load the repository analysis. */
  loadAnalysis(_dir: string): Promise<Analysis> {
    return Promise.reject(new NotImplementedError("store.analysis"));
  }

  /** Save the repository analysis. */
  saveAnalysis(_dir: string, _analysis: Analysis): Promise<void> {
    return Promise.reject(new NotImplementedError("store.analysis"));
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
