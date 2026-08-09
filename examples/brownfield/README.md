# brownfield

A realistic existing repository: code, a README, and an outdated `AGENTS.md`
that already contains user notes and a stale managed block. DoozCTL merges into
it without destroying anything.

```sh
doozctl init ./repo ./standards
```

What happens:

- The repository is analyzed (here it detects a TypeScript project).
- `AGENTS.md` already exists, so DoozCTL does **not** replace it wholesale.
  It rewrites only the content inside the `DOOZCTL:BEGIN/END` block and leaves
  the surrounding user notes byte-for-byte intact.
- `.dooz/manifest.json` and `.ai/repository-analysis.json` are written.

Try it, then edit the notes in `repo/AGENTS.md` and run:

```sh
doozctl sync ./repo ./standards
```

Your edits survive. Only the managed block updates.

## Files

```
repo/
    AGENTS.md   # user notes + one stale managed block (the merge target)
    README.md   # user content, untouched
    src/main.ts # a TypeScript source file
standards/
    package.json
    artifacts/AGENTS.md
```
