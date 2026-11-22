# ui

The triage UI, a Flutter app for macOS and the web that helps the triager go
through the GitHub items in the A2UI repository that need triage, and apply the
triage bot's triage suggestions. [ui.blueprint.md](../../blueprints/features/ui.blueprint.md)
describes what it does.

## GitHub access

The app reads and changes items with your GitHub token. It uses
`GITHUB_TOKEN` if it is set, and otherwise runs `gh auth token`, so log in
with `gh auth login` first. Everything the app applies, such as replies,
labels and assignees, is done from your account.

The app runs outside the macOS app sandbox, so that it can run `gh`.

On the web, the app can neither read the environment nor run `gh`, so you
sign in on the page:

- On the hosted UI, at go/a2ui-triage-ui, with **Sign in with GitHub**, or
  with **Use a token** and the token that `gh auth token` prints. The
  [server](../server/README.md) keeps the token in an encrypted cookie, and
  passes the app's GitHub calls through. [HOSTING.md](../server/HOSTING.md)
  explains how to host it.
- With `flutter run`, with **Use a token**. The browser keeps the token in
  the page's local storage until you sign out. Or pass the token with
  `--dart-define=GITHUB_TOKEN=<token>`. The token is then in the compiled
  app, so run it only on your own computer, and do not deploy a build of it.

## Running

From VS Code, run the `triage_ui` launch configuration. From a terminal, in
the repository root:

```bash
tools/internal/triage/triage_ui.sh https://github.com/a2ui-project/a2ui/issues/123
```

The script opens the item in the running app, or starts the app with it. While
it runs, the app listens on `127.0.0.1:47123` for the items the script sends.

### On the web

From VS Code, run the `triage_ui, web` launch configuration, which passes
`GITHUB_TOKEN` from the environment VS Code runs in. From a terminal, in this
folder:

```bash
flutter run -d chrome --dart-define=GITHUB_TOKEN="$(gh auth token)"
```

To open an item when the app starts, add it to the page's URL, as in
`http://localhost:<port>/?item=https://github.com/a2ui-project/a2ui/issues/123`.
On the web, the app does not listen for items, so `triage_ui.sh` cannot send
items to it.

## Code

- `lib/src/github/`: the GitHub client, the queries, the service that
  reads and changes items, and the sign-in on the web (`github_access.dart`).
- `lib/src/model/`: the items, the triager's drafts, applying a suggestion,
  what the triager did in the session, and the controller that holds the
  app's state.
- `lib/src/ui/`: the widgets. `suggestion_surface.dart` renders the
  suggestion comment as an A2UI surface, whose `TriageSuggestion` component
  is the editor in `suggestion_editor.dart`.

## Testing

```bash
flutter test
```

The tests use a fake GitHub, in `test/support/fake_github.dart`.
