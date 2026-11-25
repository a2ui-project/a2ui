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
 * Stateful domain controller managing Goal Mixer surfaces, live Gemini blueprint
 * synthesis with curated fallback, and in-place `lock_mix` / `snap_to_targets` actions.
 */

import type {AgentToRendererMessage} from '@a2ui/web_core/v1_0';

import type {JsonModel} from './ai/json_model.js';
import {DEFAULT_SYNTHESIS_TIMEOUT_MS, synthesizeBlueprint} from './ai/synthesizer.js';
import {evaluateMixTotals, type MixItem} from './catalog/functions.js';
import {createSurfaceMessages, updateData} from './compose/a2ui.js';
import {composeMixerSurface, summarizeMixerCard} from './compose/composer.js';
import type {MixerActionArgs} from './compose/events.js';
import {
  CURATED_SCENARIO_IDS,
  getScenarioBlueprint,
  inferScenario,
  snapMixToTargets,
  type CuratedScenarioId,
  type ScenarioBlueprint,
  type ScenarioMode,
} from './scenarios/presets.js';

export interface MixerToolResult {
  readonly text: string;
  readonly a2ui: AgentToRendererMessage[];
}

interface SurfaceRecord {
  readonly surfaceId: string;
  readonly blueprint: ScenarioBlueprint;
  locked: boolean;
}

function isCuratedScenarioId(id: string): id is CuratedScenarioId {
  return (CURATED_SCENARIO_IDS as readonly string[]).includes(id);
}

export class MixerService {
  private readonly surfaces = new Map<string, SurfaceRecord>();
  private surfaceCounter = 0;

  constructor(
    private readonly model?: JsonModel,
    private readonly validateMessages?: (messages: AgentToRendererMessage[]) => boolean,
    private readonly timeoutMs = DEFAULT_SYNTHESIS_TIMEOUT_MS,
  ) {}

  async openMixer(prompt: string, explicitScenario?: ScenarioMode): Promise<MixerToolResult> {
    const surfaceId = `mixer_${++this.surfaceCounter}`;
    let blueprint: ScenarioBlueprint | undefined;

    const wantsExplicitCurated =
      explicitScenario !== undefined &&
      explicitScenario !== 'auto' &&
      explicitScenario !== 'custom' &&
      isCuratedScenarioId(explicitScenario);

    if (wantsExplicitCurated) {
      blueprint = getScenarioBlueprint(explicitScenario);
    } else if (this.model) {
      try {
        const candidate = await synthesizeBlueprint(prompt, this.model, this.timeoutMs);
        const candidateMessages = createSurfaceMessages(composeMixerSurface(surfaceId, candidate));
        const dmBytes = Buffer.byteLength(JSON.stringify(candidateMessages[2] ?? {}));
        const valid =
          dmBytes < 11_500 &&
          (this.validateMessages ? this.validateMessages(candidateMessages) : true);
        if (valid) {
          blueprint = candidate;
        }
      } catch {
        // Fall back cleanly to the best-matching curated domain blueprint.
      }
    }

    blueprint ??= getScenarioBlueprint(inferScenario(prompt, explicitScenario));
    this.surfaces.set(surfaceId, {surfaceId, blueprint, locked: false});

    const view = composeMixerSurface(surfaceId, blueprint);
    return {
      text: summarizeMixerCard(prompt, blueprint),
      a2ui: createSurfaceMessages(view),
    };
  }

  private resolveBlueprint(surfaceId: string, scenarioHint: string): ScenarioBlueprint {
    const stored = this.surfaces.get(surfaceId)?.blueprint;
    if (stored) return stored;
    return getScenarioBlueprint(inferScenario(scenarioHint, scenarioHint));
  }

  lockMix(args: MixerActionArgs<'lock_mix'>, surfaceId: string): MixerToolResult {
    const blueprint = this.resolveBlueprint(surfaceId, args.scenario);
    const record = this.surfaces.get(surfaceId);
    if (record) record.locked = true;

    const totals = evaluateMixTotals(args.items, blueprint.targets);
    const statusText = `✓ Locked (${totals.hits}/${totals.total} targets): ${totals.summaryLine}`;

    return {
      text: `Locked ${blueprint.title} on surface ${surfaceId}: ${totals.summaryLine} (${totals.hits}/${totals.total} targets in band).`,
      a2ui: [
        updateData(surfaceId, '/locked', true),
        updateData(surfaceId, '/lockButtonLabel', '✓ Mix locked'),
        updateData(surfaceId, '/statusText', statusText),
      ],
    };
  }

  snapToTargets(args: MixerActionArgs<'snap_to_targets'>, surfaceId: string): MixerToolResult {
    const blueprint = this.resolveBlueprint(surfaceId, args.scenario);
    const record = this.surfaces.get(surfaceId);
    if (record) record.locked = false;

    const snapped = snapMixToTargets(blueprint, args.items as unknown as readonly MixItem[]);
    const totals = evaluateMixTotals(snapped.items, blueprint.targets);
    const statusText = `↺ Snapped to ${totals.hits}/${totals.total} target bands: ${totals.summaryLine}`;

    return {
      text: `Snapped ${blueprint.title} back into all ${totals.hits}/${totals.total} target bands: ${totals.summaryLine}.`,
      a2ui: [
        updateData(surfaceId, '/items', snapped.items),
        updateData(surfaceId, '/selectedPresetId', snapped.presetId),
        updateData(surfaceId, '/locked', false),
        updateData(surfaceId, '/lockButtonLabel', 'Lock mix'),
        updateData(surfaceId, '/statusText', statusText),
      ],
    };
  }
}
