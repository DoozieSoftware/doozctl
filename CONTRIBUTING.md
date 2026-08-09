# Contributing to DoozCTL

Thanks for considering a contribution. DoozCTL is small by design. The best
contributions fix a concrete problem for a real repository.

## The ground rules

- **Minimal.** Fewer moving parts is a feature. If a change adds a dependency,
  a concept, or a knob, justify it in the PR.
- **Deterministic.** The engine must produce byte-identical output for the same
  input. No timestamps, no ambient state, no order dependence.
- **Brownfield first.** The engine merges into existing repositories; it never
  destroys user content.
- **The engine knows no domain.** Standards Packages own all domain behavior.
- **Spec first.** Behavior changes update [spec.md](spec.md) in the same PR.

## Setup

Requires Node.js ≥ 20 and pnpm.

```sh
pnpm install
pnpm check        # typecheck + lint + tests
```

## Development loop

1. Write a failing test (TDD).
2. Implement the minimal change to make it pass.
3. Refactor, keeping coverage ≥ 80%.
4. Run `pnpm check` and `pnpm format`.
5. Update the relevant docs (README, ARCHITECTURE, spec).

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add <feature>
fix: correct <behavior>
docs: update <doc>
test: cover <case>
refactor: simplify <area>
```

## Tests

```sh
pnpm test             # unit + integration
pnpm test:watch       # re-run on change
pnpm test:coverage    # coverage report
```

## Reporting bugs

Open an issue with the command you ran, the exact output, and (if possible) a
minimal repository that reproduces it.
