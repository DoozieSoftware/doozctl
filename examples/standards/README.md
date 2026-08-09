# standards

A complete, copyable Standards Package showing every merge strategy and the
summarize lifecycle. Start here when authoring your own package.

## Artifacts

| Artifact                         | Strategy         | Lifecycle  | Behavior                                                     |
| -------------------------------- | ---------------- | ---------- | ------------------------------------------------------------ |
| `AGENTS.md`                      | `managed-blocks` | init, sync | Rewrites only the marked blocks; your notes outside survive. |
| `MEMORY.md`                      | `managed-blocks` | init, sync | Same, a second example.                                      |
| `.gitignore`                     | `overwrite`      | init       | Replaced wholesale on init.                                  |
| `.ai/current-context.md`         | `overwrite`      | summarize  | Rewritten every summarize from the session.                  |
| `.ai/sessions/{{session.id}}.md` | `append`         | summarize  | One immutable file per session; never overwritten.           |

## Try it

```sh
doozctl init <some-repo> ./standards
doozctl summarize <some-repo> ./standards ./session.md
```

## The contract

See `spec.md` in the repository root. Key points:

- `format` must be `2`.
- `merge` is one of `managed-blocks`, `overwrite`, `append`, `replace-generated`.
- `lifecycle` lists which commands may render the artifact
  (`init`, `sync`, `summarize`).
- Templates live under `artifacts/` and use `{{dotted.path}}` placeholders.
- Session destinations may reference `{{session.id}}`, `{{session.date}}`,
  `{{session.tool}}`, `{{session.model}}`, `{{session.user}}`,
  `{{session.commit}}`, `{{session.branch}}`, and the capped context fields
  `{{session.objective}}`, `{{session.summary}}`, `{{session.decisions}}`,
  `{{session.filesChanged}}`, `{{session.nextSteps}}`,
  `{{session.openQuestions}}`.
