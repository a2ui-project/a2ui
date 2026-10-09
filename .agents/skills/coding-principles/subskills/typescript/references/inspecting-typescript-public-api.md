# Inspecting TypeScript Public API (AST Approach)

This guide documents the procedure for identifying and diffing changes to the
public API surface of TypeScript packages in the repository.

---

## Why AST Analysis is Required

Detecting changes to a package's public API surface cannot rely on naive text
searches or raw diffs. TypeScript packages in this repository use barrel files
(`index.ts`, `public-api.ts`) that re-export symbols across submodules.

Text-based searches fail because:

1.  **Re-export chains**: Symbols re-exported via `export * from '...'` or
    re-exported through nested directories are invisible in top-level diffs when
    only the leaf module changes.
2.  **Type vs. Value discrimination**: Under `--isolatedModules` (`TS1448`),
    packages must differentiate between type-only exports (`export type { Foo
}`) and runtime value exports (`export { Bar }`).
3.  **Symbol renames and aliases**: `export { OriginalName as PublicName }`
    changes the public surface without changing the original identifier.
4.  **Accidental internal leaks**: Wildcard exports can inadvertently expose
    helper functions, internal interfaces, or test utilities to library
    consumers.

Using Abstract Syntax Tree (AST) tools such as `ts-morph` resolves module
specifiers and export chains, providing an exact list of public declarations.

---

## Procedure

### Step 1: Map Public Entry Points

Check the package configuration files to find all exposed entry points:

- Inspect `package.json` for `exports`, `main`, and `types` fields.
  - Root entry point: `.` -> `src/index.ts` or `src/public-api.ts`
  - Versioned or feature subpaths: `./v0_9` -> `src/v0_9/index.ts`, `./v0_8`
    -> `src/v0_8/index.ts`, `./testing` -> `src/v0_9/testing/public-api.ts`
- For Angular packages, check `ng-package.json` files in the root and
  subdirectories to identify secondary entry points.

### Step 2: Extract Exported Declarations Using `ts-morph`

`ts-morph` resolves all export declarations and re-export chains across the
project via `sourceFile.getExportedDeclarations()`.

```typescript
import {Project, Node} from 'ts-morph';

function getPublicApiSymbols(tsConfigPath: string, entryFilePath: string) {
  const project = new Project({
    tsConfigFilePath: tsConfigPath,
    skipAddingFilesFromTsConfig: true,
  });

  const sourceFile = project.addSourceFileAtPath(entryFilePath);
  project.resolveSourceFileDependencies();

  const exportedDeclarations = sourceFile.getExportedDeclarations();
  const symbols = new Map<string, {kind: string; isTypeOnly: boolean; filePath: string}>();

  for (const [name, declarations] of exportedDeclarations) {
    const primaryDecl = declarations[0];
    const kindName = primaryDecl ? primaryDecl.getKindName() : 'Unknown';
    const isTypeOnly = primaryDecl
      ? Node.isInterfaceDeclaration(primaryDecl) || Node.isTypeAliasDeclaration(primaryDecl)
      : false;
    const filePath = primaryDecl ? primaryDecl.getSourceFile().getFilePath() : '';

    symbols.set(name, {kind: kindName, isTypeOnly, filePath});
  }

  return symbols;
}
```

### Step 3: Compare Base Commit vs. PR Head

To compute the public API diff between the PR branch and its base:

1.  **Extract Base Symbols**: Extract symbols at the base commit (e.g. `main` or
    the parent branch in a stack).
2.  **Extract Head Symbols**: Extract symbols at the PR branch head.
3.  **Compute Set Differences**:
    - **Added Symbols**: Symbols present in Head but not in Base.
      - Verify each added symbol is intentional.
      - Ensure internal helpers are not leaked.
    - **Removed Symbols**: Symbols present in Base but not in Head.
      - Flag any removed symbol as a potential breaking change.
    - **Modified Signatures**: Symbols present in both whose parameter lists,
      return types, or property definitions changed.

#### Standalone Comparison Script

You can run this Node script in a temporary scratch file or directory to inspect
a package:

```javascript
const {Project, Node} = require('ts-morph');
const path = require('path');

function analyzeEntry(entryPath, tsConfigPath) {
  const project = new Project({
    tsConfigFilePath: tsConfigPath,
    skipAddingFilesFromTsConfig: true,
  });

  const sourceFile = project.addSourceFileAtPath(entryPath);
  project.resolveSourceFileDependencies();

  const exportsMap = sourceFile.getExportedDeclarations();
  const result = {};

  for (const [name, decls] of exportsMap) {
    const decl = decls[0];
    const isType = decl
      ? Node.isInterfaceDeclaration(decl) || Node.isTypeAliasDeclaration(decl)
      : false;
    result[name] = {
      kind: decl ? decl.getKindName() : 'Unknown',
      isTypeOnly: isType,
      sourceFile: decl ? path.relative(process.cwd(), decl.getSourceFile().getFilePath()) : '',
    };
  }

  return result;
}
```

---

## Review Checklist for Public API Changes

When reviewing public API changes uncovered by the AST diff:

- [ ] **Curated Named Exports**: Verify that newly exposed symbols are
      explicitly enumerated with `export { Name, type TypeName }` rather than
      leaking via `export *`.
- [ ] **Breaking Removals & Renames**: Verify that removed symbols are
      documented with migration instructions and marked with `**BREAKING
CHANGE**:` in `CHANGELOG.md`.
- [ ] **Type vs. Value Accuracy**: Verify that type-only symbols use `export
type { ... }` so `--isolatedModules` builds succeed cleanly.
- [ ] **Cross-Package Boundary**: Verify that symbols originating in
      `@a2ui/web_core` are not re-exported as pass-through shims in framework
      renderers (`@a2ui/angular`, `@a2ui/lit`, `@a2ui/react`).
