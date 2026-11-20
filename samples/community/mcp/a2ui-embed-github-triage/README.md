# a2ui-embed-github-triage

> [!WARNING]
> Internal proof of concept for [`@a2ui/embed`](../../../../typescript/embed/README.md). It is not
> maintained or published.

A GitHub issue and PR triage MCP server whose tools render interactive A2UI v1.0 views in MCP Apps
hosts through `@a2ui/embed`. This directory is built up over a stack of PRs; this first part has
the data layer:

- A GitHub REST client over `fetch`, with cached reads.
- Fixture mode: `GITHUB_FIXTURES=<dir>` serves a captured snapshot. `yarn build && yarn capture-fixtures`
  reads `a2ui-project/a2ui` into the gitignored `fixtures-local/a2ui`.
- A dry-run write layer: changes are planned as data, and only written when `TRIAGE_WRITE=1` and the
  repository is in `TRIAGE_WRITE_REPOS`.
- The repo's triage rules and canonical replies, and the inbox filters.

```sh
yarn install # from samples/community
yarn build
yarn test
```
