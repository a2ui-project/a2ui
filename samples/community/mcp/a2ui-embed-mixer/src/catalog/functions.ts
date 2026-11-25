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
 * Shared reactive catalog function `computeMixTotals(items, targets)` and
 * strongly typed domain models used by both the browser catalog and server composer.
 */

import {z} from 'zod';

import {createFunctionImplementation, spec} from '@a2ui/web_core/v1_0';

export type MixerIconKind =
  | 'bowl'
  | 'skillet'
  | 'grain'
  | 'greens'
  | 'card'
  | 'vault'
  | 'shield'
  | 'run'
  | 'weights'
  | 'sleep'
  | 'sun'
  | 'home'
  | 'rocket'
  | 'heart'
  | 'clock';

export interface MixOption {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly effects: Readonly<Record<string, number>>;
}

export interface MixItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: MixerIconKind;
  readonly scale: number;
  readonly unitHint: string;
  readonly activeOptionId: string;
  readonly recommendedId: string;
  readonly options: readonly MixOption[];
}

export type TargetDirection = 'band' | 'atLeast' | 'atMost';

export interface MixTarget {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly prefix?: string;
  readonly baseline?: number;
  readonly min: number;
  readonly max: number;
  readonly gaugeMax: number;
  readonly direction: TargetDirection;
  readonly targetLabel: string;
}

export interface ParetoMixAssignment {
  readonly scale: number;
  readonly activeOptionId: string;
}

export interface ParetoPreset {
  readonly id: string;
  readonly label: string;
  readonly recommended?: boolean;
  readonly x: number;
  readonly y: number;
  readonly mix: Readonly<Record<string, ParetoMixAssignment>>;
}

export interface PrepBlock {
  readonly id: string;
  readonly label: string;
  readonly startMin: number;
  readonly durationMin: number;
  readonly accent: 'blue' | 'teal' | 'amber' | 'violet';
  readonly itemId?: string;
  readonly optionLabels?: Readonly<Record<string, string>>;
  readonly optionTracks?: Readonly<Record<string, string>>;
  readonly optionDurations?: Readonly<Record<string, number>>;
}

export interface PrepTrack {
  readonly id: string;
  readonly name: string;
  readonly blocks: readonly PrepBlock[];
}

export interface ComputedMetric {
  readonly key: string;
  readonly label: string;
  readonly formatted: string;
  readonly targetLabel: string;
  readonly value: number;
  readonly ratio: number;
  readonly hit: boolean;
  readonly deltaLabel: string;
}

export interface ComputedMixTotals {
  readonly metrics: readonly ComputedMetric[];
  readonly hits: number;
  readonly total: number;
  readonly converged: boolean;
  readonly summaryLine: string;
  readonly valuesByKey: Readonly<Record<string, number>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Formats an integer or 1-decimal metric value with US grouping, prefix, and unit. */
export function formatMetricValue(value: number, prefix = '', unit = ''): string {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  const formattedNumber = rounded.toLocaleString('en-US', {
    maximumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
  });
  const tightUnit = /^(\/|[gmh](\s|\/|$))/.test(unit);
  const suffix = unit ? (tightUnit ? unit : ` ${unit}`) : '';
  return `${prefix}${formattedNumber}${suffix}`;
}

function formatCompactDelta(delta: number, prefix = '', unit = ''): string {
  const abs = Math.round(Math.abs(delta));
  const num = abs.toLocaleString('en-US');
  const shortUnit = unit.startsWith('/')
    ? ''
    : unit === 'kcal'
      ? ' kcal'
      : unit === 'mos'
        ? ' mos'
        : unit.startsWith('g')
          ? 'g'
          : /^m(\s|\/|$)/.test(unit)
            ? 'm'
            : unit
              ? ` ${unit}`
              : '';
  return `${prefix}${num}${shortUnit}`;
}

function resolveActiveOption(item: Record<string, unknown>): Record<string, unknown> | undefined {
  const options = item['options'];
  if (!Array.isArray(options) || options.length === 0) return undefined;
  const activeId = typeof item['activeOptionId'] === 'string' ? item['activeOptionId'] : '';
  const match = options.find(opt => isRecord(opt) && opt['id'] === activeId);
  const picked = match ?? options[0];
  return isRecord(picked) ? picked : undefined;
}

/** Pure evaluator backing `computeMixTotals(items, targets)`. */
export function evaluateMixTotals(rawItems: unknown, rawTargets: unknown): ComputedMixTotals {
  const items = Array.isArray(rawItems) ? rawItems.filter(isRecord) : [];
  const targets = Array.isArray(rawTargets) ? rawTargets.filter(isRecord) : [];

  const valuesByKey: Record<string, number> = {};
  const metrics: ComputedMetric[] = [];

  for (const target of targets) {
    const key = typeof target['key'] === 'string' ? target['key'] : '';
    if (!key) continue;
    const label = typeof target['label'] === 'string' ? target['label'] : key;
    const unit = typeof target['unit'] === 'string' ? target['unit'] : '';
    const prefix = typeof target['prefix'] === 'string' ? target['prefix'] : '';
    const baseline = typeof target['baseline'] === 'number' ? target['baseline'] : 0;
    const min = typeof target['min'] === 'number' ? target['min'] : 0;
    const max = typeof target['max'] === 'number' ? target['max'] : 100;
    const gaugeMax =
      typeof target['gaugeMax'] === 'number' && target['gaugeMax'] > 0
        ? target['gaugeMax']
        : Math.max(max, 1);
    const direction: TargetDirection =
      target['direction'] === 'atLeast' || target['direction'] === 'atMost'
        ? target['direction']
        : 'band';
    const targetLabel = typeof target['targetLabel'] === 'string' ? target['targetLabel'] : '';

    let rawSum = baseline;
    for (const item of items) {
      const scale = typeof item['scale'] === 'number' ? item['scale'] : 1;
      const active = resolveActiveOption(item);
      const effects = active && isRecord(active['effects']) ? active['effects'] : undefined;
      const effectValue =
        effects && typeof effects[key] === 'number' ? (effects[key] as number) : 0;
      rawSum += scale * effectValue;
    }

    const value = Math.max(0, Math.round(rawSum));
    valuesByKey[key] = value;

    let hit = false;
    let deltaLabel = 'In target';
    if (direction === 'atLeast') {
      hit = value >= min;
      deltaLabel = hit
        ? `+${formatCompactDelta(value - min, prefix, unit)} buffer`
        : `${formatCompactDelta(min - value, prefix, unit)} short`;
    } else if (direction === 'atMost') {
      hit = value <= max;
      deltaLabel = hit
        ? value === max
          ? 'On cap'
          : `${formatCompactDelta(max - value, prefix, unit)} under`
        : `+${formatCompactDelta(value - max, prefix, unit)} over`;
    } else {
      hit = value >= min && value <= max;
      if (!hit) {
        deltaLabel =
          value < min
            ? `${formatCompactDelta(min - value, prefix, unit)} low`
            : `+${formatCompactDelta(value - max, prefix, unit)} high`;
      } else {
        deltaLabel = 'In band';
      }
    }

    const ratio = Math.min(1, Math.max(0.06, value / gaugeMax));
    metrics.push({
      key,
      label,
      formatted: formatMetricValue(value, prefix, unit),
      targetLabel,
      value,
      ratio,
      hit,
      deltaLabel,
    });
  }

  const hits = metrics.filter(metric => metric.hit).length;
  const total = metrics.length;
  const converged = total > 0 && hits === total;
  const summaryLine = metrics.map(metric => metric.formatted).join(' · ');

  return {
    metrics,
    hits,
    total,
    converged,
    summaryLine,
    valuesByKey,
  };
}

export const computeMixTotals = createFunctionImplementation(
  {
    name: 'computeMixTotals',
    returnType: 'object',
    description:
      'Computes live aggregate goal metrics, radial gauge ratios, and target-band hit status from /items and /targets.',
    schema: spec(
      z
        .object({
          items: z
            .unknown()
            .describe(
              'REF:#/$defs/DynamicValue|Array of active mix items with scale and swap choices.',
            ),
          targets: z
            .unknown()
            .describe('REF:#/$defs/DynamicValue|Array of target band descriptors.'),
        })
        .strict(),
      {required: ['items', 'targets'], closure: 'unevaluatedProperties'},
    ),
  },
  args => evaluateMixTotals(args.items, args.targets) as unknown as Record<string, unknown>,
);
