# Security Policy

DoozCTL is a local, offline CLI. It analyzes and writes files only in the
repository and directories you pass it. It never phones home.

## Reporting a vulnerability

Do not open a public issue for a security problem. Report privately to the
maintainers at **security@dooziesoft.com**.

Please include:

- The command and inputs that reproduce the issue.
- The affected version.
- The impact you observed.

You will receive an acknowledgement within 3 business days, and a fix plan or
mitigation within 10 business days.

## Scope

In scope: the engine (`src/`), the merge engine (`src/engine/merge.ts`), the
CLI, and the Standards Package loader.

Out of scope: third-party dependencies (report those to their owners), and
Standards Packages themselves (they are code the user chooses to run).

## Safe handling of artifacts

- DoozCTL never overwrites files that do not carry engine markers, except
  `overwrite` artifacts the user explicitly declares.
- The engine writes only what a Standards Package declares — inspect packages
  you did not author before running `init` or `sync` against them.
