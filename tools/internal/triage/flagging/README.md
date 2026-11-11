# Triage flagging bot

The bot adds `status: needs-triage` to open issues and PRs that need attention from the team, and removes it once they don't. The [`Flag/Unflag issues and PRs`](../../../../.github/workflows/triage.yml) workflow runs it daily and on issue and PR events.

- [flagging.blueprint.md](../blueprints/flagging.blueprint.md): the rules the bot follows.
- [triage.mts](triage.mts): the script that applies the rules.
- [triage.test.mts](triage.test.mts): the tests.
- [flag_reason.mts](flag_reason.mts): prints why the bot flags the given items, without changing their labels. The [triage bot](../../../../.agents/skills/a2ui-triage-bot/SKILL.md) uses it. Its tests are in [flag_reason.test.mts](flag_reason.test.mts).

Node runs the TypeScript files directly, so the bot and its tests need no build or install. To check the types, run this in the parent folder, [`tools/internal/triage`](..), which holds `package.json` and `tsconfig.json`:

```sh
npm ci
npm run typecheck
```

`npm test` runs the tests.

The triage process the bot supports is described in [docs/contributing/triage/triage.md](../../../../docs/contributing/triage/triage.md).
