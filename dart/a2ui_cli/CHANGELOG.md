# [a2ui_cli](https://pub.dev/packages/a2ui_cli) Changelog

## Unreleased

- (v1_0) Filter `@catalogId`, `@metadata`, and `@accessibility` from component
  builder properties in `CatalogAnalyzer`, detect checkable components from
  `@checks`, and emit `serialization_alias="@checks"` and
  `validation_alias=AliasChoices("@checks", "checks")` on generated Python v1.0
  checkable component builders while preserving custom component properties
  named `metadata`, `catalogId`, `accessibility`, or `checks`
  ([#3466](https://github.com/a2ui-project/a2ui/issues/3466),
  [#4012](https://github.com/a2ui-project/a2ui/issues/4012),
  [#4044](https://github.com/a2ui-project/a2ui/pull/4044)).

## 0.3.0

- **Breaking:** Requires `a2ui_core` `^0.7.0` (`a2ui_cli` exposes `a2ui_core`
  types in its public API).

- Added `a2ui lint` (`LintCommand`, `lintCatalog`, `CatalogLintFinding`, and `LintSeverity`) to validate catalog JSON schemas against deterministic protocol rules with JSON Pointer locations, including v1.0 Unicode UAX 31 identifiers, component and function discriminators, the reserved `Surface` component name, v1.0 `requiresUserActivation` caller constraints, and redundant `ComponentCommon` or `FunctionCommon` wrapping ([#3831](https://github.com/a2ui-project/a2ui/pull/3831)).

## 0.2.0

- **Breaking:** Bump `a2ui_core` dependency to `^0.5.0` (`a2ui_cli` exposes
  `CatalogApi`, `ComponentApi`, `FunctionApi`, and `A2uiReturnType` in its
  public API, and `CodegenCatalog.fromJson` inherits `a2ui_core` `0.5.0` catalog
  validation rules).
- Add standalone curl and PowerShell installer scripts (`scripts/public/install_cli.sh`, `scripts/public/install_cli.ps1`) for pre-built CLI binary releases ([#3738](https://github.com/a2ui-project/a2ui/pull/3738)).

## 0.1.0

- Initial release of the A2UI CLI developer tool and typesafe component generator.
- Support `codegen` command for generating Python client component builders from catalog schemas across protocol versions 0.9, 0.9.1, and 1.0.
- Resolve `$defs/Child` references as single child components (`Child`) and target `a2ui.builder.v1_0` when generating code from v1.0 catalogs.
- Support compile-time `CLI_VERSION` overrides for `packageVersion` ([#3700](https://github.com/a2ui-project/a2ui/pull/3700)).
- Bump `a2ui_core` dependency to `^0.4.0`.
