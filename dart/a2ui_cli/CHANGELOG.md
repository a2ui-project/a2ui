# [a2ui_cli](https://pub.dev/packages/a2ui_cli) Changelog

## Unreleased

- Initial release of the A2UI CLI developer tool and typesafe component generator.
- Support `codegen` command for generating Python client component builders from catalog schemas across protocol versions 0.9, 0.9.1, and 1.0.
- Resolve `$defs/Child` references as single child components (`Child`) and target `a2ui.builder.v1_0` when generating code from v1.0 catalogs.
