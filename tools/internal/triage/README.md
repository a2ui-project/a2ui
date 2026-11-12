Automation for triage process described in [triage.md](../../../docs/contributing/triage/triage.md).

See folder `blueprints` for specifications.

- [flagging](flagging): the flagging bot that adds and removes `status: needs-triage`.
- [scripts](../../../.agents/skills/a2ui-triage-bot/scripts) of the [triage bot](../../../.agents/skills/a2ui-triage-bot/SKILL.md): the scripts that only the triage bot runs. They live with the skill, and this folder tests and type-checks them.

Node runs the TypeScript files directly. In this folder, `npm ci` installs the tools, `npm test` runs the tests, and `npm run typecheck` checks the types.
