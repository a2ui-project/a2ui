# @a2ui/agent

A2UI Agent SDK for TypeScript and Node.js.

This package targets the A2UI protocol **v1.0** only, and currently supports the **Direct JSON** inference format.

## Temporary shims

| Symbol             | Stands in for                            | Why                                                                       | Remove when                            |
| :----------------- | :--------------------------------------- | :------------------------------------------------------------------------ | :------------------------------------- |
| `A2uiCatalogError` | `@a2ui/web_core/errors#A2uiCatalogError` | Specified in `a2ui_core.blueprint.md` but not yet exported by `web_core`. | Exported from `@a2ui/web_core/errors`. |

## Known limitations

- **Missing basic catalog instructions:** The v1.0 basic catalog specification JSON carries a substantial `instructions` string ("For layout, use the Row..."), but there is currently no programmatic equivalent in `BASIC_COMPONENTS` or `BASIC_FUNCTION_APIS`. Consequently, `basicCatalog()` passes `undefined` for instructions. Because prompt quality relies on these instructions, an agent must manually supply the equivalent guidance in its own preamble until they become available programmatically. (See design doc section 1).
