# hello-world

The smallest possible DoozCTL setup: one artifact, one Standards Package.

```sh
doozctl init <some-repo> ./hello-world/standards
```

The package declares a single `AGENTS.md` artifact. Point it at any empty or
existing repository and DoozCTL analyzes the repository, renders the artifact,
and writes the engine state (`.dooz/manifest.json`) and repository memory
(`.ai/repository-analysis.json`).

Re-run the installation any time with `sync`:

```sh
doozctl sync <some-repo> ./hello-world/standards
```

## Files

```
standards/
    package.json          # format 2 manifest declaring the artifact
    artifacts/AGENTS.md   # the template, with one managed block
```
