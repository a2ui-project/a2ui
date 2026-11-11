# Core triage definitions

The triage process is described in [triage.md](../../../../docs/contributing/triage/triage.md), and its labels in [labels.md](../../../../docs/contributing/triage/labels.md). The blueprints in this folder describe the automation that supports it.

## Contributors

1. A **team member** is anyone with the `OWNER`, `MEMBER` or `COLLABORATOR` association on the repository.
2. An **out-of-team contributor** is anyone else. Bots are out-of-team contributors, so an issue filed by a workflow or a PR opened by dependabot needs triage like any other.
3. The **triage bot** is the author of every comment that starts with `**From triage bot:**` and is posted from a team member's or bot's account.

## Triage jobs

1. The [flagger](../../triage/blueprints/flagging.blueprint.md) adds `status: needs-triage` to the items that need triage, and removes it from the rest.

   1. Runs: when an item changes, and daily.
   2. Started by: a GitHub workflow.
   3. Needs to: listen to item changes, and add and remove labels.

2. The [staleness pinger](features/staleness_ping.blueprint.md) asks the assignees of stale items to act, before the flagger flags those items.

   1. Runs: daily.
   2. Started by: a GitHub workflow.
   3. Needs to: comment on items, and send messages to team members.

3. The [advisor](features/advisor.blueprint.md#triage-suggestions) posts a triage suggestion on each item that needs triage.

   1. Runs: daily.
   2. Started by: a scheduled agent that runs the [a2ui-triage-advisor](../../../../.agents/skills/a2ui-triage-advisor/SKILL.md) skill.
   3. Needs to: query an AI agent, and comment on items.

4. The [triage UI](features/ui.blueprint.md) helps the triager finalize the suggestions and apply them, or postpone the items till the team discussion with `status: needs-team-input`. Once an item is triaged, the flagger removes its `status: needs-triage`.

   1. Runs: weekly.
   2. Started by: the triager, a person.
   3. Needs to: show a UI, and update items.
