# @dooziesoft/doozctl-standards

A sample [DoozCTL](https://github.com/DoozieSoftware/doozctl) standards package.
It installs starter `AGENTS.md` and `DEVELOPERS.md` files that an AI assistant
and a team can fill in. It is a template to copy and adapt — not policy.

## Installation

```sh
npm install -D @dooziesoft/doozctl-standards
npx doozctl init . node_modules/@dooziesoft/doozctl-standards
```

Or point DoozCTL directly at the cloned directory of this repository:

```sh
doozctl init . ./standards
```

## What it installs

| Destination     | Managed blocks                                  |
| --------------- | ----------------------------------------------- |
| `AGENTS.md`     | people, workflows, expectations, session-memory |
| `DEVELOPERS.md` | getting-started, contribution                   |

Blocks are replaced by `doozctl sync`; everything outside them is preserved.

## Workflow methods

`workflows/` ships the five v2 workflow methods (`standard`, `feature`,
`bug-fix`, `triage`, `investigation`) as Markdown assets. DoozCTL never knows
these names; a repository adopts the ones it needs by copying them into
`.dooz/workflows/adopted/` (see `docs/v2/WORKFLOW-SPEC.md`).

## Doozie practice (private)

`doozie-practice.md` distills the relevant parts of the global `GEMINI.md` agent rules for Doozie — intent handling, investigate-before-editing, hard gates, verification-as-part-of-work, safety, and Definition of Done — filtered to align with DoozCTL (minimal, deterministic, brownfield-first, repository over conversation). It is reference only and not installed into consumer repos; `AGENTS.md` stays lean (managed blocks only) and points here for detail.

## Rolling your own package

Copy this directory, edit `package.json` (keep `"format": 2`), add artifact
files, and point `doozctl init` at it. Read the DoozCTL spec for the artifact
contract (merge strategies, lifecycle, markers).
