import { NotImplementedError } from "../errors.js";
import type { Plugin } from "../model/model.js";

/** Plugin Manager: extension mechanism for custom analyzers, merge strategies, etc. */
export class PluginManager {
  /** Discover available plugins in dir. Scaffolding. */
  discover(_dir: string): Promise<Plugin[]> {
    return Promise.reject(new NotImplementedError("plugin"));
  }
}
