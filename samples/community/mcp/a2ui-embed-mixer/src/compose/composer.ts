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
 * Multi-layout A2UI v1.0 surface composer for `mixerCatalog`.
 *
 * Composes 4 distinct custom component architectures chosen per problem:
 * 1. `rings_pareto_gantt`: `TargetRingCluster` (strip) + `MixerGrid(ParetoPlane2D, PrepTrackGantt)`
 *    + `PortionScrubTile` grid + `CommitBar`.
 * 2. `rings_pareto`: `MixerGrid(TargetRingCluster(compact), ParetoPlane2D)` + `PortionScrubTile`
 *    grid + `CommitBar` (omits `PrepTrackGantt`).
 * 3. `rings_gantt`: `TargetRingCluster` (strip) + full-width `PrepTrackGantt` + `PortionScrubTile`
 *    grid + `CommitBar` (omits `ParetoPlane2D`).
 * 4. `pareto_hero`: Hero full-width `ParetoPlane2D` + `TargetRingCluster` (strip) +
 *    `PortionScrubTile` grid (with `MixMicroNote` child slot) + `CommitBar` (omits `PrepTrackGantt`).
 */

import {evaluateMixTotals} from '../catalog/functions.js';
import type {LayoutMode, ScenarioBlueprint} from '../scenarios/presets.js';
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

function composeParetoComponent(
  pareto: NonNullable<ScenarioBlueprint['pareto']>,
  wide = false,
): A2uiComponent {
  return component('pareto_frontier', 'ParetoPlane2D', {
    title: pareto.title,
    xKey: pareto.xKey,
    yKey: pareto.yKey,
    xLabel: pareto.xLabel,
    yLabel: pareto.yLabel,
    xDomain: [...pareto.xDomain],
    yDomain: [...pareto.yDomain],
    sweetSpot: pareto.sweetSpot,
    ...(wide ? {wide: true} : {}),
    presets: bind('/presets'),
    items: bind('/items'),
    selectedPresetId: bind('/selectedPresetId'),
    totals: liveTotalsCall(),
  });
}

function composeGanttComponent(
  gantt: NonNullable<ScenarioBlueprint['gantt']>,
  wide = false,
): A2uiComponent {
  return component('prep_gantt', 'PrepTrackGantt', {
    title: gantt.title,
    subtitle: gantt.subtitle,
    totalMinutes: gantt.totalMinutes,
    ...(gantt.unitSuffix ? {unitSuffix: gantt.unitSuffix} : {}),
    ...(wide ? {wide: true} : {}),
    tracks: bind('/prepTracks'),
    items: bind('/items'),
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

export function describeLayoutMode(mode: LayoutMode): string {
  switch (mode) {
    case 'rings_pareto_gantt':
      return 'TargetRingCluster + MixerGrid(ParetoPlane2D, PrepTrackGantt) + PortionScrubTile grid + CommitBar';
    case 'rings_pareto':
      return 'MixerGrid(compact TargetRingCluster, ParetoPlane2D) + PortionScrubTile grid + CommitBar (no PrepTrackGantt)';
    case 'rings_gantt':
      return 'TargetRingCluster + full-width PrepTrackGantt + PortionScrubTile grid + CommitBar (no ParetoPlane2D)';
    case 'pareto_hero':
      return 'Hero ParetoPlane2D + strip TargetRingCluster + PortionScrubTile grid + CommitBar (no PrepTrackGantt)';
  }
}

export function composeMixerSurface(surfaceId: string, blueprint: ScenarioBlueprint): SurfaceView {
  const {tileIds, tileComponents} = composeScrubTiles(blueprint);
  const tileCols = blueprint.items.length === 3 ? 3 : 2;
  const components: A2uiComponent[] = [];
  const mode = blueprint.layoutMode;

  if (mode === 'rings_pareto' && blueprint.pareto) {
    components.push(
      component('root', 'MixerDeck', {
        title: bind('/title'),
        subtitle: bind('/subtitle'),
        scenarioBadge: bind('/badge'),
        totals: liveTotalsCall(),
        children: ['top_stage_grid', 'tiles_grid'],
        footer: 'commit_bar',
      }),
      component('top_stage_grid', 'MixerGrid', {
        columns: 2,
        children: ['rings_main', 'pareto_frontier'],
      }),
      component('rings_main', 'TargetRingCluster', {
        totals: liveTotalsCall(),
        layout: 'compact',
        caption: `${blueprint.badge} · live target rings`,
      }),
      composeParetoComponent(blueprint.pareto),
      component('tiles_grid', 'MixerGrid', {
        columns: tileCols,
        children: tileIds,
      }),
      ...tileComponents,
      composeCommitBar(blueprint),
    );
  } else if (mode === 'pareto_hero' && blueprint.pareto) {
    components.push(
      component('root', 'MixerDeck', {
        title: bind('/title'),
        subtitle: bind('/subtitle'),
        scenarioBadge: bind('/badge'),
        totals: liveTotalsCall(),
        children: ['pareto_frontier', 'rings_main', 'tiles_grid'],
        footer: 'commit_bar',
      }),
      composeParetoComponent(blueprint.pareto, true),
      component('rings_main', 'TargetRingCluster', {
        totals: liveTotalsCall(),
        layout: 'strip',
      }),
      component('tiles_grid', 'MixerGrid', {
        columns: tileCols,
        children: tileIds,
      }),
      ...tileComponents,
      composeCommitBar(blueprint),
    );
  } else if (mode === 'rings_gantt' && blueprint.gantt) {
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
      composeGanttComponent(blueprint.gantt, true),
      component('tiles_grid', 'MixerGrid', {
        columns: tileCols,
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
      composeParetoComponent(blueprint.pareto!),
      composeGanttComponent(blueprint.gantt!),
      component('tiles_grid', 'MixerGrid', {
        columns: tileCols,
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
  const sourceLabel =
    blueprint.source === 'gemini'
      ? 'Gemini live synthesis (`gemini-flash-latest`)'
      : `Curated domain blueprint (\`${blueprint.id}\`)`;
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
    ? `Parallel tracks (${blueprint.gantt.title}, ${blueprint.gantt.totalMinutes}${blueprint.gantt.unitSuffix ?? 'm'}): ${blueprint.gantt.tracks
        .map(t => `${t.name} [${t.blocks.map(b => b.label).join(' + ')}]`)
        .join('; ')}.`
    : '';

  return [
    `Opened Goal Mixer (${blueprint.title}) inline for: "${prompt.slice(0, 140)}".`,
    `Source: ${sourceLabel} | Layout: \`${blueprint.layoutMode}\` (${describeLayoutMode(blueprint.layoutMode)}).`,
    `Recommendation: ${blueprint.subtitle}`,
    `Initial converged mix (${totals.hits}/${totals.total} targets in band): ${totals.summaryLine}.`,
    'Target bands:',
    targetLines,
    'Pre-selected levers and 1-click swap options (all scrubbable 0.5x–2.0x client-side):',
    picks,
    ...(frontierLine ? [frontierLine] : []),
    ...(ganttLine ? [ganttLine] : []),
    "IMPORTANT: Make `goal_mixer` the final tool call of your turn: never call `read_file`, `run_command`, or any other tool in parallel after `goal_mixer` or after `goal_mixer` returns, because the interactive A2UI studio is already rendered inline for the user and any subsequent tool call collapses the app into the 'Worked for' block. Answer directly from this tool's text summary.",
  ].join('\n');
}
