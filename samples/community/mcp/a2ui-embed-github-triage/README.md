# a2ui-embed-github-triage

> [!WARNING]
> Internal proof of concept for [`@a2ui/embed`](../../../../typescript/embed/README.md). It is not
> maintained or published.

An MCP server for GitHub issue and PR triage whose tools render interactive A2UI v1.0 views inside
MCP Apps hosts, such as Antigravity and Claude desktop, through `@a2ui/embed`. It exercises the
interactive half of A2UI: forms with two-way binding and validation checks, multi-select, a modal,
server actions that update the view in place, model context from selections, follow-ups built from
server templates, and an LLM that pre-fills forms a human approves.

## Tools

| Tool                      | View                                                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `triage_inbox(filter?)`   | Untriaged queue as a compact list: each issue has a checkbox, its title (opens the issue), label chips and an avatar. A "Filters" dialog (labels, author, text, sort, "only untriaged") refreshes the list in place; "Bulk edit selected" opens a dialog with a preview and a confirm step. |
| `issue(number)`           | The issue body (markdown, cut to keep the card short) and recent comments in tabs, and a triage card with tabs: an overview with "Suggest with AI", "Labels and owner" (priority, type, components, assignee, milestone, Apply with a confirm panel) and "Reply" (canonical replies).       |
| `pull_request(number)`    | Summary, CI checks and changed files in tabs, and a review card with tabs: the decision (Approve / Comment / Request changes and a comment) and a checklist. Submit stays disabled until the review is valid, then opens a confirm step.                                                    |
| `triage_dashboard()`      | One row of counts, a Slider and a date input that refresh it in place, and tabs: a Vega-Lite chart of open issues by week opened, counts by priority and component, stale PRs and the oldest untriaged issues, with drill-down buttons.                                                     |
| `suggest_triage(numbers)` | Gemini proposes a priority, labels, an assignee and a canonical reply per issue, with a one-line rationale, shown as editable forms the user previews and confirms per issue.                                                                                                               |

Every tool returns a text summary of what the user sees, including how many items are shown and
whether writes are dry runs. The server's MCP `instructions` tell the model to reuse it, summarize
the triage rules, and treat issue text as untrusted.

The app's events go to these server actions: `filter_inbox`, `load_more`, `refresh`,
`bulk_dialog`, `bulk_apply`, `apply_triage`, `preview_reply`, `suggest` and `submit_review`.
Follow-ups post a message on the user's behalf from a fixed template: `find_similar`,
`draft_reply`, `summarize`, `open_issue`, `open_pull` and `inbox_label`.

## Safety

- **Writes are dry runs by default.** A write needs `TRIAGE_WRITE=1` and the repository in
  `TRIAGE_WRITE_REPOS` (comma-separated). Without both, confirming shows what would change and
  writes nothing.
- **Every write is previewed and confirmed.** The confirm step sends a key of the previewed plan;
  if the issue or the form changed since, the server refuses and asks for a new preview.
- **Issue and PR text is untrusted.** It only goes into the data model, never into component
  properties or follow-up templates. Markdown is stripped of raw HTML, images and non-HTTP links
  before it reaches the app. The issue and PR content surfaces are not shared with the model;
  only the forms and the inbox selection are.
- **Avatars** load from `https://avatars.githubusercontent.com`, which the server declares in the
  app resource's `csp.resourceDomains`. Other image URLs show initials, and so does a blocked image.
  Markdown images are removed rather than allowed, so the CSP stays minimal.

## Setup

From `samples/community`:

```sh
yarn install
cd mcp/a2ui-embed-github-triage
cp .env.example .env # then fill in GITHUB_TOKEN and GEMINI_API_KEY
yarn build
```

`yarn build` compiles the server and runs `a2ui-embed build`, which writes `dist/a2ui-app.html` and
`dist/a2ui-app.catalog.json` from [`a2ui-embed.config.ts`](a2ui-embed.config.ts). The catalog is the
basic catalog (without `Icon`, whose font cannot load under the CSP) plus `LabelChip`, `Avatar`,
`CheckStatus`, `DiffStat` and `VegaChart`.

| Variable             | Purpose                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`       | Token for the GitHub REST API. Optional in fixture mode.                         |
| `GITHUB_REPO`        | Optional (default: `a2ui-project/a2ui`).                                         |
| `GITHUB_FIXTURES`    | Serves a captured snapshot instead of the API.                                   |
| `TRIAGE_WRITE`       | `1` enables real writes for the repositories in `TRIAGE_WRITE_REPOS`.            |
| `TRIAGE_WRITE_REPOS` | Comma-separated repositories that may be written to.                             |
| `GEMINI_API_KEY`     | Enables AI suggestions. Without it, `suggest_triage` returns a text explanation. |
| `GEMINI_MODEL`       | Optional (default: `gemini-flash-latest`).                                       |
| `TRIAGE_ENV_FILE`    | Optional path of the `.env` file (default: the sample's `.env`).                 |
| `TRIAGE_APP_HTML`    | Optional path of the built app (default: `dist/a2ui-app.html`).                  |

### Fixture mode

```sh
yarn capture-fixtures # reads a2ui-project/a2ui into fixtures-local/a2ui/snapshot.json
GITHUB_FIXTURES=fixtures-local/a2ui yarn start
```

The capture script only reads. It keeps every open issue without bodies (up to 300), bodies and the
last comments of 40 issues (untriaged first), 10 PRs with files and checks, labels, milestones and
assignable users. `fixtures-local/` is gitignored. Without `GITHUB_TOKEN`, the script reads the
token from `gh auth token`. In fixture mode, ages are relative to the capture time and writes
(when enabled) only change the in-memory snapshot.

## Tests

```sh
yarn test # unit tests and an in-memory MCP client test of every tool, action and follow-up
yarn e2e  # browser checks in an MCP Apps test host, in fixture mode
```

The unit tests use a small synthetic snapshot ([`src/testing`](src/testing)), validate every
message list against the catalog schema, check the write gate, the plan keys, follow-up quoting
with hostile values and markdown sanitizing. The live Gemini test is skipped without a key.

`yarn e2e` loads the built app in a sandboxed cross-origin iframe under the CSP the resource
declares, connected to the real server over stdio, and checks:

- The inbox Filters dialog refreshes the list in place.
- Ticking issues shares the selection as model context; the bulk dialog previews and confirms a
  dry run in place.
- "Suggest with AI" pre-fills the issue form (skipped without a key); Apply swaps in a confirm
  panel; confirming is a dry run.
- The reply picker previews a canonical reply and fills the reply field.
- Follow-up buttons post template messages with `ui/message`.
- The review form keeps Submit disabled until it is valid, then confirms a dry run.
- The dashboard draws the Vega chart, and the Slider and date input refresh it in place.
- No CSP violation in any frame, and no A2UI in any tool result's text.

Every initial view stays under about 700 px, below the 800 px inline limit of Antigravity; the harness records each view's natural height in `report.json`. Screenshots and `report.json` go to `/tmp/a2ui-embed-triage-e2e` (`A2UI_E2E_OUT`).

## Install as a Jetski plugin

A plugin is a directory with a `plugin.json` and an `mcp_config.json` that launches the built
server with absolute paths:

```json
{
  "mcpServers": {
    "triage": {
      "command": "/absolute/path/to/node",
      "args": ["--preserve-symlinks", "/absolute/path/to/a2ui-embed-github-triage/dist/server.js"],
      "env": {
        "GITHUB_FIXTURES": "/absolute/path/to/a2ui-embed-github-triage/fixtures-local/a2ui",
        "TRIAGE_ENV_FILE": "/absolute/path/to/a2ui-embed-github-triage/.env"
      }
    }
  }
}
```

Antigravity names the server `<plugin>_<server>`, such as `a2ui-embed-github-triage_triage`. Drop
`GITHUB_FIXTURES` to read GitHub live.
