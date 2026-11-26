# ui

The triage UI, a Flutter app for macOS and the web that helps the triager go
through the GitHub items in the A2UI repository that need triage, and apply the
suggestions in the triage bot's analyses. [ui.blueprint.md](../../blueprints/features/ui.blueprint.md)
describes what it does.

## GitHub access

The app reads and changes items with your GitHub token. Everything the app
applies, such as replies, labels and assignees, is done from your account.

On macOS, the app uses `GITHUB_TOKEN` or `GH_TOKEN`, or else the token that
`gh auth token` prints. Without one, it shows **Sign in to GitHub**, where you
paste a token. The app keeps it until you quit.

On the web, the app cannot read the environment, so you sign in on the page:

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

From VS Code, select **macOS** as the device and run the `triage_ui` launch
configuration. From a terminal, in the repository root:

```bash
tools/internal/triage/triage_ui.sh https://github.com/a2ui-project/a2ui/issues/123
```

The script opens the item in the running app, or starts the app with it. While
it runs, the app listens on `127.0.0.1:47123` for the items the script sends,
and refuses requests from web pages.

### On the web

From VS Code, select **Chrome** as the device and run the `triage_ui`
launch configuration, which passes your token (`GITHUB_TOKEN`, `GH_TOKEN` or
`gh auth token`) to the app in a file that only you can read. From a terminal,
in this folder, the same script does it:

```bash
tool/flutter_with_github_token.sh run -d chrome
```

To open an item when the app starts, add it to the page's URL, as in
`http://localhost:<port>/?item=https://github.com/a2ui-project/a2ui/issues/123`.
On the web, the app does not listen for items, so `triage_ui.sh` cannot send
items to it.

## Code

- `lib/src/github/`: the queries, and the sign-in (`github_access.dart`),
  which gives the GitHub client the triager's token and signs the triager out
  when GitHub refuses it.
- `lib/src/model/`: the items, the service that reads and changes them, the
  triager's drafts, applying a suggestion, what the triager did in the
  session, and the controller that holds the app's state.
- `lib/src/ui/`: the widgets. `analysis_surface.dart` renders the
  analysis comment as an A2UI surface, whose `TriageAnalysis` component
  is the editor in `analysis_editor.dart`.

## Testing

```bash
flutter test
```

The tests use a fake GitHub, in `test/support/fake_github.dart`.
