# generated

Shows `replace-generated`: a file the engine owns entirely. The whole file is
rewritten on every sync — but only if it is engine-generated. A hand-written
file without the marker is never overwritten.

```sh
doozctl init ./repo ./standards
doozctl sync ./repo ./standards
```

`WRAPPER.md` starts with the generated marker, so `sync` rewrites it freely.
Now replace `WRAPPER.md` with a hand-written version (remove the first line)
and run `doozctl sync` again — DoozCTL refuses to touch it. That is the safety
rule: `replace-generated` only ever replaces what the engine generated.

## Files

```
standards/
    package.json
    artifacts/WRAPPER.md   # the generated template (starts with the marker)
```
