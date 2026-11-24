# Multi-Goal Meal, Habit & Trade-Off Mixer (`a2ui-embed-mixer`)

**Problem:** Multi-goal trade-off requests such as weekday meal prep (balancing calories, protein, grocery budget, weekday prep minutes, and Sunday batch tracks) or monthly surplus allocation (balancing debt payoff speed against emergency cash cushion) force users through repetitive chat recalculation turns when rendered as plain text tables.

This sample packages a Multi-Goal Mixer MCP App built with [`@a2ui/embed`](../../../../typescript/embed) and a 100% custom A2UI v1.0 catalog (`https://a2ui.org/samples/mixer_studio/v1/catalog.json`, with zero `basicCatalog` components).

## Custom catalog components

1. `MixerDeck` and `MixerGrid` provide the outer card header, live target-convergence badge, responsive multi-column grid, and footer slot.
2. `TargetRingCluster` renders concentric animated SVG radial gauges bound to `@call: computeMixTotals(/items, /targets)` that turn green as each metric enters its target band.
3. `PortionScrubTile` provides inline SVG domain icons, `0.5x` to `2.0x` scale scrubbers and steppers, 1-click option swap pills writing `/items` directly, and an optional `detailChild` slot (`MixMicroNote`).
4. `ParetoPlane2D` plots Pareto-optimal presets and a live `Current mix` crosshair on a 2D SVG trade-off frontier; clicking any preset updates `/items` client-side with zero server round-trips.
5. `PrepTrackGantt` renders parallel Sunday batch-cook or weekly microcycle SVG tracks (`Oven`, `Stovetop`, `Prep counter`) that adapt as active swaps change.
6. `CommitBar` dispatches `a2ui_action` (`lock_mix`, `snap_to_targets`) and `followUp` (`build_shopping_or_action_list`).

## Build and test

```bash
yarn build
yarn test
yarn e2e
```
