---
name: a2ui-dart-development
description: >-
  Language version, analysis, formatting and verification rules for Dart code
  in the A2UI repository (the packages under dart/ and the Flutter samples
  under samples/client/flutter/). Use when writing, refactoring or reviewing
  Dart code, and before claiming that a line of Dart does not compile.
---

# Dart development

This skill is for anyone who writes or reviews Dart code in this repository:
the packages under `dart/`, such as `a2ui_core` and `a2ui_agent`, and the
Flutter samples under `samples/client/flutter/`. To record a change in a
package's `CHANGELOG.md`, see
[a2ui-dart-versioning](../a2ui-dart-versioning/SKILL.md).

## Language version

The lower bound of `environment: sdk:` in a package's `pubspec.yaml` is the
Dart language version of that package. Every language feature released up to
that version is valid in the package. Every later feature is a compile error,
whatever SDK is installed. The packages do not all require the same version,
so read the `pubspec.yaml` of the package you are changing. For example,
`dart/a2ui_core` requires `>=3.5.0` and `dart/a2ui_agent` requires
`>=3.8.0`, so `{'catalogId': ?catalogId}` is valid in `a2ui_agent` and a
compile error in `a2ui_core`.

Features that assistants often misjudge, with the version that added each:

- 3.0: records, patterns (`if (json case {'id': final String id})`, switch
  expressions, destructuring), and the class modifiers `sealed`, `final`,
  `base`, `interface` and `mixin class`.
- 3.3: extension types.
- 3.6: digit separators, such as `1_000_000`.
- 3.7: wildcard variables. A parameter or local named `_` declares nothing,
  so several parameters of one function can each be named `_`.
- 3.8: null-aware elements. `{'key': ?value}` and `[?item]` leave the entry
  out when the value is null.
- 3.10: dot shorthands. Where the context type is known, `.center` stands for
  `Alignment.center` and `.new(...)` for a constructor call.
- 3.12: private named parameters, such as `A({required this._x})`.
- 3.13: primary constructors, such as `class Point(final int x, final int y);`.

The full list is in Dart's
[language evolution](https://dart.dev/resources/language/evolution) page.

When you write code:

- Use the features the package's language version allows, as the code around
  yours does. Do not rewrite valid code into an older form. Some lints ask for
  the newer form: with `package:lints/recommended.yaml`, which the root
  `analysis_options.yaml` includes, `use_null_aware_elements` flags
  `if (value != null) 'key': value` in a package where `'key': ?value` works.
- Do not use a feature newer than the package's language version, even when
  your SDK supports it. Raising the lower bound of `environment: sdk:` drops
  users of older SDKs, so it is a change of its own, with a reason and an
  entry in `CHANGELOG.md`.

When you review code, or before you say that a line does not compile:

1. Find the language version that the feature needs. Your training data may
   predate the feature, so check the
   [language evolution](https://dart.dev/resources/language/evolution) page
   rather than relying on memory.
2. Compare it with the lower bound of `environment: sdk:` in the
   `pubspec.yaml` of the package that holds the file.
3. If you can run commands, run `flutter analyze` in the package. When the
   feature is newer than the package allows, the error names the version
   that the feature needs.

Report a syntax error only when the feature is newer than the package's
language version or the analyzer reports one.

## Analysis

The root [`analysis_options.yaml`](../../../analysis_options.yaml) applies to
every package. A package's own `analysis_options.yaml`, where there is one,
includes it and adds exclusions. The settings that most often fail a change:

- `strict-casts`, `strict-inference` and `strict-raw-types`: a value read from
  JSON is `Object?` or `dynamic`, so cast it or match it with a pattern before
  using it as a narrower type.
- `lines_longer_than_80_chars`, which `dart/a2ui_cli` turns off.
- `specify_nonobvious_local_variable_types` and
  `omit_obvious_local_variable_types`: write the type of a local variable when
  its initializer does not make the type obvious, and leave it off when it
  does. A literal, such as `3` or `<int>[]`, a constructor call with type
  arguments, such as `List<int>.of(xs)`, and a local variable or parameter
  make the type obvious. A getter or method call, such as `map.entries` or
  `xs.first`, does not, and neither does `List.of(xs)`. The variable of a
  `for (... in ...)` loop follows the same rule, with the iterable in place of
  the initializer.
- `prefer_relative_imports` for imports within a package's `lib/`.
- `comment_references`: a name in `[brackets]` in a doc comment must resolve.
- `unawaited_futures`: await a future, or pass it to `unawaited`.

## Formatting

`dart format` picks its style from the language version. From 3.7 it uses
the tall style, which places arguments and trailing commas differently, so
the same code formats differently in `a2ui_core` and in `a2ui_agent`. Run
`dart format` in the package rather than copying the layout of another
package.

## Verification

Run these in the directory of each package you changed, as the
[Flutter packages workflow](../../../.github/workflows/flutter_packages_test.yml)
does:

```bash
dart pub get
dart format --output=none --set-exit-if-changed .
flutter analyze --fatal-infos
flutter test --test-randomize-ordering-seed=random
```

`--fatal-infos` fails on lints too, so a change that leaves any analyzer info
fails CI. In `dart/a2ui_agent`, CI also runs
`dart run tool/generate_express_parser.dart --check`, which fails when the
generated Express parser is out of date with the grammar. After editing the
grammar, run the tool without `--check` and commit its output.
