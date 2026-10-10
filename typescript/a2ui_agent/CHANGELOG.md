## Unreleased

- `ComponentPruningTransformer` and `FunctionPruningTransformer` carry the source catalog's metadata, authored `$defs` and source document over to the pruned catalog, so its `toJson()` keeps the kept entries as authored. Catalog providers load documents with `Catalog.fromJson`, and the Direct JSON prompt uses `Catalog.validationSchema` ([#3053](https://github.com/a2ui-project/a2ui/issues/3053)).
- Initial implementation of `@a2ui/agent`, supporting A2UI protocol versions v0.9 and v1.0 and the Direct JSON and Express inference formats ([#2814](https://github.com/a2ui-project/a2ui/pull/2814), [#2916](https://github.com/a2ui-project/a2ui/pull/2916), [#2815](https://github.com/a2ui-project/a2ui/pull/2815)).
