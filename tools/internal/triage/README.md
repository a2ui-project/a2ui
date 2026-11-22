# Triage automation

Automation for the triage process described in [triage.md](../../../docs/contributing/triage/triage.md). The [blueprints](blueprints/) describe what it does, starting with [core.blueprint.md](blueprints/core.blueprint.md).

1. [`pkgs/flagger`](pkgs/flagger/): the flagger, which adds and removes `status: needs-triage`.
2. [`pkgs/ui`](pkgs/ui/): the triage UI, a Flutter app for macOS and the web. [triage_ui.sh](triage_ui.sh) opens an item in it on macOS.
3. [`pkgs/pinger`](pkgs/pinger/): the staleness pinger, which asks the assignees of stale items to act before the flagger flags them.
4. [`pkgs/server`](pkgs/server/): the server of the hosted triage UI, which signs the triager in to GitHub. [HOSTING.md](pkgs/server/HOSTING.md) explains how to host it.
5. [`pkgs/shared`](pkgs/shared/): the code that the other packages and the [triage bot](../../../.agents/skills/a2ui-triage-bot/SKILL.md) share, such as reading items from GitHub and the definitions of stale items, and the triage bot's commands.

The packages are in the Dart workspace of the repository root. Run `flutter pub get` there, and `dart test` (or `flutter test` for `pkgs/ui`) in a package.
