---
name: coding
description: >
  Language agnostic coding skills.
---

# Coding Skills

This skill provides coding best practices, adopted by the team, not specific to any single language or framework.

## Code visibility

Make every code element as private as it can be. If tests need access, use the
language's test-visibility mechanism instead of making the element public.
For example, in Dart, annotate the element with `@visibleForTesting`.
