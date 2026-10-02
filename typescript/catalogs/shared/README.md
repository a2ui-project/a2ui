# Shared catalog package code

Code under this directory is compiled into more than one catalog package in `typescript/catalogs/`. It is not a package of its own: there is no `package.json` here, nothing publishes it and nothing imports it by path. Each package that needs it copies it into its own `src/shared/` at build time (the `copy-shared` step in the package's `package.json`), compiles it as its own source and git-ignores the copy, so the published packages stay self-contained and do not depend on each other or on an extra shared package.

## What belongs here

- Code that two or more catalog packages need and that would otherwise be duplicated. Today that is the double-iframe sandbox under [`sandbox/`](sandbox/README.md), used by `@a2ui/catalog-iframe` and `@a2ui/catalog-mcp`.
- Code that only depends on what every catalog package already has: `@a2ui/web_core`, `lit` and the browser. Nothing here imports from a catalog package, and nothing here defines a catalog, a component API or a function of one catalog.
- Tests next to the code they cover (`*.test.ts`) and test fakes under a `testing/` subdirectory. Each package runs the copied tests in its own test suite, so the shared code is tested in every package that ships it.

Code that one package uses lives in that package; move it here when a second package needs it.

## Working on it

Edit the files here, never the copies under `typescript/catalogs/<package>/src/shared/`: the next build overwrites them. Each package's `copy-shared` step lists `../shared/**` as its input, so a change here rebuilds every package that uses it. Keep each concern in its own subdirectory with a README that lists its files.
