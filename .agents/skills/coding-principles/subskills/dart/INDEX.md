# Dart & Flutter Progressive Discovery Router

Use this router whenever a pull request or local change modifies Dart or Flutter files across `dart/`, `samples/client/flutter/`, or `pubspec.yaml`.

---

## Evaluate Dart & Flutter Subskill Triggers

Inspect the Dart and Flutter files in `git diff main --stat` and apply the rules and subskills below:

### 1. Dart & Flutter Analyzer Standards

- **Configuration**: [`analysis_options.yaml`](../../../../../analysis_options.yaml)
- **Activate if**:
  - Any `*.dart` file is added or modified under `dart/` or `samples/client/flutter/`.
  - Public package barrels (`lib/*.dart`) are modified (expose public API through package-level `lib/<package>.dart` facades and prohibit deep `src/` imports by consumers).

### 2. Dart Package Versioning, Changelogs & `pub.dev` Releases

- **Document**: [`versioning-and-releases.md`](versioning-and-releases.md)
- **Activate if**:
  - Any `CHANGELOG.md` or `pubspec.yaml` under `dart/` is modified.
  - A Dart package (`a2ui_core`, `a2ui_agent`, `a2ui_flutter`, `a2ui_cli`) has public API or behavioral changes that require recording under `## Unreleased`.
  - Preparing a `pub.dev` release pull request.
