# DoozCTL v1.0 Release Checklist

> The implementation agent loops until every checkbox is green.
> Each stage must be complete and committed before the next begins.

## Stage A — Core Workflows

- [x] `init`
- [x] `sync`
- [x] `summarize`
- [x] `doctor`
- [x] `status`
- [x] `analyze`

## Stage B — UX

- [x] Every command has `--help`
- [x] Examples for every command
- [x] Human-readable errors
- [x] Progress reporting
- [x] Exit codes documented (README)
- [x] Version consistency (single source in `src/cli/cli.ts`, mirrored in `package.json`)
- [x] README quick start
- [x] Demo repository (`examples/`)

## Stage C — Documentation

- [x] README
- [x] SPEC
- [x] ARCHITECTURE
- [x] CONTRIBUTING
- [x] CHANGELOG
- [x] ROADMAP
- [x] SECURITY
- [x] CODE_OF_CONDUCT
- [x] LICENSE
- [x] Standards Package Spec
- [x] FAQ

## Stage D — Examples

- [x] `examples/hello-world`
- [x] `examples/standards`
- [x] `examples/brownfield`
- [x] `examples/generated`

## Stage E — OSS

- [x] GitHub Actions (CI on push/PR, Linux/macOS/Windows × Node 20/22/24)
- [x] Issue templates
- [x] PR template
- [x] Release workflow (tag → npm publish + draft GitHub release)
- [x] Labels documentation
- [x] CODEOWNERS

## Stage F — Website (`ctl.dooziesoft.com`)

- [x] Landing page
- [x] Install / init / sync / summarize / doctor / status
- [x] Architecture diagram
- [x] Philosophy
- [x] Links
- [x] GitHub Pages workflow + CNAME (DNS handoff pending)

## Stage G — Release Review

- [x] Independent product review (staff-engineer lens) — found and fixed `analyze` writing into uninitialized repositories; all commands now error cleanly when uninitialized
- [x] `v1.0.0` tag created locally (2026-08-13) — frozen release line `release/v1`; npm publish and GitHub release intentionally not automated
- [ ] External review (open after local freeze)

> GitHub repo: `DoozieSoftware/doozctl` (public). All docs/links repointed from
> the inaccessible `dooziesoft` slug to `DoozieSoftware`. npm package scope
> `@dooziesoft/doozctl` and the `ctl.dooziesoft.com` custom domain are unchanged.
> Discussions could not be disabled via repo API (org-level control); harmless
> for the RC.
