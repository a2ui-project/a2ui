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
 * Multi-scenario A2UI v1.0 surface composer for Space & Seating Planner.
 * Each scenario composes a distinct component tree from `canvasCatalog` with
 * zero `basicCatalog` components.
 */

import {CANVAS_CATALOG_ID} from './catalog/catalog_id.js';
import {evaluatePlanData, formatRoomFeet} from './domain/geometry.js';
import {buildScenarioBundle, resolveScenarioId, type ScenarioBundle} from './domain/scenarios.js';
import type {FloorplanPlacement, ScenarioId, SeatPlacement} from './domain/types.js';

export const MAX_DATA_MODEL_BYTES = 12 * 1024;

export interface A2uiComponent {
  readonly id: string;
  readonly component: string;
  readonly [property: string]: unknown;
}

export interface DataBinding {
  readonly '@path': string;
}

export interface FunctionCall {
  readonly '@call': string;
  readonly args: Record<string, unknown>;
}

export type A2uiMessage =
  | {
      readonly version: '1.0';
      readonly createSurface: {
        readonly surfaceId: string;
        readonly catalogId: string;
        readonly sendDataModel?: boolean;
      };
    }
  | {
      readonly version: '1.0';
      readonly updateComponents: {
        readonly surfaceId: string;
        readonly components: readonly A2uiComponent[];
      };
    }
  | {
      readonly version: '1.0';
      readonly deleteSurface: {readonly surfaceId: string};
    }
  | {
      readonly version: '1.0';
      readonly updateDataModel: {
        readonly surfaceId: string;
        readonly path?: string;
        readonly value: unknown;
      };
    };

export function bind(pointer: string): DataBinding {
  return {'@path': pointer};
}

export function call(name: string, args: Record<string, unknown>): FunctionCall {
  return {'@call': name, args};
}

export function event(name: string, context: Record<string, unknown> = {}) {
  return {event: {name, context}};
}

export function component(
  id: string,
  type: string,
  properties: Record<string, unknown> = {},
): A2uiComponent {
  return {id, component: type, ...properties};
}

export function updateData(
  surfaceId: string,
  pointer: string | undefined,
  value: unknown,
): A2uiMessage {
  return {
    version: '1.0',
    updateDataModel: pointer === undefined ? {surfaceId, value} : {surfaceId, path: pointer, value},
  };
}

export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function composeComponents(bundle: ScenarioBundle): A2uiComponent[] {
  const liveEval = call('evaluatePlan', {
    scene: bind('/scene'),
    placements: bind('/placements'),
    rules: bind('/rules'),
  });
  const liveInspect = call('inspectItem', {
    scene: bind('/scene'),
    placements: bind('/placements'),
    selectedId: bind('/selectedId'),
  });
  const saveEvt = event('save_layout', {
    scenarioId: bundle.scenarioId,
    placements: bind('/placements'),
  });
  const resolveEvt = event('auto_resolve_conflicts', {
    scenarioId: bundle.scenarioId,
    placements: bind('/placements'),
  });
  const followUpEvt = event('ask_ergonomics_or_hosts', {
    scenarioTitle: bundle.scene.title,
    selectedItem: call('selectedLabel', {
      scene: bind('/scene'),
      placements: bind('/placements'),
      selectedId: bind('/selectedId'),
    }),
    scoreSummary: call('scoreSummaryText', {
      scene: bind('/scene'),
      placements: bind('/placements'),
      rules: bind('/rules'),
    }),
  });

  if (bundle.scenarioId === 'bedroom_office') {
    // Composition A: PresetStrip + CanvasSplit(PlanCanvas, SelectionInspector[PieceTray slotted]) + RuleScoreboard + PlanActionBar
    return [
      component('root', 'PlannerFrame', {
        title: bundle.scene.title,
        subtitle: bundle.scene.subtitle,
        evaluation: liveEval,
        children: ['preset_strip_top', 'workspace_split', 'rule_board'],
        footer: 'action_bar',
      }),
      component('preset_strip_top', 'PresetStrip', {
        presets: structuredClone(bundle.presets),
        placements: bind('/placements'),
        activePresetId: bind('/activePresetId'),
      }),
      component('workspace_split', 'CanvasSplit', {
        ratio: 'canvas_wide',
        children: ['floorplan_canvas', 'piece_inspector'],
      }),
      component('floorplan_canvas', 'PlanCanvas', {
        scene: bind('/scene'),
        placements: bind('/placements'),
        selectedId: bind('/selectedId'),
        evaluation: liveEval,
      }),
      component('piece_inspector', 'SelectionInspector', {
        inspection: liveInspect,
        extraChild: 'furniture_tray',
      }),
      component('furniture_tray', 'PieceTray', {
        title: 'Swap or toggle pieces',
        pieces: structuredClone(bundle.pieces),
        placements: bind('/placements'),
        scene: bind('/scene'),
        selectedId: bind('/selectedId'),
      }),
      component('rule_board', 'RuleScoreboard', {
        evaluation: liveEval,
        selectedId: bind('/selectedId'),
      }),
      component('action_bar', 'PlanActionBar', {
        primaryLabel: 'Save room layout',
        primaryAction: saveEvt,
        resolveLabel: 'Auto-resolve clearance',
        resolveAction: resolveEvt,
        followUpLabel: bundle.followUpLabel,
        followUpAction: followUpEvt,
        savedNote: bind('/savedNote'),
      }),
    ];
  }

  if (bundle.scenarioId === 'dinner_seating') {
    // Composition B: RuleScoreboard + PresetStrip + full-width PlanCanvas[seating] + PlanActionBar
    // Deliberately omits PieceTray, CanvasSplit, and SelectionInspector.
    return [
      component('root', 'PlannerFrame', {
        title: bundle.scene.title,
        subtitle: bundle.scene.subtitle,
        evaluation: liveEval,
        children: ['rule_board_top', 'seating_presets', 'banquet_canvas'],
        footer: 'action_bar',
      }),
      component('rule_board_top', 'RuleScoreboard', {
        evaluation: liveEval,
        selectedId: bind('/selectedId'),
      }),
      component('seating_presets', 'PresetStrip', {
        presets: structuredClone(bundle.presets),
        placements: bind('/placements'),
        activePresetId: bind('/activePresetId'),
      }),
      component('banquet_canvas', 'PlanCanvas', {
        scene: bind('/scene'),
        placements: bind('/placements'),
        selectedId: bind('/selectedId'),
        evaluation: liveEval,
      }),
      component('action_bar', 'PlanActionBar', {
        primaryLabel: 'Save seating chart',
        primaryAction: saveEvt,
        resolveLabel: 'Auto-resolve conflicts',
        resolveAction: resolveEvt,
        followUpLabel: bundle.followUpLabel,
        followUpAction: followUpEvt,
        savedNote: bind('/savedNote'),
      }),
    ];
  }

  // Composition C (`patio_garden`): RuleScoreboard + CanvasSplit(PlanCanvas, SelectionInspector) + top-level PieceTray + PlanActionBar
  // Deliberately omits PresetStrip and renders PieceTray as a top-level strip below the split stage.
  return [
    component('root', 'PlannerFrame', {
      title: bundle.scene.title,
      subtitle: bundle.scene.subtitle,
      evaluation: liveEval,
      children: ['rule_board_top', 'patio_split', 'garden_tray_bar'],
      footer: 'action_bar',
    }),
    component('rule_board_top', 'RuleScoreboard', {
      evaluation: liveEval,
      selectedId: bind('/selectedId'),
    }),
    component('patio_split', 'CanvasSplit', {
      ratio: 'balanced',
      children: ['patio_canvas', 'patio_inspector'],
    }),
    component('patio_canvas', 'PlanCanvas', {
      scene: bind('/scene'),
      placements: bind('/placements'),
      selectedId: bind('/selectedId'),
      evaluation: liveEval,
    }),
    component('patio_inspector', 'SelectionInspector', {
      inspection: liveInspect,
    }),
    component('garden_tray_bar', 'PieceTray', {
      title: 'Outdoor furniture & planters',
      pieces: structuredClone(bundle.pieces),
      placements: bind('/placements'),
      scene: bind('/scene'),
      selectedId: bind('/selectedId'),
    }),
    component('action_bar', 'PlanActionBar', {
      primaryLabel: 'Save patio plan',
      primaryAction: saveEvt,
      resolveLabel: 'Auto-resolve fire halo',
      resolveAction: resolveEvt,
      followUpLabel: bundle.followUpLabel,
      followUpAction: followUpEvt,
      savedNote: bind('/savedNote'),
    }),
  ];
}

function buildSummaryText(bundle: ScenarioBundle, components: readonly A2uiComponent[]): string {
  const evaluation = evaluatePlanData(bundle.scene, bundle.initialPlacements, bundle.rules);
  const componentTypes = [...new Set(components.map(item => item.component))].join(', ');
  const ruleSummary = evaluation.results
    .map(r => `- [${r.status.toUpperCase()}] ${r.label}: ${r.detail}`)
    .join('\n');
  const presetLines =
    bundle.presets.length > 0
      ? [
          'Recommended 1-click presets in card:',
          ...bundle.presets.map(
            p => `- ${p.label}${p.recommended ? ' (★ Agent pick)' : ''}: ${p.tagline}`,
          ),
        ]
      : [];
  const tailInstruction =
    'IMPORTANT: The interactive Space & Seating Planner card is now rendered inline for the user. Make space_planner your final tool call of this turn — do NOT call read_file, run_command, or any other tool after space_planner returns (any subsequent tool call collapses the inline A2UI app). Summarize directly from the details above.';

  if (bundle.scene.mode === 'seating') {
    const guests = bundle.initialPlacements as readonly SeatPlacement[];
    const tableLines = bundle.scene.tables.map(table => {
      const seated = guests
        .filter(g => g.tableId === table.id)
        .sort((a, b) => a.seatIdx - b.seatIdx)
        .map(g => `#${g.seatIdx + 1} ${g.name}${g.diet !== 'none' ? ` [${g.diet}]` : ''}`)
        .join(', ');
      return `- ${table.label}: ${seated}`;
    });
    return [
      `Rendered ${bundle.scene.title} (${bundle.scenarioId}) with custom components: ${componentTypes}.`,
      `Seating: ${guests.length} guests across ${bundle.scene.tables.length} tables (${evaluation.summary}).`,
      'Current table assignments:',
      ...tableLines,
      'Recommended fix: Swap Dan Mercer (#6 at Table A) with Tariq Al-Mansoor (#5 at Table B) — or click "Harmonious Banquet" / "Auto-resolve conflicts" — to separate Maya and Dan while keeping kids next to parents, all 3 vegans together at Table A, Grandpa Arthur in the quiet Conservatory zone, and a co-host at each table (5/5 rules passing, 100%).',
      ...presetLines,
      'Constraint check:',
      ruleSummary,
      tailInstruction,
    ].join('\n');
  }

  const pieces = bundle.initialPlacements as readonly FloorplanPlacement[];
  const pieceLines = pieces.map(
    p => `- ${p.label} at (${p.x}", ${p.y}"), rot ${p.rot}° — ${p.note}`,
  );
  const trayLines =
    bundle.pieces.length > 0
      ? [
          'Candidate pieces in tray:',
          ...bundle.pieces.map(t => `- ${t.label} (${t.w}×${t.h}", ${t.badge}) — ${t.note}`),
        ]
      : [];
  return [
    `Rendered ${bundle.scene.title} (${bundle.scenarioId}) with custom components: ${componentTypes}.`,
    `Space: ${formatRoomFeet(bundle.scene.roomW)} × ${formatRoomFeet(bundle.scene.roomH)} with ${pieces.length} placed items (${evaluation.summary}).`,
    'Placed items:',
    ...pieceLines,
    ...trayLines,
    ...presetLines,
    'Constraint check:',
    ruleSummary,
    tailInstruction,
  ].join('\n');
}

export interface ComposedPlanner {
  readonly scenarioId: ScenarioId;
  readonly surfaceId: string;
  readonly text: string;
  readonly dataModelBytes: number;
  readonly a2ui: A2uiMessage[];
}

export function composeSpacePlanner(
  prompt: string,
  explicitScenario?: ScenarioId,
  surfaceId?: string,
): ComposedPlanner {
  const scenarioId = resolveScenarioId(prompt, explicitScenario);
  const bundle = buildScenarioBundle(scenarioId);
  const resolvedSurfaceId = surfaceId ?? `canvas_${scenarioId}`;
  const components = composeComponents(bundle);

  const dataModel: Record<string, unknown> = {
    scenarioId: bundle.scenarioId,
    scene: structuredClone(bundle.scene),
    placements: structuredClone(bundle.initialPlacements),
    selectedId: bundle.initialSelectedId,
    activePresetId: bundle.initialPresetId,
    rules: structuredClone(bundle.rules),
    savedNote: '',
  };

  const dataModelBytes = jsonBytes(dataModel);
  if (dataModelBytes > MAX_DATA_MODEL_BYTES) {
    throw new Error(
      `Data model for ${scenarioId} is ${dataModelBytes} bytes (limit ${MAX_DATA_MODEL_BYTES}).`,
    );
  }

  return {
    scenarioId,
    surfaceId: resolvedSurfaceId,
    text: buildSummaryText(bundle, components),
    dataModelBytes,
    a2ui: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: resolvedSurfaceId,
          catalogId: CANVAS_CATALOG_ID,
          sendDataModel: true,
        },
      },
      {
        version: '1.0',
        updateComponents: {
          surfaceId: resolvedSurfaceId,
          components,
        },
      },
      {
        version: '1.0',
        updateDataModel: {
          surfaceId: resolvedSurfaceId,
          value: dataModel,
        },
      },
    ],
  };
}
