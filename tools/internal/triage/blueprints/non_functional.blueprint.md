# Non-functional details

The triage automation consists of:

1. Skills in [`.agents/skills/`](../../../../.agents/skills/), such as [a2ui-triage-bot](../../../../.agents/skills/a2ui-triage-bot/SKILL.md).
2. Dart packages in [`pkgs/`](../pkgs/):

   1. [`shared`](../pkgs/shared/): Dart-only code that the other packages and the triage bot use, such as the [`TriageSuggestion`](features/triage_bot/suggestion.blueprint.md#the-triagesuggestion-component) component, the labels, and the GitHub client.
   2. [`flagger`](../pkgs/flagger/): the [flagger](features/flagger.blueprint.md), and the command that prints why it flags an item.
   3. [`ui`](../pkgs/ui/): the Flutter application of the [triage UI](features/ui.blueprint.md).

## Dart packages

The code of a Dart package is in `lib/src/`, with one folder per feature, named like the feature's blueprint in [`features/`](features/). For example, `lib/src/triage_bot/` implements the blueprints in [`features/triage_bot/`](features/triage_bot/). Code that several features use goes in `lib/src/shared/`, and code that several packages use goes in the `shared` package.

Tests mirror this layout in `test/`.
