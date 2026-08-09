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
- [x] CODEOWNERS

## Stage F — Website (`ctl.dooziesoft.com`)

- [ ] Landing page
- [ ] Install / init / sync / summarize / doctor / status
- [ ] Architecture diagram
- [ ] Philosophy
- [ ] Links

## Stage G — Release Review

- [ ] Independent product review (staff-engineer lens)
- [ ] `v1.0.0-rc.1` tag
- [ ] External review
- [ ] `v1.0.0`
