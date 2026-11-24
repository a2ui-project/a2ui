<!--
 Copyright 2024 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
-->

# Space and Seating Planner (`a2ui-embed-canvas`)

`a2ui-embed-canvas` is a community prototype MCP server that renders an interactive 2D spatial floorplan and banquet seating planner inside MCP Apps using [`@a2ui/embed`](../../../../typescript/embed). It uses a 100% custom component catalog (`https://a2ui.org/samples/canvas_studio/v1/catalog.json`) with zero basic catalog components and zero external network requests.

## Custom catalog

1. `PlannerFrame` ([`src/catalog/planner_frame.ts`](src/catalog/planner_frame.ts)) renders the card header, live constraint score badge, body children, and an optional `footer` slot.
2. `CanvasSplit` ([`src/catalog/canvas_split.ts`](src/catalog/canvas_split.ts)) arranges workspace panes in a responsive two-column grid (`canvas_wide` or `balanced`).
3. `PlanCanvas` ([`src/catalog/plan_canvas.ts`](src/catalog/plan_canvas.ts)) renders a direct-manipulation 2D SVG stage supporting `floorplan` mode (scaled room walls, door-swing sector, daylight cone, clearance halos, pointer drag, nudge, and 90-degree rotation) and `seating` mode (round banquet tables, click-or-drag guest seat swaps, table rotation, and curved social affinity or conflict arcs).
4. `RuleScoreboard` ([`src/catalog/rule_scoreboard.ts`](src/catalog/rule_scoreboard.ts)) displays live green, amber, and red constraint pills bound to `evaluatePlan`.
5. `PieceTray` ([`src/catalog/piece_tray.ts`](src/catalog/piece_tray.ts)) renders scale-preview furniture and garden tokens that swap slot groups or toggle optional items into `/placements`.
6. `PresetStrip` ([`src/catalog/preset_strip.ts`](src/catalog/preset_strip.ts)) applies one-click layout presets client-side with zero server round-trips.
7. `SelectionInspector` ([`src/catalog/selection_inspector.ts`](src/catalog/selection_inspector.ts)) inspects dimensions, coordinates, or table assignments for `/selectedId` and supports an optional `extraChild` slot.
8. `PlanActionBar` ([`src/catalog/plan_action_bar.ts`](src/catalog/plan_action_bar.ts)) dispatches `save_layout` and `auto_resolve_conflicts` server actions and the `ask_ergonomics_or_hosts` chat follow-up.

The catalog also registers `evaluatePlan`, `inspectItem`, `selectedLabel`, and `scoreSummaryText` in [`src/catalog/functions.ts`](src/catalog/functions.ts) so every client-side drag, rotation, seat swap, preset click, or piece toggle updates constraint pills and inspector metrics immediately without a server round-trip.

## Scenario compositions

`space_planner` composes distinct component trees depending on the request:

1. `bedroom_office` pairs `PresetStrip` with `CanvasSplit` (`PlanCanvas` in floorplan mode alongside `SelectionInspector` with `PieceTray` slotted inside `extraChild`), `RuleScoreboard`, and `PlanActionBar`.
2. `dinner_seating` pairs `RuleScoreboard` and `PresetStrip` with a full-width `PlanCanvas` in seating mode and `PlanActionBar`, omitting `PieceTray`, `CanvasSplit`, and `SelectionInspector`.
3. `patio_garden` pairs `RuleScoreboard` with `CanvasSplit` (`PlanCanvas` and `SelectionInspector`), a top-level `PieceTray` strip, and `PlanActionBar`, omitting `PresetStrip`.

## Build and test

Run from the monorepo root after building `@a2ui/web_core`, `@a2ui/markdown-it`, `@a2ui/lit`, and `@a2ui/embed`:

```bash
cd samples/community && yarn install
cd mcp/a2ui-embed-canvas
yarn build
yarn test
yarn e2e
```

Environment overrides:

1. `CANVAS_APP_HTML` points the server at a custom `a2ui-app.html` path (with `.catalog.json` beside it).
2. `CANVAS_ENV_FILE` loads `KEY=value` pairs before startup.
