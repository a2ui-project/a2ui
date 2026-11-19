# A2UI embed SQL sample (internal)

> [!WARNING]
> Internal proof of concept for end-to-end testing of `@a2ui/embed`. It is not
> published and not meant to be merged upstream.

A read-only SQL MCP server whose tool results render as A2UI v1.0 inside MCP
Apps through `@a2ui/embed`. It answers questions about the
[Chinook](https://github.com/lerocha/chinook-database) sample database (a
digital music store) with KPI cards, charts and sortable tables, and returns a
text summary the host model can use for follow-up questions.

The MCP App plumbing (the `ui://` resource, the `a2ui_action` tool, validation
and the single-file HTML build) comes from `@a2ui/embed`:
[`src/app.ts`](src/app.ts) registers the tools with `createA2uiApp`, and
[`a2ui-embed.config.ts`](a2ui-embed.config.ts) builds the app with the sample
catalog.

## Tools

| Tool                                 | What it does                                                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_tables()`                      | Schema browser: tables with row counts and columns, as two sortable tables in tabs.                                                                               |
| `query(sql, visualization?, title?)` | Runs one read-only `SELECT`/`WITH` statement (at most 500 rows, 5 s) and picks the view from the result's shape.                                                  |
| `explain(question)`                  | Gemini writes the SQL, the server runs it, and Gemini designs the layout from the catalog. Invalid layouts fall back to the `query` view. Needs `GEMINI_API_KEY`. |

Every view has a **Refresh** button (`refresh` action, updates the view in
place). KPI and chart views also get **Break down by …** buttons (`breakdown`
follow-up), which post a message built from the server template `Break down
{metric} by {dimension}`, such as `Break down "revenue" by "MediaType.Name"`.
The dimensions are text columns of the tables the query mentions and of the
tables those reach through foreign keys (up to two hops), so revenue by genre
offers media type, artist and billing country. Lookup tables (a key and a name,
such as `Artist`) come first.

Each result's text summary lists the row and column counts, totals, the first
rows, how the view presents them, and how many rows the view shows when it
leaves some out ("The view shows the first 28 of 500 rows."). The server's MCP
`instructions` tell the model to reuse these summaries for follow-up questions,
to prefer `query`, and that app context attached to a user message is the row
the user selected.

Failing or non-read-only SQL makes the tool return an error result with the
SQLite or guard message as text, and no view.

Selecting a table row (click, or Enter or Space on a focused row) writes the
row to `/selected` in the surface's data model. The surfaces are created with
`sendDataModel: true`, so the app shares the data model with the host model
(`ui/update-model-context`) and the model can answer questions about the
selected row. A view keeps the leading rows that fit in 5 KiB of JSON (the
footer says "Showing N of M rows"), so the shared data model stays under the
16 KiB limit of `@a2ui/embed`; above that limit the library would leave the data
model out and name its size instead.

View rules for `query`:

- One row whose columns are all numbers (up to four): KPI cards.
- A label column followed by numeric columns, with at least two rows: a chart
  and a table in tabs. A date-like label gives a line chart, anything else a bar
  chart.
- Anything else: a table.

The `visualization` hint (`auto`, `table`, `bar`, `line`, `kpi`) wins when the
result's shape supports it.

## Catalog

[`src/catalog`](src/catalog) defines the sample catalog
(`https://a2ui.org/samples/community/mcp/a2ui-embed-sql/catalog.json`): the
basic catalog, a `DataTable` Lit component (sortable by clicking a header,
client-side, with row selection when its `selected` property is bound), and the
`VegaChart` from `@a2ui/catalog-vegachart`, which renders with Vega's CSP-safe
interpreter. Charts read the same `/rows` as the table through the catalog's
`withRows` function (`{"@call": "withRows", "args": {"spec": {"@path":
"/chart"}, "rows": {"@path": "/rows"}}}`), so the data model, and the model
context, holds the rows once; the spec carries neutral axis and grid colors that
read on light and dark hosts. Number columns are formatted with the locale's
grouping and two decimals when any value has decimals; sorting uses the raw
values. The views never use `Icon`: its icon font cannot load under the MCP
Apps CSP, and `explain` rejects layouts that use it.

`yarn build` writes the app to `dist/a2ui-app.html` and its schema to
`dist/a2ui-app.catalog.json`, which the server validates every result against.
`src/catalog/catalog_schema.json` is the same schema, generated by the tests;
`explain` uses it to describe the components to Gemini.

## Build

The sample uses the monorepo's `@a2ui/embed`, `@a2ui/lit`, `@a2ui/web_core` and
`@a2ui/catalog-vegachart` through `portal:` dependencies, so build them first:

```sh
# From the repository root
yarn install
yarn workspace @a2ui/embed run build
yarn workspace @a2ui/catalog-vegachart run build

# From samples/community
yarn install
cd mcp/a2ui-embed-sql
yarn fetch-data   # downloads Chinook into data/ (gitignored)
yarn build        # tsc, then a2ui-embed build (dist/a2ui-app.html, about 1.7 MiB)
```

The community root's `resolutions` link `lit` to the repository root's copy for
the sample and its portal packages, so the app bundle has a single Lit. The
server runs with `node --preserve-symlinks` (`yarn start`), so `@a2ui/embed`
and the sample share one copy of the MCP SDK; `tsconfig.json` sets
`preserveSymlinks` for the same reason.

Server environment:

| Variable              | Default               | Purpose                                                    |
| --------------------- | --------------------- | ---------------------------------------------------------- |
| `SQL_SAMPLE_DB`       | `data/chinook.sqlite` | SQLite file to serve.                                      |
| `SQL_SAMPLE_ENV_FILE` | `.env`                | File with `GEMINI_API_KEY` and `GEMINI_MODEL` for explain. |
| `A2UI_EMBED_SQL_HTML` | `dist/a2ui-app.html`  | App HTML, re-read on every resource read.                  |

The catalog schema is read from next to the app HTML
(`a2ui-app.catalog.json`).

## Run the tests

```sh
yarn test
```

Tests that need Chinook or the built app are skipped until `yarn fetch-data`
and `yarn build` have run. `src/app.test.ts` drives the real MCP server through
an in-memory MCP client. The live Gemini test runs only when `GEMINI_API_KEY` is
set; copy `.env.example` to `.env` to set it. After changing the catalog, run
`yarn generate:schema`.

## Run the end-to-end harness

```sh
yarn build
yarn e2e
```

[`scripts/e2e.mjs`](scripts/e2e.mjs) launches the server over stdio with an MCP
client, serves the app resource from one origin with the default MCP Apps CSP
header, and opens a host page from another origin
([`scripts/e2e/host.js`](scripts/e2e/host.js)) in headless Chromium. The host
uses the App SDK's `AppBridge`, loads each tool result into a sandboxed iframe
(`allow-scripts` only), forwards the app's `tools/call` requests to the server,
and records `ui/message`, `ui/update-model-context` and size changes. It checks:

- `list_tables` renders the schema browser.
- A grouped query renders chart and table tabs, and the Vega chart is an SVG.
- Clicking a header sorts the table.
- Selecting a row (click and keyboard) sends the row in the model context.
- Refresh calls `a2ui_action` and updates the same surface element.
- A "Break down by" button posts the templated, quoted message.
- A single number renders a KPI card.
- `explain` renders a view (skipped without `GEMINI_API_KEY`).
- No CSP violation in any frame, and no A2UI in any tool result's text.

Screenshots and `report.json` (with result sizes and frame heights) go to
`/tmp/a2ui-embed-sql-e2e` (`A2UI_E2E_OUT`). Set `A2UI_E2E_CHROME` to use another
Chrome executable.

## Install as a Jetski plugin

A plugin is a directory with a `plugin.json` and an `mcp_config.json` that
launches the built server with absolute paths, since the host's `PATH` may not
have `node`:

```json
{
  "mcpServers": {
    "sql": {
      "command": "/absolute/path/to/node",
      "args": ["--preserve-symlinks", "/absolute/path/to/a2ui-embed-sql/dist/server.js"],
      "env": {
        "SQL_SAMPLE_DB": "/absolute/path/to/a2ui-embed-sql/data/chinook.sqlite",
        "SQL_SAMPLE_ENV_FILE": "/absolute/path/to/a2ui-embed-sql/.env"
      }
    }
  }
}
```

Put the directory (for example `a2ui-embed-sql/`) under
`~/.gemini/config/plugins/`, or pass its parent directory to a test hub with
`--plugin-dir`. Antigravity names the server `<plugin>_<server>`, here
`a2ui-embed-sql_sql`. Rebuilding `dist/a2ui-app.html` takes effect the next time
a view opens; server code changes need a server restart from the MCP Servers
settings.

## Data license

Chinook is distributed under an MIT-style license, Copyright (c) 2008-2024 Luis
Rocha. `yarn fetch-data` downloads release `v1.4.5`
(`Chinook_Sqlite.sqlite`); the database is never committed.
