#!/usr/bin/env node

/**
 * doozctl entry point (composition root).
 *
 * Explicit composition: constructs concrete infrastructure, injects it into the
 * step factories, and wires command handlers to the dispatcher. No DI
 * framework or container.
 */
import { CommanderError } from "commander";
import { App, type AppDeps } from "./app/app.js";
import { buildProgram, ExitCodeError } from "./cli/cli.js";
import { Dispatcher, ExitCode } from "./dispatcher/dispatcher.js";
import { Engine } from "./engine/engine.js";
import {
  builtinMergers,
  DefaultAnalyzer,
  DefaultRenderer,
  DefaultStandardsLoader,
  DefaultValidator,
} from "./engine/contracts.js";
import { FileSystem } from "./infra/fs/fs.js";
import { GitService } from "./infra/git/git.js";
import { RepositoryStore } from "./store/repository-store.js";

function buildDeps(): AppDeps {
  return {
    git: new GitService(),
    fs: new FileSystem(process.cwd()),
    store: new RepositoryStore(),
    analyzer: new DefaultAnalyzer(),
    loader: new DefaultStandardsLoader(),
    renderer: new DefaultRenderer(),
    validator: new DefaultValidator(),
    mergers: builtinMergers(),
  };
}

function registerCommands(dispatcher: Dispatcher, app: App): void {
  dispatcher
    .register("init", app.init.bind(app))
    .register("analyze", app.analyze.bind(app))
    .register("sync", app.sync.bind(app))
    .register("doctor", app.doctor.bind(app))
    .register("summarize", app.summarize.bind(app))
    .register("status", app.status.bind(app));
}

async function main(): Promise<number> {
  const dispatcher = new Dispatcher();
  registerCommands(dispatcher, new App(new Engine(), buildDeps()));

  const program = buildProgram(dispatcher);
  try {
    await program.parseAsync(process.argv);
    return ExitCode.OK;
  } catch (err) {
    if (err instanceof ExitCodeError) {
      return err.exitCode;
    }
    if (err instanceof CommanderError) {
      // help/version display and unknown-command errors carry their own code.
      return err.exitCode ?? ExitCode.Error;
    }
    throw err;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`doozctl: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = ExitCode.Error;
  });
