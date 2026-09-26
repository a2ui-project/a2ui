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
- `simplified_catalog_v1_0.json`: a copy of `conformance/test_data/catalogs/simplified_catalog_v1_0.json`
  from `main`.
- `custom_catalog_v1_0.json`: a copy of `conformance/test_data/catalogs/custom_catalog_v1_0.json`
  from `main`.
- `compiler_corpus.json`: Express inputs across the simplified, custom, forms and
  both basic catalogs (including every case in `conformance/agent/express/compiler.yaml`)
  with the messages or error that Python's `ExpressCompiler` produces.
- `decompiler_parity_cases.json`: parity corpus of 31 Express message lists (including all 12 from
  `conformance/agent/express/decompiler.yaml` plus 19 more covering all branches) evaluated against
  Python's `ExpressDecompiler` oracle on `main`.
- `conformance_overrides.json`: expected value overrides for parity test cases.
  Used when TypeScript diverges from Python in order to pass a conformance suite case.
  The JSON structure is:
  `{ "fixture_file.json": { "test_case_name": { "justification": "...", "expected": { ... } } } }`

To regenerate any of these, run the corresponding Python code from `main`
on the same inputs and write the results as JSON. Keep key order as Python emits it,
because the helper tables encode positional-argument order.
