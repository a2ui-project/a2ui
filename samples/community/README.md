This folder contains code that is not maintained.

It is self-contained so it can be lifted into its own repository: the samples
depend on the published `@a2ui/*` (npm) and `a2ui-agent-sdk` (PyPI) packages
rather than on the monorepo workspace, and the folder carries its own
`package.json` / `.yarnrc.yml` / `yarn.lock`.

## CI

`.github/workflows/community_code.yml` validates this folder on changes:

- **web** — `yarn install` then builds the Angular (`a2a-chat-canvas`,
  `orchestrator`) and Lit (`mcp-apps-in-a2ui-sample`, `personalized_learning`)
  samples.
- **python** — `uv sync` for each agent under `agent/adk`.

TODO: organize samples in this folder - https://github.com/a2ui-project/a2ui/issues/1698
