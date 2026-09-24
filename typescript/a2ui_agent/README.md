# @a2ui/agent

A2UI Agent SDK for TypeScript and Node.js.

This package targets the A2UI protocol **v0.9** and **v1.0**, and supports the **Direct JSON** and **Express** inference formats. Express takes exactly one catalog and does not stream. The emitted protocol version is derived from the catalog.

## Regenerating the Express parser

The Express lexer, parser, and visitor in `src/inference_formats/express/generated/` are
generated from the specification grammar at `specification/inference_formats/express/Express.g4`.
The generated files are checked in, so building, testing, and using this package never runs the
generator. Regenerate them only when the grammar changes.

The generator is [antlr-ng](https://www.antlr-ng.org/introduction.html), a TypeScript port of the
ANTLR 4.13.2 tool published on npm. It is a devDependency of this package, so `yarn install` is
all the setup needed, with no Java. Its generated code targets the
[`antlr4ng`](https://www.npmjs.com/package/antlr4ng) runtime, which is a runtime dependency. Both
are pinned to exact versions, because `antlr-ng` pins the `antlr4ng` version it generates for.

From the repository root, run:

```sh
yarn workspace @a2ui/agent generate:express
```

This runs
`antlr-ng -Dlanguage=TypeScript --generate-visitor --generate-listener false -o src/inference_formats/express/generated ../../specification/inference_formats/express/Express.g4`,
matching the Python SDK's options (a visitor and no listener).

The Python SDK generates its parser with the official ANTLR 4.13.2 Java tool. The two SDKs parse
identically because their serialized ATNs, the tables that drive every lexing and parsing
decision, are identical. `tests/unit/inference_formats/express/generated_parser.test.ts` compares
both ATNs against Python's checked-in parser and fails if either SDK is regenerated from a
different grammar. When the grammar changes, regenerate both SDKs in the same change.

The generated directory is excluded from ESLint and Prettier, so a regeneration diff shows only
real grammar changes. When the grammar adds a parser rule, add a matching visitor override in
both SDKs.

## Temporary shims

| Symbol                              | Stands in for                            | Why                                                                                                                          | Remove when                                     |
| :---------------------------------- | :--------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------- |
| `A2uiCatalogError`                  | `@a2ui/web_core/errors#A2uiCatalogError` | Specified in `a2ui_core.blueprint.md` but not yet exported by `web_core`.                                                    | Exported from `@a2ui/web_core/errors`.          |
| `RemoveStrictValidationTransformer` | a `web_core` catalog schema modifier     | The conformance suite declares a `remove_strict_validation` modifier, but `web_core` exposes no common schema modifiers yet. | `web_core` exports an equivalent transformer.   |
| `MessageProcessor` type cast        | A generic parameter constraint relaxer   | `MessageProcessor` implicitly requires `Catalog<any, FunctionImplementation>` even without an action handler.                | `MessageProcessor` relaxes its type constraint. |

Defined in `tests/conformance/fixtures.ts` rather than `src/`, so the shim audit covers both
`src/` and `tests/`.

## Known limitations

- **Missing basic catalog instructions:** The v1.0 basic catalog specification JSON carries a substantial `instructions` string ("For layout, use the Row..."), but there is currently no programmatic equivalent in `BASIC_COMPONENTS` or `BASIC_FUNCTION_APIS`. Consequently, `basicCatalog()` passes `undefined` for instructions. Because prompt quality relies on these instructions, an agent must manually supply the equivalent guidance in its own preamble until they become available programmatically. (See design doc section 1).
