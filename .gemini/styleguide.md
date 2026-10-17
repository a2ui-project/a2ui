# A2UI Style Guide

## Introduction

This style guide outlines the coding conventions for contributions to this repository.

## Style Guides

Code should follow the relevant style guides, and use the correct
auto-formatter, for each language, as described in
[the repository contributing guide's Style section](../CONTRIBUTING.md#coding-style).

## Best Practices

- Code should follow the guidance and principles described in
  [the A2UI contribution guidelines](../CONTRIBUTING.md).
- If there are code changes, code should have tests.
- Dart code may use every language feature up to the lower bound of
  `environment: sdk:` in its package's `pubspec.yaml`, such as null-aware
  elements (`{'key': ?value}`) from Dart 3.8. Before calling Dart syntax
  invalid, check that version, as
  [the Dart development skill](../.agents/skills/a2ui-dart-development/SKILL.md)
  describes.
- PR descriptions should include the Pre-Review Checklist from
  [the PR template](https://github.com/flutter/genui/blob/main/.github/PULL_REQUEST_TEMPLATE.md),
  with all of the steps completed.
