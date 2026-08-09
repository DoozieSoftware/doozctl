# FAQ

## What is DoozCTL?

A lightweight, vendor-neutral CLI that installs and maintains AI repository
standards. It analyzes a repository and renders artifacts — like `AGENTS.md` —
from a Standards Package. The repository becomes the long-term memory; AI
coding assistants become interchangeable execution engines.

## Is it an AGENTS.md generator?

No. `AGENTS.md` is simply one artifact. The engine does not know that file
exists — or any artifact name, AI vendor, language, or company convention. It
renders whatever the Standards Package declares.

## How is this different from memory or MCP servers?

Those store context in the tool, the server, or the assistant. DoozCTL stores
context in the repository itself (`.ai/`). Any assistant that can read files
can use it. Nothing leaves your machine.

## Which AI tools does it work with?

Any that read files. Cursor, Claude Code, Codex, Gemini CLI, OpenCode, and
future tools all consume the same `.ai/` memory. DoozCTL is vendor-neutral.

## Will it overwrite my files?

Only what a Standards Package declares, and only per the merge strategy:

- `managed-blocks` rewrites only content inside its markers; your notes outside
  survive every sync.
- `replace-generated` only rewrites files that carry the generated marker.
- `overwrite` replaces the whole file (declare this deliberately).
- `append` never modifies — it adds after.

## Does it work on existing repositories?

Yes. DoozCTL is brownfield-first. It merges into existing files rather than
replacing them. See the [brownfield example](examples/brownfield).

## Do I need to be online?

No. DoozCTL is offline and deterministic. There is no cloud dependency.

## What are the requirements?

Node.js 20 or newer, and optionally `git` (for commit and branch facts in
session summaries).

## What is a Standards Package?

A plain directory with a `package.json` manifest that declares artifacts. No
registry or plugin system. See the [spec](spec.md) and a copyable
[example](examples/standards).

## Why does the session file name have a second in it?

Sessions are immutable. The id is `YYYY-MM-DD_HHMMSS`; two `summarize` runs in
the same second fail rather than overwrite. Wait one second and run again.

## How do I update the managed content?

Run `doozctl sync <repo> <package>`. It re-renders managed artifacts from the
persisted repository analysis — it never re-analyzes, so repeated runs are
byte-identical.

## How do I report a bug or request a feature?

Open an issue on
[GitHub](https://github.com/dooziesoft/doozctl/issues). For security issues,
see [SECURITY.md](SECURITY.md).
