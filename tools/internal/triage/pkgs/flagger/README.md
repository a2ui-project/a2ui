# flagger

The flagger adds `status: needs-triage` to the open issues and PRs that need attention from the team, and removes it once they don't. The [`Flag/Unflag issues and PRs`](../../../../../.github/workflows/triage.yml) workflow runs it daily and on issue and PR events.

1. [flagger.blueprint.md](../../blueprints/features/flagger.blueprint.md): the rules the flagger follows.
2. [`lib/src/flagger/`](lib/src/flagger/): the code. `rules.dart` has the rules, and `reconcile.dart` applies them to every open item.
3. [`bin/flagger.dart`](bin/flagger.dart): the command that the workflow runs. It reads the repository from `GITHUB_REPOSITORY`, and the token from `GITHUB_TOKEN` or `gh auth token`.
4. [`bin/flag_reason.dart`](bin/flag_reason.dart): prints why the flagger flags the given items, without changing their labels. The [triage bot](../../../../../.agents/skills/a2ui-triage-bot/SKILL.md) runs it from the repository root:

   ```sh
   dart run tools/internal/triage/pkgs/flagger/bin/flag_reason.dart 123 https://github.com/a2ui-project/a2ui/pull/456
   ```

The code that the flagger shares with the [staleness pinger](../pinger/) and the triage UI, such as the labels, the GitHub client and reading items, is in the [`shared`](../shared/) package.

## Testing

```sh
dart test
```

The tests use a fake GitHub, in `test/support/fakes.dart`.

The triage process the flagger supports is described in [docs/contributing/triage/triage.md](../../../../../docs/contributing/triage/triage.md).
