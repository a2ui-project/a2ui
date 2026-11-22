# pinger

The staleness pinger asks the assignees of stale issues and PRs to act, before the [flagger](../flagger/) flags the items for triage. The [triage bot](../../../../../.agents/skills/a2ui-triage-bot/SKILL.md) runs it hourly.

1. [staleness_ping.blueprint.md](../../blueprints/features/triage_bot/staleness_ping.blueprint.md): what the pinger does.
2. [`lib/src/`](lib/src/): the code. `staleness_ping.dart` finds the stale items and pings them, and `commenter.dart` posts the comments.
3. [`bin/staleness_ping.dart`](bin/staleness_ping.dart): the command that the triage bot runs from the repository root:

   ```sh
   dart run tools/internal/triage/pkgs/pinger/bin/staleness_ping.dart --dry-run
   ```

   With `--dry-run`, it prints the comments instead of posting them. It reads the repository from `GITHUB_REPOSITORY`, which defaults to `a2ui-project/a2ui`, and the token from `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`. The token must belong to a team member. For the Google Chat messages, it reads `TRIAGE_CHAT_WEBHOOK_URL` and `TRIAGE_CHAT_USERS`.

The definitions of stale items and pings, and reading items from GitHub, are in the [`shared`](../shared/) package, since the flagger uses them too.

## Testing

```sh
dart test
```
