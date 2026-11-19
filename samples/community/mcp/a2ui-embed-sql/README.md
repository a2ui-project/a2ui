# A2UI embed SQL sample (internal)

> [!WARNING]
> Internal proof of concept for end-to-end testing of `@a2ui/embed`. It is not
> published and not meant to be merged upstream.

A read-only SQL MCP server whose tool results render as A2UI v1.0 inside MCP
Apps through `@a2ui/embed`. It answers questions about the
[Chinook](https://github.com/lerocha/chinook-database) sample database (a
digital music store).

This package currently holds:

- The data layer: read-only `node:sqlite` access with a SQL guard, a read-only
  authorizer, a row cap and a per-query timeout in a worker thread.
- The sample catalog (`src/catalog`): the basic catalog, a sortable and
  selectable `DataTable` Lit component, the `VegaChart` from
  `@a2ui/catalog-vegachart`, and a `withRows` function that feeds a chart the
  table's rows. `src/catalog/catalog_schema.json` is its generated JSON schema;
  run `yarn generate:schema` after changing the catalog.
- The domain layer (`src/compose`, `src/explain`, `src/sql_tools.ts`): view
  composition from a result's shape (KPI cards, chart and table tabs, or a
  table), the schema browser, text summaries for the model, Refresh and
  "Break down by …" events with dimensions found through foreign keys, and
  `explain`, where Gemini writes the SQL and designs a layout that is validated
  before use, with the default layout as fallback. `explain` reads
  `GEMINI_API_KEY` from the environment; copy `.env.example` to `.env`.

## Run the tests

The catalog uses the monorepo's `@a2ui/web_core` and `@a2ui/catalog-vegachart`
through `portal:` dependencies, so build them first:

```sh
# From the repository root
yarn install
yarn workspace @a2ui/catalog-vegachart run build

# From samples/community
yarn install
cd mcp/a2ui-embed-sql
yarn fetch-data   # downloads Chinook into data/ (gitignored)
yarn test
```

Tests that need Chinook are skipped until `yarn fetch-data` has run.

## Data license

Chinook is distributed under an MIT-style license, Copyright (c) 2008-2024 Luis
Rocha. `yarn fetch-data` downloads release `v1.4.5`
(`Chinook_Sqlite.sqlite`); the database is never committed.
