# A2UI over MCP Demo - Filesystem Browser

A file browser with no agent, no A2UI server, and no client code that knows
anything about files. The UI is a static A2UI JSON payload, the data comes from
the reference
[filesystem MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem),
and the A2UI MCP catalog is the only thing between them.

![The sample reading a file from the local filesystem](screenshot.png)

## What this sample shows

An A2UI mini-app can ship real functionality to a host that already speaks MCP.
This one demonstrates three things:

- **The payload drives the tools.** Every button in
  [a2ui_filesystem.json](a2ui_filesystem.json) is a chain of catalog function
  calls with `callMcpTool` at its centre. Clicking a row runs no application
  code.
- **A server that never heard of A2UI still renders.** The filesystem server
  answers in plain text. The payload splits that text, captures fields out of
  each line with a regular expression, shapes the result with JMESPath, and
  writes it into the data model.
- **The host is scaffolding only.** [client/app.ts](client/app.ts) connects one
  MCP client, hands the payload to the renderer, and runs the action the payload
  names as its first. It contains no filesystem logic and no UI.

## Run it

Run these commands from `samples/community`:

```bash
yarn install
yarn workspace a2ui-over-mcp-filesystem run dev
```

Open http://localhost:5174. The page opens on your home directory. Click a
directory row to list it, click a file row to read it, or run a `search_files`
glob below the current directory.

One command starts both halves of the demo:

- `mcp-proxy` runs `@modelcontextprotocol/server-filesystem` over `~` and
  relays it over Streamable HTTP on `127.0.0.1:8787`.
- Vite serves the page on port 5174 and proxies `/mcp` to the relay, so the
  page and the MCP server share one origin.

WARNING: While the demo runs, `127.0.0.1:8787` serves every filesystem tool,
including `write_file`, `edit_file`, and `move_file`, with
`Access-Control-Allow-Origin: *`. Any page open in your browser can reach it.
The filesystem server has no read-only mode: its `readOnlyHint` annotations are
advisory, and its only real boundary is the directory on its command line. Stop
the demo when you are done with it.

### Browse somewhere else

Set `A2UI_FS_ROOT` to the directory the server may read:

```bash
A2UI_FS_ROOT="$HOME/Documents" yarn workspace a2ui-over-mcp-filesystem run dev
```

The server refuses any path outside that root. It expands a leading `~`
itself, which is why the default needs no shell expansion.

## How it works

```text
browser                                  node
+-----------------------------+          +--------------------------------+
| a2ui_filesystem.json        |          | vite            (port 5174)    |
|   updateDataModel(jmespath( |  /mcp    |   proxy /mcp -> 127.0.0.1:8787 |
|     regexCapture(split(     | <------> | mcp-proxy       (port 8787)    |
|       callMcpTool(...)))))  |          |   | stdio                      |
| @a2ui/mcp-catalog           |          |   v                            |
| client/app.ts (scaffolding) |          | server-filesystem (npx)        |
+-----------------------------+          +--------------------------------+
```

Every button runs the same chain, read inside out:

1. `callMcpTool` runs the tool and returns its result unchanged.
2. `jmespath` joins the text blocks of that result into one string.
3. `split` cuts the string into lines.
4. `regexCapture` applies one RE2 pattern to every line, giving an array of
   capture groups per line and `null` for a line that does not match.
5. `jmespath` shapes those rows into an object of data model paths.
6. `updateDataModel` writes each path into the surface.

Steps 3 and 4 are where the loop would be. Both functions apply element by
element when handed an array, and JMESPath has no loop of its own.

A directory listing lands at `/entries`, and the row template turns each entry
into a button whose tool name comes from the entry itself: a directory calls
`list_directory_with_sizes`, a file calls `read_text_file`.

The payload also declares its own first call, under `/startup`. Each element is
a complete `{call, args}` action, which the host runs with
`context.resolveDynamicValue(action)`, so even the opening screen is the
payload's decision.

The proxy exists because the filesystem server speaks JSON-RPC over stdio,
which a page cannot open. `mcp-proxy` runs it as a child process and relays it
over Streamable HTTP. One child process serves every browser session.

## What the data model holds

The payload keeps its whole state in the surface data model:

| Path                            | Holds                                                                                                       |
| :------------------------------ | :---------------------------------------------------------------------------------------------------------- |
| `/dir`                          | The directory being browsed. The Directory field binds to it, so typing in the field retargets the buttons. |
| `/row_base`                     | What a row's `name` needs in front of it to become a path.                                                  |
| `/search_pattern`               | The glob the search field holds.                                                                            |
| `/entries`                      | One object per row, rendered by the `entry_row` template.                                                   |
| `/entries_title`                | The heading above the list.                                                                                 |
| `/viewer_title`, `/viewer_body` | The right pane, which shows a file as fenced Markdown.                                                      |
| `/expr`                         | The three JMESPath expressions, named `list`, `read`, and `search`.                                         |
| `/startup`                      | The actions the host runs once the surface exists.                                                          |

A listing sets `/row_base` to `/dir` plus a slash. A search sets it to the empty
string, because `search_files` already answers with absolute paths.

Each row of `/entries` carries everything its button needs:

| Field     | Holds                                                                                 |
| :-------- | :------------------------------------------------------------------------------------ |
| `name`    | The text on the row button, and the last segment of the path it opens.                |
| `size`    | The caption to the right of the name, empty for a directory.                          |
| `icon`    | `folder` or `attachFile`.                                                             |
| `tool`    | The MCP tool the row calls.                                                           |
| `expr`    | A binding to the expression that reshapes the response, `/expr/list` or `/expr/read`. |
| `pattern` | The RE2 pattern that parses the response, which differs per row.                      |

A row carries neither a path nor an arguments object. A JMESPath projection
cannot see the directory sitting at the top of the document, so the expression
that builds the rows cannot join it to each name. The row button builds both in
the component instead, as the next section shows.

## Building a tool argument

`DataContext.resolveDynamicValue` reads any object holding a `path` key as a
data binding, and `list_directory_with_sizes` takes an argument named `path`.
Writing that argument inline would bind to the data model instead of calling the
tool, so the payload builds the object with an expression:

```json
{
  "call": "callMcpTool",
  "args": {
    "name": "list_directory_with_sizes",
    "arguments": {"call": "jmespath", "args": {"expression": "{path: @}", "data": "~"}}
  }
}
```

The search button builds a two-key object the same way, from two bindings:

```json
{
  "call": "jmespath",
  "args": {
    "expression": "{path: dir, pattern: pattern}",
    "data": {"dir": {"path": "/dir"}, "pattern": {"path": "/search_pattern"}}
  }
}
```

A row button has a harder job, because the path it opens is `/row_base` joined
to the row's own `name`, and a JMESPath projection cannot see a value at the top
of the document. The payload solves it in the component rather than in the
expression: a template row can read an absolute path, so `formatString` joins
the two.

```json
{"call": "formatString", "args": {"value": "${/row_base}${name}"}}
```

The Parent button needs no tool to compute its target either. It strips the last
segment off `/dir` with a regular expression:

```json
{
  "call": "regexReplace",
  "args": {"value": {"path": "/dir"}, "pattern": "/[^/]+$", "replacement": ""}
}
```

## The expressions

This sample keeps its three expressions in the data model under `/expr`, so a
control, or a row, can name one by path. A row names its own: the row button
passes `{"path": "expr"}` as the expression, which resolves to the binding the
row holds, which resolves to the expression text.

The expressions are plain [JMESPath](https://jmespath.org), the original
specification with no extensions, so they would run on a stock JMESPath library
in any language. All the string work happens in the catalog functions that run
before them.

Here is `/expr/list` in full. Its input is the `{dir, nl, rows}` document the
button assembles, where `rows` is one array of capture groups per matched line:

```
{dir: dir, rows: rows[?@ != null]} | {
  "/dir": dir,
  "/row_base": join('', [dir, '/']),
  "/entries": rows[*].{
    name: [1],
    size: [2] || '',
    icon: ([0] == 'DIR' && 'folder') || 'attachFile',
    tool: ([0] == 'DIR' && 'list_directory_with_sizes') || 'read_text_file',
    expr: {path: ([0] == 'DIR' && '/expr/list') || '/expr/read'},
    pattern: ([0] == 'DIR' && '^\[(DIR|FILE)\]\s+([^.].*?)(?:\s\s+([0-9.]+ [A-Za-z]+))?\s*$') || '^(.*)$'
  },
  "/entries_title": join('', [
    to_string(length(rows)),
    (length(rows) == `1` && ' entry') || ' entries'
  ]),
  "/viewer_title": (dir == '~' && 'Home Directory (~)') || dir,
  "/viewer_body": 'Choose a file on the left to read it.'
}
```

Four things in it are worth reading twice:

- **The filter does the cleanup.** `regexCapture` returns `null` for a line the
  pattern misses, so `rows[?@ != null]` drops the blank line, the `Total:`
  footer, and every dotfile in one step. Dotfiles are excluded by the `[^.]` in
  the pattern rather than by a second filter.
- **A row is indexed, not named.** Each element of `rows` is the capture group
  array of one line, so `[0]` is `DIR` or `FILE`, `[1]` is the name, and `[2]`
  is the size.
- **There is no ternary.** A conditional is written `(cond && a) || b`.
- **There are no `let` bindings.** A pipe into a multi-select hash names the
  intermediate values instead, which is what the leading
  `{dir: dir, rows: rows[?@ != null]}` stage does.

One more absence shows up in the button rather than the expression: a JMESPath
raw string cannot hold a newline, since `'\n'` is a backslash and an `n`. Each
button passes a real newline in as data under the key `nl`, and the expression
reads it by name in `join(nl, result.content[?type == 'text'].text)`.

Parsing `[DIR] name  size` lines into row objects is the whole adapter, and it
ships with the UI rather than with the client.

## Files

| File                                           | Purpose                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [a2ui_filesystem.json](a2ui_filesystem.json)   | The A2UI payload: the UI, every tool call, and every expression.   |
| [client/app.ts](client/app.ts)                 | The host: connects to MCP, processes the payload, runs `/startup`. |
| [client/vite.config.ts](client/vite.config.ts) | Dev server, the `/mcp` proxy, and catalog resolution.              |
| [package.json](package.json)                   | `yarn dev`: the MCP relay and the web server, side by side.        |

## Test and build

Run these commands from `samples/community`:

```bash
yarn workspace a2ui-over-mcp-filesystem run test
yarn workspace a2ui-over-mcp-filesystem run build
```

The tests mock the MCP server with responses captured from a real one. They
cover the payload validating against the catalog it names, the startup call, and
each expression turning server text into the data model.
