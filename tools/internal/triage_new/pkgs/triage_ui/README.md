# triage_ui

The triage UI, a macOS Flutter app that helps the triager go through the
GitHub items in the A2UI repository that need triage, and apply the triage bot's
triage suggestions. [ui.blueprint.md](../../blueprints/features/ui.blueprint.md)
describes what it does.

## GitHub access

The app reads and changes items with your GitHub token. It uses
`GITHUB_TOKEN` if it is set, and otherwise runs `gh auth token`, so log in
with `gh auth login` first. Everything the app applies, such as replies,
labels and assignees, is done from your account.

The app runs outside the macOS app sandbox, so that it can run `gh`.

## Running

From VS Code, run the `triage_ui` launch configuration. From a terminal, in
the repository root:

```bash
tools/internal/triage_new/triage_ui.sh https://github.com/a2ui-project/a2ui/issues/123
```

The script opens the item in the running app, or starts the app with it. While
it runs, the app listens on `127.0.0.1:47123` for the items the script sends.

## Code

- `lib/src/github/`: the GitHub client, the queries, and the service that
  reads and changes items.
- `lib/src/model/`: the items, the triager's drafts, applying a suggestion,
  the session report, and the controller that holds the app's state.
- `lib/src/ui/`: the widgets. `suggestion_surface.dart` renders the
  suggestion comment as an A2UI surface, whose `TriageSuggestion` component
  is the editor in `suggestion_editor.dart`.

## Testing

```bash
flutter test
```

The tests use a fake GitHub, in `test/support/fake_github.dart`.
