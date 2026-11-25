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
 * Synthesizes bespoke multi-variable `ScenarioBlueprint` configurations with Gemini
 * for arbitrary user trade-off prompts, using flat arrays to avoid free-form map schema
 * collapse and deterministically calibrating target bands and Pareto coordinates.
 */

import {z} from 'zod';

import {
  evaluateMixTotals,
  formatMetricValue,
  type MixerIconKind,
  type MixItem,
  type MixOption,
  type MixTarget,
  type ParetoMixAssignment,
  type ParetoPreset,
  type PrepBlock,
  type PrepTrack,
} from '../catalog/functions.js';
import {LAYOUT_MODES, type LayoutMode, type ScenarioBlueprint} from '../scenarios/presets.js';
import type {JsonModel} from './json_model.js';

export const DEFAULT_SYNTHESIS_TIMEOUT_MS = 32_000;

const ICON_SET: ReadonlySet<string> = new Set([
  'bowl',
  'skillet',
  'grain',
  'greens',
  'card',
  'vault',
  'shield',
  'run',
  'weights',
  'sleep',
  'sun',
  'home',
  'rocket',
  'heart',
  'clock',
]);

const RESERVED_KEYS = new Set(['path', '@path', 'call', '@call']);

function sanitizeIdentifier(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = cleaned ? (/^[a-z_]/.test(cleaned) ? cleaned : `k_${cleaned}`) : fallback;
  return RESERVED_KEYS.has(base) ? `m_${base.replace(/^@/, '')}` : base.slice(0, 36);
}

const RawEffectSchema = z.object({
  key: z.string().min(1).max(80),
  delta: z.number().finite(),
});

const RawOptionSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  note: z.string().min(1).max(200),
  effects: z.array(RawEffectSchema).min(1).max(12),
});

const RawItemSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(100),
  subtitle: z.string().min(1).max(180),
  icon: z.string().max(40).optional(),
  unitHint: z.string().max(60).optional(),
  recommendedId: z.string().min(1).max(80),
  options: z.array(RawOptionSchema).min(2).max(5),
});

const RawTargetSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  unit: z.string().max(32).default(''),
  prefix: z.string().max(8).optional(),
  baseline: z.number().finite().optional(),
  min: z.number().finite(),
  max: z.number().finite(),
  direction: z.enum(['band', 'atLeast', 'atMost']),
});

const RawPresetAssignmentSchema = z.object({
  itemId: z.string().min(1).max(80),
  scale: z.number().finite(),
  activeOptionId: z.string().min(1).max(80),
});

const RawPresetSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(60),
  recommended: z.boolean().optional(),
  mix: z.array(RawPresetAssignmentSchema).min(1).max(8),
});

const RawTrackBlockSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  startMin: z.number().min(0).max(600),
  durationMin: z.number().min(1).max(600),
  accent: z.enum(['blue', 'teal', 'amber', 'violet']).optional(),
  itemId: z.string().max(80).optional(),
});

const RawTrackSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(40),
  blocks: z.array(RawTrackBlockSchema).min(1).max(5),
});

const RawSynthesizedSchema = z.object({
  layoutMode: z.enum(LAYOUT_MODES),
  badge: z.string().min(1).max(60),
  title: z.string().min(1).max(120),
  subtitle: z.string().min(1).max(320),
  deliverableLabel: z.string().min(1).max(160),
  followUpButtonLabel: z.string().min(1).max(40),
  microNoteText: z.string().min(1).max(220).optional(),
  targets: z.array(RawTargetSchema).min(3).max(5),
  items: z.array(RawItemSchema).min(3).max(4),
  pareto: z
    .object({
      title: z.string().min(1).max(120),
      xKey: z.string().min(1).max(80),
      yKey: z.string().min(1).max(80),
      xLabel: z.string().min(1).max(60),
      yLabel: z.string().min(1).max(40),
      presets: z.array(RawPresetSchema).min(3).max(6),
    })
    .optional(),
  gantt: z
    .object({
      title: z.string().min(1).max(120),
      subtitle: z.string().min(1).max(80),
      totalMinutes: z.number().int().min(4).max(600),
      unitSuffix: z.string().min(1).max(12),
      tracks: z.array(RawTrackSchema).min(2).max(4),
    })
    .optional(),
});

const SYSTEM_PROMPT = [
  'You design interactive multi-goal trade-off models for the Goal Mixer A2UI v1.0 studio.',
  'Given any user multi-variable decision prompt, output ONE JSON object matching the exact schema below.',
  '',
  'HOW THE LIVE ENGINE COMPUTES METRICS:',
  '- Each target k has an optional `baseline` (default 0).',
  '- Each adjustable item i has `scale` in [0.5..2.0] (initially 1.0) and 3 mutually exclusive swap `options` (one `recommendedId`).',
  '- Live metric value for target k = Math.max(0, Math.round((target.baseline ?? 0) + sum_i(item.scale * activeOption.effects[k]))).',
  '- CRITICAL ARITHMETIC RULE: When every item is at `scale: 1.0` and set to its `recommendedId` option, EVERY one of the 4 targets MUST land strictly inside its target band (`atLeast`: value >= min; `atMost`: value <= max and value > 0; `band`: min <= value <= max), while alternative options or scales push 1-2 metrics into realistic trade-offs!',
  '- Use subtractive negative `delta` on `baseline` when modeling remaining cash cushion, payback years shaved, debt months reduced, or bedtime buffer minutes left.',
  '',
  'LAYOUT SELECTION (`layoutMode` — pick the best fit for the domain):',
  '- "rings_pareto_gantt": when the problem has BOTH a 2D cost/output trade-off AND parallel time/energy/dispatch tracks (e.g. solar + battery + heat-pump dispatch, meal prep + Sunday batch cook, event day timeline + budget). Provide BOTH `pareto` and `gantt`.',
  '- "rings_pareto": for budget, headcount, startup runway, financial surplus, or portfolio sizing trade-offs without a daily timeline. Provide `pareto` and omit `gantt`.',
  '- "rings_gantt": for weekly training, half-marathon + strength + recovery, or family weeknight dinner/homework/bedtime routines where parallel time blocks are central. Provide `gantt` and omit `pareto`.',
  '- "pareto_hero": for sharp 2-axis location/option hunts like apartment commute vs rent vs space. Provide `pareto` and omit `gantt`.',
  '',
  'CONCISE STRING LIMITS & IDENTIFIER RULES:',
  '- All `id` and `key` strings must be lowercase `snake_case` (letters, digits, underscores; NEVER name any key "path").',
  '- Keep option `label` <= 20 chars (e.g. "8kW PV + 13kWh", "120 Guests Plated", "Rail Walk 8m") and `note` <= 52 chars.',
  '- Available `icon` names: "bowl", "skillet", "grain", "greens", "card", "vault", "shield", "run", "weights", "sleep", "sun", "home", "rocket", "heart", "clock".',
  '- Return ONLY valid JSON with flat arrays `effects: [{"key": "...", "delta": 120}]` and `mix: [{"itemId": "...", "scale": 1.0, "activeOptionId": "..."}]`:',
  '{',
  '  "layoutMode": "rings_pareto" | "rings_pareto_gantt" | "rings_gantt" | "pareto_hero",',
  '  "badge": "Short domain tag",',
  '  "title": "Problem-Specific Mixer Title",',
  '  "subtitle": "★ Recommended: concise 1-sentence recommendation with key numbers.",',
  '  "deliverableLabel": "concrete checklist or schedule deliverable",',
  '  "followUpButtonLabel": "Action plan ↗",',
  '  "microNoteText": "Short domain tip or constraint shown on the first tile.",',
  '  "targets": [4 objects: {"key","label","unit","prefix?","baseline?","min","max","direction":"atLeast"|"atMost"|"band"}],',
  '  "items": [3 or 4 objects: {"id","title","subtitle","icon","unitHint","recommendedId","options":[3 objects: {"id","label","note","effects":[{"key","delta"}]}]}],',
  '  "pareto": {"title","xKey","yKey","xLabel","yLabel","presets":[4 objects: {"id","label","recommended?","mix":[{"itemId","scale","activeOptionId"}]}]} (required unless layoutMode is rings_gantt),',
  '  "gantt": {"title","subtitle","totalMinutes":integer,"unitSuffix":"m"|"h"|"mo"|"wk","tracks":[3 objects: {"id","name","blocks":[{"id","label","startMin","durationMin","accent":"blue"|"teal"|"amber"|"violet","itemId?"}]}]} (required for rings_gantt and rings_pareto_gantt)',
  '}',
].join('\n');

function buildTargetLabel(target: {
  direction: 'band' | 'atLeast' | 'atMost';
  min: number;
  max: number;
  prefix?: string;
  unit: string;
}): string {
  const p = target.prefix ?? '';
  const u = target.unit;
  if (target.direction === 'atLeast') {
    return `>=${formatMetricValue(target.min, p, u)}`;
  }
  if (target.direction === 'atMost') {
    return `<=${formatMetricValue(target.max, p, u)}`;
  }
  return `${p}${target.min.toLocaleString('en-US')}–${formatMetricValue(target.max, p, u)}`;
}

function applyAssignments(
  items: readonly MixItem[],
  mix: Readonly<Record<string, ParetoMixAssignment>>,
): MixItem[] {
  return items.map(item => {
    const picked = mix[item.id];
    return picked
      ? {...item, scale: picked.scale, activeOptionId: picked.activeOptionId}
      : {...item};
  });
}

/**
 * Validates, sanitizes, and mathematically calibrates raw Gemini output into a
 * guaranteed-valid `ScenarioBlueprint` whose recommended `1.0x` mix hits 4/4 targets.
 */
export function normalizeSynthesizedBlueprint(raw: unknown): ScenarioBlueprint {
  const parsed = RawSynthesizedSchema.parse(raw);

  const selectedTargets = parsed.targets.slice(0, 4);
  const keyMap = new Map<string, string>();
  selectedTargets.forEach((t, idx) => {
    keyMap.set(t.key, sanitizeIdentifier(t.key, `metric_${idx + 1}`));
  });

  const itemIdMap = new Map<string, string>();
  const items: MixItem[] = parsed.items.slice(0, 4).map((rawItem, idx) => {
    const itemId = sanitizeIdentifier(rawItem.id, `item_${idx + 1}`);
    itemIdMap.set(rawItem.id, itemId);

    const optIdMap = new Map<string, string>();
    const options: MixOption[] = rawItem.options.slice(0, 3).map((rawOpt, optIdx) => {
      const optId = sanitizeIdentifier(rawOpt.id, `opt_${idx + 1}_${optIdx + 1}`);
      optIdMap.set(rawOpt.id, optId);
      const effects: Record<string, number> = {};
      for (const eff of rawOpt.effects) {
        const mappedKey = keyMap.get(eff.key) ?? sanitizeIdentifier(eff.key, 'metric_1');
        effects[mappedKey] = eff.delta;
      }
      return {
        id: optId,
        label: rawOpt.label,
        note: rawOpt.note,
        effects,
      };
    });

    const recId = optIdMap.get(rawItem.recommendedId) ?? options[0]!.id;
    const icon: MixerIconKind =
      rawItem.icon && ICON_SET.has(rawItem.icon) ? (rawItem.icon as MixerIconKind) : 'clock';

    return {
      id: itemId,
      title: rawItem.title,
      subtitle: rawItem.subtitle,
      icon,
      scale: 1.0,
      unitHint: rawItem.unitHint ?? '1.0x',
      activeOptionId: recId,
      recommendedId: recId,
      options,
    };
  });

  // First-pass target construction and calibration so recommended 1.0x mix is positive & in-band.
  const preliminaryTargets: MixTarget[] = selectedTargets.map((t, idx) => {
    const key = keyMap.get(t.key) ?? `metric_${idx + 1}`;
    const min = Math.min(t.min, t.max);
    const max = Math.max(t.min, t.max);
    return {
      key,
      label: t.label,
      unit: t.unit,
      ...(t.prefix ? {prefix: t.prefix} : {}),
      ...(t.baseline !== undefined ? {baseline: t.baseline} : {}),
      min,
      max,
      gaugeMax: Math.max(max * 1.25, 10),
      direction: t.direction,
      targetLabel: '',
    };
  });

  const initialTotals = evaluateMixTotals(items, preliminaryTargets);
  const targets: MixTarget[] = preliminaryTargets.map(t => {
    const val = initialTotals.valuesByKey[t.key] ?? 0;
    if (!Number.isFinite(val) || val <= 0) {
      throw new Error(`Synthesized metric "${t.key}" evaluated to non-positive value ${val}.`);
    }
    let min = t.min;
    let max = t.max;
    if (t.direction === 'atLeast' && val < min) {
      min = Math.max(1, Math.floor(val * 0.95));
      max = Math.max(max, Math.ceil(val * 1.4));
    } else if (t.direction === 'atMost' && val > max) {
      max = Math.ceil(val * 1.05);
    } else if (t.direction === 'band' && (val < min || val > max)) {
      min = Math.min(min, Math.floor(val * 0.93));
      max = Math.max(max, Math.ceil(val * 1.07));
    }
    const gaugeMax = Math.max(Math.ceil(val * 1.35), Math.ceil(max * 1.2), 10);
    return {
      ...t,
      min,
      max,
      gaugeMax,
      targetLabel: buildTargetLabel({...t, min, max}),
    };
  });

  let layoutMode: LayoutMode = parsed.layoutMode;
  const targetKeys = new Set(targets.map(t => t.key));

  // Build Pareto config when provided and valid.
  let pareto: ScenarioBlueprint['pareto'];
  if (parsed.pareto) {
    const xKey =
      keyMap.get(parsed.pareto.xKey) ??
      (targetKeys.has(parsed.pareto.xKey) ? parsed.pareto.xKey : targets[0]!.key);
    const yKeyCandidate =
      keyMap.get(parsed.pareto.yKey) ??
      (targetKeys.has(parsed.pareto.yKey) ? parsed.pareto.yKey : targets[1]!.key);
    const yKey = yKeyCandidate === xKey ? targets[1]!.key : yKeyCandidate;

    const presets: ParetoPreset[] = parsed.pareto.presets.slice(0, 4).map((rawPreset, pIdx) => {
      const mix: Record<string, ParetoMixAssignment> = {};
      for (const entry of rawPreset.mix) {
        const mappedItemId = itemIdMap.get(entry.itemId) ?? sanitizeIdentifier(entry.itemId, '');
        const itemObj = items.find(i => i.id === mappedItemId);
        if (!itemObj) continue;
        const optMatch =
          itemObj.options.find(
            o =>
              o.id === sanitizeIdentifier(entry.activeOptionId, '') ||
              o.id === entry.activeOptionId,
          ) ?? itemObj.options[0]!;
        const snappedScale = Math.min(2.0, Math.max(0.5, Math.round(entry.scale * 4) / 4));
        mix[itemObj.id] = {scale: snappedScale, activeOptionId: optMatch.id};
      }
      const evalPreset = evaluateMixTotals(applyAssignments(items, mix), targets);
      return {
        id: sanitizeIdentifier(rawPreset.id, `preset_${pIdx + 1}`),
        label: rawPreset.label,
        ...(rawPreset.recommended ? {recommended: true} : {}),
        x: evalPreset.valuesByKey[xKey] ?? 0,
        y: evalPreset.valuesByKey[yKey] ?? 0,
        mix,
      };
    });

    if (!presets.some(p => p.recommended)) {
      const recMix: Record<string, ParetoMixAssignment> = {};
      for (const item of items) {
        recMix[item.id] = {scale: 1.0, activeOptionId: item.recommendedId};
      }
      const recEval = evaluateMixTotals(items, targets);
      presets[0] = {
        id: 'preset_recommended',
        label: '★ Recommended',
        recommended: true,
        x: recEval.valuesByKey[xKey] ?? 0,
        y: recEval.valuesByKey[yKey] ?? 0,
        mix: recMix,
      };
    }

    const liveEval = evaluateMixTotals(items, targets);
    const xs = [...presets.map(p => p.x), liveEval.valuesByKey[xKey] ?? 0];
    const ys = [...presets.map(p => p.y), liveEval.valuesByKey[yKey] ?? 0];
    const xTarget = targets.find(t => t.key === xKey)!;
    const yTarget = targets.find(t => t.key === yKey)!;

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const spanX = Math.max(maxX - minX, Math.max(4, Math.round(maxX * 0.25)));
    const xDomain: readonly [number, number] = [
      Math.max(0, Math.floor(minX - spanX * 0.2)),
      Math.ceil(maxX + spanX * 0.2),
    ];

    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanY = Math.max(maxY - minY, Math.max(4, Math.round(maxY * 0.25)));
    const yDomain: readonly [number, number] = [
      Math.max(0, Math.floor(minY - spanY * 0.2)),
      Math.ceil(maxY + spanY * 0.2),
    ];

    const sweetSpot = {
      xMin: xTarget.direction === 'atMost' ? xDomain[0] : Math.max(xDomain[0], xTarget.min),
      xMax: xTarget.direction === 'atLeast' ? xDomain[1] : Math.min(xDomain[1], xTarget.max),
      yMin: yTarget.direction === 'atMost' ? yDomain[0] : Math.max(yDomain[0], yTarget.min),
      yMax: yTarget.direction === 'atLeast' ? yDomain[1] : Math.min(yDomain[1], yTarget.max),
    };

    pareto = {
      title: parsed.pareto.title,
      xKey,
      yKey,
      xLabel: parsed.pareto.xLabel,
      yLabel: parsed.pareto.yLabel,
      xDomain,
      yDomain,
      sweetSpot,
      presets,
    };
  }

  let gantt: ScenarioBlueprint['gantt'];
  if (parsed.gantt) {
    const totalMinutes = parsed.gantt.totalMinutes;
    const tracks: PrepTrack[] = parsed.gantt.tracks.slice(0, 3).map((t, tIdx) => ({
      id: sanitizeIdentifier(t.id, `track_${tIdx + 1}`),
      name: t.name.slice(0, 14),
      blocks: t.blocks.slice(0, 3).map((b, bIdx): PrepBlock => {
        const startMin = Math.min(totalMinutes - 2, Math.max(0, Math.round(b.startMin)));
        const durationMin = Math.max(
          2,
          Math.min(totalMinutes - startMin, Math.round(b.durationMin)),
        );
        const mappedItem = b.itemId ? itemIdMap.get(b.itemId) : undefined;
        return {
          id: sanitizeIdentifier(b.id, `blk_${tIdx + 1}_${bIdx + 1}`),
          label: b.label,
          startMin,
          durationMin,
          accent:
            b.accent ?? (['teal', 'blue', 'amber', 'violet'][bIdx % 4] as PrepBlock['accent']),
          ...(mappedItem ? {itemId: mappedItem} : {}),
        };
      }),
    }));
    gantt = {
      title: parsed.gantt.title,
      subtitle: parsed.gantt.subtitle,
      totalMinutes,
      unitSuffix: parsed.gantt.unitSuffix,
      tracks,
    };
  }

  // Reconcile layoutMode with available pareto/gantt views.
  if (layoutMode === 'rings_pareto_gantt' && (!pareto || !gantt)) {
    layoutMode = pareto ? 'rings_pareto' : gantt ? 'rings_gantt' : 'rings_pareto';
  }
  if ((layoutMode === 'rings_pareto' || layoutMode === 'pareto_hero') && !pareto) {
    if (gantt) layoutMode = 'rings_gantt';
    else throw new Error(`Layout ${layoutMode} requires pareto configuration.`);
  }
  if (layoutMode === 'rings_gantt' && !gantt) {
    if (pareto) layoutMode = 'rings_pareto';
    else throw new Error('Layout rings_gantt requires gantt configuration.');
  }

  return {
    id: 'custom',
    layoutMode,
    source: 'gemini',
    badge: parsed.badge.slice(0, 32),
    title: parsed.title.slice(0, 90),
    subtitle: (parsed.subtitle.startsWith('★') ? parsed.subtitle : `★ ${parsed.subtitle}`).slice(
      0,
      200,
    ),
    deliverableLabel: parsed.deliverableLabel.slice(0, 90),
    followUpButtonLabel: parsed.followUpButtonLabel.slice(0, 24),
    ...(parsed.microNoteText
      ? {microNote: {itemId: items[0]!.id, text: parsed.microNoteText, tone: 'tip' as const}}
      : {}),
    targets,
    items,
    ...(pareto ? {pareto} : {}),
    ...(gantt ? {gantt} : {}),
  };
}

export async function synthesizeBlueprint(
  prompt: string,
  model: JsonModel,
  timeoutMs = DEFAULT_SYNTHESIS_TIMEOUT_MS,
): Promise<ScenarioBlueprint> {
  const signal = AbortSignal.timeout(timeoutMs);
  const raw = await model.generateJson({
    system: SYSTEM_PROMPT,
    prompt: `Design a bespoke multi-goal trade-off mixer for this user request:\n<user_problem>\n${prompt.slice(0, 2000)}\n</user_problem>`,
    signal,
  });
  return normalizeSynthesizedBlueprint(raw);
}
