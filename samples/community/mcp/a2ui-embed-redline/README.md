# Redline Negotiator (`@a2ui/embed` Prototype)

An MCP server built with [`@a2ui/embed`](../../../../typescript/embed) that renders lease, contractor quote, and freelance agreement redlines in a 100% custom A2UI v1.0 catalog (`https://a2ui.org/samples/redline_studio/v1/catalog.json`, with zero `basicCatalog` components).

## Custom catalog

1. `NegotiationBoard` and `TwoUpRow` provide the header summary shell, status banner, and two-column gauge/benchmark layout.
2. `ClauseRedline` renders inline tracked-change diffs (`Theirs` struck through vs `★ Counter` or `Fallback`), writes `/stances/<clauseId>` on pill clicks, and slots an optional `evidenceChild`.
3. `BenchmarkBullet` draws an inline SVG range bar comparing counterparty rates or deposits against local and market norms.
4. `ExposureMeter` and `LeverageGauge` bind to `@call: negotiationMetrics(/clauses, /stances)` so dollar downside and deal-friction odds update immediately in the browser without server round-trips.
5. `MilestoneScheduleBar` compares front-loaded quotes against inspection-gated milestone schedules.
6. `CounterLetterPreview` binds to `@call: composeCounterEmail(/docTitle, /clauses, /stances, /tone)` with `Collaborative` and `Firm` tone pills, dispatching `finalize_counter`, `reset_picks`, and the `ask_clause_strategy` follow-up.

## Build and test

From the repository root, build `@a2ui/web_core`, `@a2ui/markdown-it`, `@a2ui/lit`, and `@a2ui/embed`, install `samples/community`, then run:

```bash
cd samples/community/mcp/a2ui-embed-redline
yarn build
yarn test
yarn e2e
```
