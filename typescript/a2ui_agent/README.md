# @a2ui/agent

A2UI Agent SDK for TypeScript and Node.js.

This package targets the A2UI protocol **v0.9** and **v1.0**, and currently supports the **Direct JSON** inference format.

## Temporary shims

| Symbol                              | Stands in for                          | Why                                                                                                                          | Remove when                                     |
| :---------------------------------- | :------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------- |
| `RemoveStrictValidationTransformer` | a `web_core` catalog schema modifier   | The conformance suite declares a `remove_strict_validation` modifier, but `web_core` exposes no common schema modifiers yet. | `web_core` exports an equivalent transformer.   |
| `MessageProcessor` type cast        | A generic parameter constraint relaxer | `MessageProcessor` implicitly requires `Catalog<any, FunctionImplementation>` even without an action handler.                | `MessageProcessor` relaxes its type constraint. |

Defined in `tests/conformance/fixtures.ts` rather than `src/`, so the shim audit covers both
`src/` and `tests/`.

## Known limitations

- The SDK bundles no catalog, not even the basic one. Load catalog documents with `FileSystemCatalogProvider` or `CatalogConfig.fromPath`. The v0.9 basic catalog document states neither a `catalogId` nor a `protocolVersion`, so pass both when you load it: `'v0.9'` and `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`.
- Direct JSON parsing works on complete responses only. `DirectJsonParser.supportsStreaming` is false and `parseChunk` throws.
