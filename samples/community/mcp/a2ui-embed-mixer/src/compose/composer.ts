/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Scenario-driven A2UI surface composer.
 *
 * Demonstrates genuine agent composability across scenarios:
 * - `meal_prep`: `TargetRingCluster` (strip) + `MixerGrid(ParetoPlane2D, PrepTrackGantt)` +
 *   2-column `PortionScrubTile` grid (with `MixMicroNote` `detailChild`) + `CommitBar`.
 * - `debt_savings`: 2-column `MixerGrid(TargetRingCluster(compact), ParetoPlane2D)` +
 *   3-column financial `PortionScrubTile` allocation grid + `CommitBar` (omits `PrepTrackGantt`).
 * - `training_week`: `TargetRingCluster` (strip) + full-width `PrepTrackGantt` +
 *   3-column `PortionScrubTile` session grid + `CommitBar` (omits `ParetoPlane2D`).
 */

import {evaluateMixTotals} from '../catalog/functions.js';
import type {ScenarioBlueprint} from '../scenarios/presets.js';
import {bind, call, component, event, type A2uiComponent, type SurfaceView} from './a2ui.js';

function liveTotalsCall() {
  return call('computeMixTotals', {
    items: bind('/items'),
    targets: bind('/targets'),
  });
}

function composeCommitBar(blueprint: ScenarioBlueprint): A2uiComponent {
  return component('commit_bar', 'CommitBar', {
    statusText: bind('/statusText'),
    locked: bind('/locked'),
    totals: liveTotalsCall(),
    snapLabel: 'Snap to targets',
    followUpLabel: blueprint.followUpButtonLabel,
    lockLabel: bind('/lockButtonLabel'),
    snapAction: event('snap_to_targets', {
      scenario: bind('/scenario'),
      items: bind('/items'),
    }),
    followUpAction: event('build_shopping_or_action_list', {
      deliverable: bind('/deliverableLabel'),
      scenarioTitle: bind('/title'),
      preset: bind('/selectedPresetId'),
    }),
    lockAction: event('lock_mix', {
      scenario: bind('/scenario'),
      items: bind('/items'),
      selectedPresetId: bind('/selectedPresetId'),
    }),
  });
}

function composeScrubTiles(blueprint: ScenarioBlueprint): {
  tileIds: string[];
  tileComponents: A2uiComponent[];
} {
  const tileIds: string[] = [];
  const tileComponents: A2uiComponent[] = [];

  for (const item of blueprint.items) {
    const tileId = `tile_${item.id}`;
    tileIds.push(tileId);
    const hasMicroNote = blueprint.microNote?.itemId === item.id;
    const noteId = `note_${item.id}`;

    tileComponents.push(
      component(tileId, 'PortionScrubTile', {
        itemId: item.id,
        items: bind('/items'),
        minScale: 0.5,
        maxScale: 2.0,
        step: 0.25,
        ...(hasMicroNote ? {detailChild: noteId} : {}),
      }),
    );

    if (hasMicroNote && blueprint.microNote) {
      tileComponents.push(
        component(noteId, 'MixMicroNote', {
          text: blueprint.microNote.text,
          tone: blueprint.microNote.tone,
        }),
      );
    }
  }

  return {tileIds, tileComponents};
}

export function composeMixerSurface(surfaceId: string, blueprint: ScenarioBlueprint): SurfaceView {
  const {tileIds, tileComponents} = composeScrubTiles(blueprint);
  const components: A2uiComponent[] = [];

  if (blueprint.id === 'debt_savings' && blueprint.pareto) {
    components.push(
      component('root', 'MixerDeck', {
        title: bind('/title'),
        subtitle: bind('/subtitle'),
        scenarioBadge: bind('/badge'),
        totals: liveTotalsCall(),
        children: ['financial_top_grid', 'tiles_grid'],
        footer: 'commit_bar',
      }),
      component('financial_top_grid', 'MixerGrid', {
        columns: 2,
        children: ['rings_main', 'pareto_frontier'],
      }),
      component('rings_main', 'TargetRingCluster', {
        totals: liveTotalsCall(),
        layout: 'compact',
        caption: 'Monthly surplus & payoff gauges ($1,500/mo pool)',
      }),
      component('pareto_frontier', 'ParetoPlane2D', {
        title: blueprint.pareto.title,
        xKey: blueprint.pareto.xKey,
        yKey: blueprint.pareto.yKey,
        xLabel: blueprint.pareto.xLabel,
        yLabel: blueprint.pareto.yLabel,
        xDomain: [...blueprint.pareto.xDomain],
        yDomain: [...blueprint.pareto.yDomain],
        sweetSpot: blueprint.pareto.sweetSpot,
        presets: bind('/presets'),
        items: bind('/items'),
        selectedPresetId: bind('/selectedPresetId'),
        totals: liveTotalsCall(),
      }),
      component('tiles_grid', 'MixerGrid', {
        columns: 3,
        children: tileIds,
      }),
      ...tileComponents,
      composeCommitBar(blueprint),
    );
  } else if (blueprint.id === 'training_week' && blueprint.gantt) {
    components.push(
      component('root', 'MixerDeck', {
        title: bind('/title'),
        subtitle: bind('/subtitle'),
        scenarioBadge: bind('/badge'),
        totals: liveTotalsCall(),
        children: ['rings_main', 'prep_gantt', 'tiles_grid'],
        footer: 'commit_bar',
      }),
      component('rings_main', 'TargetRingCluster', {
        totals: liveTotalsCall(),
        layout: 'strip',
      }),
      component('prep_gantt', 'PrepTrackGantt', {
        title: blueprint.gantt.title,
        subtitle: blueprint.gantt.subtitle,
        totalMinutes: blueprint.gantt.totalMinutes,
        tracks: bind('/prepTracks'),
        items: bind('/items'),
      }),
      component('tiles_grid', 'MixerGrid', {
        columns: 3,
        children: tileIds,
      }),
      ...tileComponents,
      composeCommitBar(blueprint),
    );
  } else {
    components.push(
      component('root', 'MixerDeck', {
        title: bind('/title'),
        subtitle: bind('/subtitle'),
        scenarioBadge: bind('/badge'),
        totals: liveTotalsCall(),
        children: ['rings_main', 'stage_grid', 'tiles_grid'],
        footer: 'commit_bar',
      }),
      component('rings_main', 'TargetRingCluster', {
        totals: liveTotalsCall(),
        layout: 'strip',
      }),
      component('stage_grid', 'MixerGrid', {
        columns: 2,
        children: ['pareto_frontier', 'prep_gantt'],
      }),
      component('pareto_frontier', 'ParetoPlane2D', {
        title: blueprint.pareto!.title,
        xKey: blueprint.pareto!.xKey,
        yKey: blueprint.pareto!.yKey,
        xLabel: blueprint.pareto!.xLabel,
        yLabel: blueprint.pareto!.yLabel,
        xDomain: [...blueprint.pareto!.xDomain],
        yDomain: [...blueprint.pareto!.yDomain],
        sweetSpot: blueprint.pareto!.sweetSpot,
        presets: bind('/presets'),
        items: bind('/items'),
        selectedPresetId: bind('/selectedPresetId'),
        totals: liveTotalsCall(),
      }),
      component('prep_gantt', 'PrepTrackGantt', {
        title: blueprint.gantt!.title,
        subtitle: blueprint.gantt!.subtitle,
        totalMinutes: blueprint.gantt!.totalMinutes,
        tracks: bind('/prepTracks'),
        items: bind('/items'),
      }),
      component('tiles_grid', 'MixerGrid', {
        columns: 2,
        children: tileIds,
      }),
      ...tileComponents,
      composeCommitBar(blueprint),
    );
  }

  const defaultPresetId =
    blueprint.pareto?.presets.find(p => p.recommended)?.id ?? 'recommended_default';
  const initialEval = evaluateMixTotals(blueprint.items, blueprint.targets);

  const dataModel: Record<string, unknown> = {
    scenario: blueprint.id,
    badge: blueprint.badge,
    title: blueprint.title,
    subtitle: blueprint.subtitle,
    deliverableLabel: blueprint.deliverableLabel,
    selectedPresetId: defaultPresetId,
    locked: false,
    lockButtonLabel: 'Lock mix',
    statusText: `Live mix: ${initialEval.summaryLine} (scrub scales or click swaps)`,
    targets: blueprint.targets,
    items: blueprint.items,
    ...(blueprint.pareto ? {presets: blueprint.pareto.presets} : {}),
    ...(blueprint.gantt ? {prepTracks: blueprint.gantt.tracks} : {}),
  };

  return {
    surfaceId,
    sendDataModel: true,
    components,
    dataModel,
  };
}

/** Human- and model-readable text summary of a composed Goal Mixer card (contains zero A2UI syntax). */
export function summarizeMixerCard(prompt: string, blueprint: ScenarioBlueprint): string {
  const totals = evaluateMixTotals(blueprint.items, blueprint.targets);
  const targetLines = totals.metrics
    .map(m => `- ${m.label}: ${m.formatted} (goal ${m.targetLabel}, ${m.deltaLabel})`)
    .join('\n');
  const picks = blueprint.items
    .map(item => {
      const opt = item.options.find(o => o.id === item.activeOptionId) ?? item.options[0];
      const alts = item.options
        .filter(o => o.id !== (opt?.id ?? item.activeOptionId))
        .map(o => `${o.label} (${o.note})`)
        .join('; ');
      return `- ${item.title}: ★ ${opt?.label ?? item.activeOptionId} at ${item.scale.toFixed(1)}x (${opt?.note ?? ''}) | swaps: ${alts}`;
    })
    .join('\n');
  const frontierLine = blueprint.pareto
    ? `Pareto frontier presets (${blueprint.pareto.title}): ${blueprint.pareto.presets
        .map(p => `${p.label} (${blueprint.pareto!.xKey}=${p.x}, ${blueprint.pareto!.yKey}=${p.y})`)
        .join(', ')}.`
    : '';
  const ganttLine = blueprint.gantt
    ? `Parallel tracks (${blueprint.gantt.title}, ${blueprint.gantt.totalMinutes}m): ${blueprint.gantt.tracks
        .map(t => `${t.name} [${t.blocks.map(b => b.label).join(' + ')}]`)
        .join('; ')}.`
    : '';

  return [
    `Opened Goal Mixer (${blueprint.title}) inline for: "${prompt.slice(0, 140)}".`,
    `Recommendation: ${blueprint.subtitle}`,
    `Initial converged mix (${totals.hits}/${totals.total} targets in band): ${totals.summaryLine}.`,
    'Target bands:',
    targetLines,
    'Pre-selected items and 1-click swap options (all scrubbable 0.5x–2.0x client-side):',
    picks,
    ...(frontierLine ? [frontierLine] : []),
    ...(ganttLine ? [ganttLine] : []),
    "IMPORTANT: Make `goal_mixer` the final tool call of your turn: never call `read_file`, `run_command`, or any other tool in parallel after `goal_mixer` or after `goal_mixer` returns, because the interactive A2UI studio is already rendered inline for the user and any subsequent tool call collapses the app into the 'Worked for' block. Answer directly from this tool's text summary.",
  ].join('\n');
}
