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

// @vitest-environment jsdom

import '@a2ui/lit';
import type {A2uiSurface} from '@a2ui/lit';
import {MessageProcessor, type ActionPayload} from '@a2ui/web_core/v1_0';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {createSurfaceMessages} from '../compose/a2ui.js';
import {composeMixerSurface} from '../compose/composer.js';
import {CURATED_SCENARIO_IDS, getScenarioBlueprint} from '../scenarios/presets.js';
import {evaluateMixTotals, MIXER_CATALOG_ID, mixerCatalog} from './index.js';

const FORBIDDEN_BASIC_COMPONENTS = [
  'Text',
  'Image',
  'Icon',
  'Row',
  'Column',
  'List',
  'Card',
  'Tabs',
  'Modal',
  'Divider',
  'Button',
  'TextField',
  'CheckBox',
  'ChoicePicker',
  'Slider',
  'DateTimeInput',
];

async function flushDom(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 25));
}

describe('mixerCatalog and custom Lit components', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('registers only the 8 custom Mixer components and computeMixTotals (zero basicCatalog)', () => {
    expect(mixerCatalog.id).toBe(MIXER_CATALOG_ID);
    const names = [...mixerCatalog.components.keys()].sort();
    expect(names).toEqual([
      'CommitBar',
      'MixMicroNote',
      'MixerDeck',
      'MixerGrid',
      'ParetoPlane2D',
      'PortionScrubTile',
      'PrepTrackGantt',
      'TargetRingCluster',
    ]);
    for (const basicName of FORBIDDEN_BASIC_COMPONENTS) {
      expect(names).not.toContain(basicName);
    }
    expect([...mixerCatalog.functions.keys()]).toContain('computeMixTotals');
  });

  it('evaluates all 8 curated domain blueprints with 4/4 converged default target rings', () => {
    for (const id of CURATED_SCENARIO_IDS) {
      const blueprint = getScenarioBlueprint(id);
      const totals = evaluateMixTotals(blueprint.items, blueprint.targets);
      expect(totals.total).toBe(4);
      expect(totals.hits).toBe(4);
      expect(totals.converged).toBe(true);
    }

    const meal = getScenarioBlueprint('meal_prep');
    const mealTotals = evaluateMixTotals(meal.items, meal.targets);
    expect(mealTotals.summaryLine).toBe('1,850 kcal · 145g protein · $62/wk · 14m prep');
  });

  it('renders meal_prep surface and updates rings, Pareto crosshair, and Gantt live on client edits', async () => {
    const actions: ActionPayload[] = [];
    const processor = new MessageProcessor(
      [mixerCatalog as never],
      action => {
        actions.push(action);
      },
      {version: '1.0'},
    );
    const view = composeMixerSurface('s_meal', getScenarioBlueprint('meal_prep'));
    processor.processMessages(createSurfaceMessages(view));

    const surfaceModel = processor.getSurfaces().get('s_meal')!;
    const surfaceEl = document.createElement('a2ui-surface') as A2uiSurface;
    surfaceEl.surface = surfaceModel as never;
    document.body.append(surfaceEl);
    await flushDom();

    expect(surfaceEl.querySelectorAll('.ring-cluster__arc').length).toBe(4);
    expect(surfaceEl.querySelectorAll('.ring-cluster__card[data-hit="true"]').length).toBe(4);
    expect(surfaceEl.textContent).toContain('1,850 kcal');
    expect(surfaceEl.textContent).toContain('145g protein');
    expect(surfaceEl.textContent).toContain('$62/wk');
    expect(surfaceEl.textContent).toContain('14m prep');
    expect(surfaceEl.querySelector('a2ui-mix-micro-note')?.textContent).toContain(
      'Sealed yogurt jars hold 4 days',
    );

    // Swap Greek yogurt -> Tofu on breakfast tile: updates /items, rings, and Gantt with 0 actions.
    const tofuBtn = surfaceEl.querySelector<HTMLButtonElement>(
      '.scrub-tile[data-item-id="breakfast"] button[data-option-id="tofu"]',
    )!;
    expect(tofuBtn).not.toBeNull();
    tofuBtn.click();
    await flushDom();

    expect(actions.length).toBe(0);
    expect(surfaceEl.textContent).toContain('1,840 kcal');
    expect(surfaceEl.textContent).toContain('$58/wk');
    expect(surfaceEl.textContent).toContain('18m prep');
    expect(
      surfaceEl
        .querySelector('.ring-cluster__card[data-metric-key="prep"]')
        ?.getAttribute('data-hit'),
    ).toBe('false');
    expect(surfaceEl.querySelector('a2ui-prep-track-gantt')?.textContent).toContain(
      'Herb tofu skillet',
    );

    // Click the "$44 Plant Saver" Pareto frontier preset: updates /items & crosshair live.
    const plantPresetChip = surfaceEl.querySelector<HTMLButtonElement>(
      'button[data-preset-chip="preset_plant_budget"]',
    )!;
    plantPresetChip.click();
    await flushDom();

    expect(actions.length).toBe(0);
    expect(surfaceModel.dataModel.get('/selectedPresetId')).toBe('preset_plant_budget');
    expect(surfaceEl.textContent).toContain('$44/wk');
    expect(surfaceEl.querySelector('.pareto-plane__crosshair')?.getAttribute('data-live-y')).toBe(
      '44',
    );

    // Clicking CommitBar Lock mix dispatches lock_mix action with the live updated items.
    const lockBtn = surfaceEl.querySelector<HTMLButtonElement>('.commit-bar__btn--primary')!;
    lockBtn.click();
    await flushDom();

    expect(actions.length).toBe(1);
    expect(actions[0]!.name).toBe('lock_mix');
    expect(actions[0]!.context['selectedPresetId']).toBe('preset_plant_budget');

    processor.dispose();
  });
});
