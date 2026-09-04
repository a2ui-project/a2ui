## Unreleased

- Invoke ANTLR from the grammar's directory when regenerating the Express parser, so generated file headers no longer embed the absolute path of the machine that built them.
- Stop rewriting the non-package fallback import in the generated Express visitor to a relative import, which pointed at a module name the rename step had already replaced. A from-source build now leaves the working tree clean.

## 0.5.0

- Rename inference format `Transport` / `transport` terminology to `Direct JSON` / `direct_json` (`DirectJsonFormat`, `DirectJsonParser`, `DirectJsonStreamParser`). Deprecate `a2ui.inference_formats.transport` module alias.
- Cache `A2uiValidator` on `A2uiCatalog.validator` using `functools.cached_property` to avoid redundant construction on every access (#1972).

## 0.4.0

- Standardize Python namespace packages to PEP 420 (#1815). Note: Breaking change removing `a2ui.__version__` from the root `a2ui` namespace level; use `from a2ui.version import __version__`.
- Update required `a2ui-core` dependency to `>=0.1.1,<0.2.0`.

## 0.3.0

- Split `a2ui_core` and `a2ui_agent` into separate packages.

## 0.2.4

## 0.2.3

## 0.2.2

## 0.2.1

## 0.2.0

## 0.1.2

## 0.1.1
