# pinger

The staleness pinger asks the assignees of stale issues and PRs to act, before the [flagger](../flagger/) flags the items for triage. The [triage bot](../../../../../.agents/skills/a2ui-triage-bot/SKILL.md) runs it every hour. [staleness_ping.blueprint.md](../../blueprints/features/triage_bot/staleness_ping.blueprint.md) describes what it does.

1. [`lib/src/staleness_ping.dart`](lib/src/staleness_ping.dart) finds the stale items and pings them. [`github.dart`](lib/src/github.dart) posts the comments, and [`team_chat.dart`](lib/src/team_chat.dart) sends the Google Chat messages.
2. [`bin/staleness_ping.dart`](bin/staleness_ping.dart) is the command. To see what it would post, run from the repository root:

   ```sh
   dart run tools/internal/triage/pkgs/pinger/bin/staleness_ping.dart --dry-run
   ```

## Testing

```sh
dart test
```
