---
name: a2ui-doc-sync-check
description: Auditing codebase implementations for synchronization drift with the user documentation, readmes, and code comments.
---

# A2UI Code and Documentation Synchronization Check Skill

This skill guides the process of auditing concrete codebase implementations to verify that they are synchronized with their respective documentation files, codebase READMEs, and inline code comments/docstrings.

---

## **Instructions**

1. **Locate Documentation and Readmes**:
   - Find all user guides, tutorials, and specifications under `docs/` and `specification/`.
   - Find the `README.md` files in each codebase directory.

2. **Audit Readme Commands and Configs**:
   - For each codebase directory, parse the `README.md` to extract setup commands, dependencies, build/test commands, and directory layouts.
   - Cross-reference these details with the codebase's project files (e.g. `package.json`, `pyproject.toml`, `pubspec.yaml`, `Package.swift`).
   - If any command listed in the readme is invalid, deprecated, or has wrong arguments, list it as a discrepancy.

3. **Audit Code-vs-Docs Public API and Settings**:
   - Inspect the codebase's public API entrypoints (classes, interfaces, types, methods).
   - Compare them against any descriptions, structural maps, or code snippets in the `docs/` folder.
   - Look for renamed classes, changed signatures, or removed options that are still described in the docs.
   - If the codebase exposes new settings or flags that are undocumented in `docs/` or the spec guides, log them as missing documentation.

4. **Audit Inline Comments and Docstrings**:
   - Audit inline comments and docstrings (e.g. JSDoc in TS, docstrings in Python, triple-slash comments in Dart/Swift) for public APIs.
   - Flag any mismatch where code parameter names, types, return behaviors, or exceptions thrown deviate from what the docstring claims.

5. **Format the Report**:
   - Build a Markdown report summarizing the findings:
     - Table of audited directories.
     - **Documentation Drift**: Mismatches between documentation guides (`docs/`) and codebase implementations.
     - **Readme Errors**: Invalid setup, compile, or test commands found in `README.md` files.
     - **Docstring Mismatches**: Outdated parameter names or behaviors described in inline comments.
   - Return this Markdown report as your final response.
