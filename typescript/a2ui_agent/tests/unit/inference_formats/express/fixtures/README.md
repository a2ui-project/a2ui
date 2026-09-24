# Express unit-test fixtures

The Express format is a port of the Python implementation on `main`
(`agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/`).
These fixtures record that implementation's output so the TypeScript port can
be checked against it without a Python toolchain.

- `basic_v1_0_helper.json`, `basic_v0_9_helper.json`: the tables that Python's
  `CatalogSchemaHelper` builds for the v1.0 and v0.9 basic catalogs (component
  property order, required properties, checkability, enums, function argument
  order, and required arguments).
- `visitor_cases.json`: Express snippets with the `statements` and `errors`
  that Python's `ExpressAstVisitor` and `ExpressErrorListener` produce for them,
  using the same pipeline as `compiler.py` (lexer, parser, then visitor
  starting before the first error line).
- `forms_catalog_v1_0.json`: a copy of `conformance/test_data/catalogs/forms_catalog_v1_0.json`
  from `main`, reformatted by Prettier. It declares `checks` as an own property
  instead of inheriting it from `Checkable`.

To regenerate, run the Python helper or visitor from `main` on the same inputs
and write the results as JSON. Keep key order as Python emits it, because the
helper tables encode positional-argument order.
