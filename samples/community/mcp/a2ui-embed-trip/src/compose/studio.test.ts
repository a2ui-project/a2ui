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

import {describe, expect, it} from 'vitest';

import {SCENARIO_IDS} from '../scenarios/catalog_data.js';
import {validationErrors} from '../testing/validation.js';
import {jsonBytes, type A2uiComponent, type A2uiMessage} from './a2ui.js';
import {
  composeTripStudio,
  extractBudgetCap,
  MAX_DATA_MODEL_BYTES,
  resolveScenario,
} from './studio.js';

function componentsOf(messages: readonly A2uiMessage[]): readonly A2uiComponent[] {
  const msg = messages.find(m => 'updateComponents' in m);
  return msg && 'updateComponents' in msg ? msg.updateComponents.components : [];
}

function dataModelOf(messages: readonly A2uiMessage[]): Record<string, unknown> {
  const msg = messages.find(m => 'updateDataModel' in m);
  return msg && 'updateDataModel' in msg
    ? (msg.updateDataModel.value as Record<string, unknown>)
    : {};
}

function collectObjectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      out.add(key);
      collectObjectKeys(child, out);
    }
  }
  return out;
}

describe('prompt routing & scenario composition', () => {
  it('routes natural prompts into contrasting studio scenarios and extracts budget caps', () => {
    expect(
      resolveScenario(
        'Squeeze a museum and coffee between 2pm hotel check-in and 7pm dinner watching rain and walking time',
      ),
    ).toBe('afternoon_gap');
    expect(
      resolveScenario(
        'Plan a weekend trip under $650 in Trip Studio comparing 3 neighborhood hotels',
      ),
    ).toBe('weekend_budget');
    expect(resolveScenario('Stroller-friendly rainy day with kids and indoor science')).toBe(
      'rainy_family',
    );
    expect(extractBudgetCap('weekend trip under $525 comparing hotels', 650)).toBe(525);
  });

  it('composes genuinely distinct, valid A2UI component trees across all scenarios', () => {
    const signatures = new Set<string>();
    for (const scenario of SCENARIO_IDS) {
      const composed = composeTripStudio(`Test ${scenario}`, scenario);
      expect(validationErrors(composed.a2ui)).toEqual([]);

      const createMsg = composed.a2ui.find(m => 'createSurface' in m);
      expect(
        createMsg && 'createSurface' in createMsg && createMsg.createSurface.sendDataModel,
      ).toBe(true);

      const comps = componentsOf(composed.a2ui);
      for (const comp of comps) {
        expect(comp.id).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(comp.id).not.toContain('-');
      }

      const types = comps.map(c => c.component);
      signatures.add(types.join('>'));

      if (scenario === 'afternoon_gap') {
        expect(types).toContain('WeatherRibbon');
        expect(types).not.toContain('BudgetSplitBar');
        const tl = comps.find(c => c.component === 'TimelineStrip');
        expect(tl?.['activeChild']).toBe('swap_stop_deck');
      } else if (scenario === 'weekend_budget') {
        expect(types).toContain('BudgetSplitBar');
        expect(types).not.toContain('WeatherRibbon');
        const tl = comps.find(c => c.component === 'TimelineStrip');
        expect(tl?.['activeChild']).toBeUndefined();
      } else if (scenario === 'rainy_family') {
        expect(types).toContain('WeatherRibbon');
        expect(types).toContain('BudgetSplitBar');
      }

      const model = dataModelOf(composed.a2ui);
      expect(jsonBytes(model)).toBeLessThan(MAX_DATA_MODEL_BYTES);
      const keys = collectObjectKeys(model);
      expect(keys.has('path')).toBe(false);
    }
    expect(signatures.size).toBe(3);
  });
});
