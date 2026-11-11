# Non-functional details

The triage automation consists of:

1. Skills in [`.agents/skills/`](../../../../.agents/skills/), such as [a2ui-triage-advisor](../../../../.agents/skills/a2ui-triage-advisor/SKILL.md).
2. Dart packages in [`pkgs/`](../pkgs/):

   1. [`triage`](../pkgs/triage/): Dart-only code, such as the [`TriageSuggestion`](features/advisor.blueprint.md#the-triagesuggestion-component) component.
   2. [`triage_ui`](../pkgs/triage_ui/): the Flutter application of the [triage UI](features/ui.blueprint.md).

3. The TypeScript implementation of the [flagger](../../triage/blueprints/flagging.blueprint.md), in [`tools/internal/triage/flagging/`](../../triage/flagging/).

## Dart packages

The code of a Dart package is in `lib/src/`, with one folder per feature, named like the feature's blueprint in [`features/`](features/). For example, `lib/src/triage_item/` implements [triage_item.blueprint.md](features/triage_item.blueprint.md). Code that several features use goes in `lib/src/shared/`.

Tests mirror this layout in `test/`.
