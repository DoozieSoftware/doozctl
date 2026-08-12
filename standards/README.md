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

| Destination   | Managed blocks                       |
| ------------- | ------------------------------------ |
| `AGENTS.md`   | people, workflows, expectations      |
| `DEVELOPERS.md` | getting-started, contribution      |

Blocks are replaced by `doozctl sync`; everything outside them is preserved.

## Rolling your own package

Copy this directory, edit `package.json` (keep `"format": 2`), add artifact
files, and point `doozctl init` at it. Read the DoozCTL spec for the artifact
contract (merge strategies, lifecycle, markers).