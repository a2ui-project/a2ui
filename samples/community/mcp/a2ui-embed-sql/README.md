# A2UI embed SQL sample (internal)

> [!WARNING]
> Internal proof of concept for end-to-end testing of `@a2ui/embed`. It is not
> published and not meant to be merged upstream.

A read-only SQL MCP server whose tool results render as A2UI v1.0 inside MCP
Apps through `@a2ui/embed`. It answers questions about the
[Chinook](https://github.com/lerocha/chinook-database) sample database (a
digital music store).

This package currently holds the data layer: read-only `node:sqlite` access
with a SQL guard, a read-only authorizer, a row cap and a per-query timeout in
a worker thread.

## Run the tests

```sh
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
