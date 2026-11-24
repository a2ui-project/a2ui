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

# Day and Trip Studio (`a2ui-embed-trip`)

`a2ui-embed-trip` is a community prototype MCP server that renders an interactive A2UI v1.0 travel planning studio inside MCP Apps using [`@a2ui/embed`](../../../../typescript/embed). It uses a 100% custom component catalog (`https://a2ui.org/samples/trip_studio/v1/catalog.json`) with zero basic catalog components and zero external network requests.

## Custom catalog

1. `StudioShell` (`src/catalog/studio_shell.ts`) renders the card header, live telemetry pills, body children, and an optional `footer` slot.
2. `SplitStage` (`src/catalog/split_stage.ts`) arranges panels in a responsive two-column grid (`balanced`, `wideLeft`, `wideRight`).
3. `WeatherRibbon` (`src/catalog/weather_ribbon.ts`) plots hourly temperature and precipitation risk with inline SVG icons.
4. `TimelineStrip` (`src/catalog/timeline_strip.ts`) renders open-hours bars, walking leg pills, overlap or hours warnings, `-15m` and `+15m` controls, and an optional `activeChild` slot inside the selected stop.
5. `RouteMinimap` (`src/catalog/route_minimap.ts`) draws a projected SVG neighborhood map with walking rings, route polylines, and clickable stop pins bound to `/selectedStopId`.
6. `SwapDeck` (`src/catalog/swap_deck.ts`) swaps either a stop in `/stops` or the basecamp hotel in `/hotel` client-side on click.
7. `BudgetSplitBar` (`src/catalog/budget_split_bar.ts`) renders stacked category spend (`stay`, `food`, `tickets`, `transit`) against a writable `/budgetCap`.
8. `ActionFooter` (`src/catalog/action_footer.ts`) dispatches `lock_itinerary` and `rain_reschedule` server actions and the `ask_local_spots` chat follow-up.

The catalog also registers `tripStats(stops, hotel, budgetCap)` and `selectedStopTitle(stops, selectedStopId)` in `src/catalog/functions.ts` so every client-side edit updates costs, walking legs, and schedule conflicts without a server round-trip.

## Scenario compositions

`trip_studio` composes distinct component trees depending on the request:

1. `afternoon_gap` pairs `WeatherRibbon` with `SplitStage` (`TimelineStrip` with `SwapDeck` slotted inside the selected stop, alongside `RouteMinimap`) and `ActionFooter`, omitting `BudgetSplitBar`.
2. `weekend_budget` pairs `BudgetSplitBar` and a top-level hotel `SwapDeck` with `SplitStage` (`RouteMinimap` and `TimelineStrip` without a child slot) and `ActionFooter`, omitting `WeatherRibbon`.
3. `rainy_family` composes `WeatherRibbon`, `BudgetSplitBar`, `SplitStage`, `TimelineStrip`, `SwapDeck`, `RouteMinimap`, and `ActionFooter` together.

## Build and test

Run from the monorepo root after building `@a2ui/web_core`, `@a2ui/markdown-it`, `@a2ui/lit`, and `@a2ui/embed`:

```bash
cd samples/community && yarn install
cd mcp/a2ui-embed-trip
yarn build
yarn test
yarn e2e
```

Environment overrides:

1. `TRIP_APP_HTML` points the server at a custom `a2ui-app.html` path (with `.catalog.json` beside it).
2. `TRIP_ENV_FILE` loads `KEY=value` pairs before startup.
