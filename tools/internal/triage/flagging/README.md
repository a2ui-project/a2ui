# Triage flagging bot

The bot adds `status: needs-triage` to open issues and PRs that need attention from the team, and removes it once they don't. The [`Flag/Unflag issues and PRs`](../../../../.github/workflows/triage.yml) workflow runs it daily and on issue and PR events.

- [blueprint.md](blueprint.md): the rules the bot follows.
- [triage.mts](triage.mts): the script that applies the rules.
- [triage.test.mts](triage.test.mts): the tests.

Node runs the TypeScript files directly, so the bot and its tests need no build or install. To check the types, run this in this folder:

```sh
npm ci
npm run typecheck
```

`npm test` runs the tests.

The triage process the bot supports is described in [docs/contributing/triage/triage.md](../../../../docs/contributing/triage/triage.md).
