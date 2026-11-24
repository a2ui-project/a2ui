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
 * Multi-goal scenario definitions (`meal_prep`, `debt_savings`, `training_week`),
 * natural-language prompt routing, and target-band snapping.
 */

import {
  evaluateMixTotals,
  type MixItem,
  type MixTarget,
  type ParetoMixAssignment,
  type ParetoPreset,
  type PrepTrack,
} from '../catalog/functions.js';

export const SCENARIO_IDS = ['meal_prep', 'debt_savings', 'training_week'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export interface ScenarioBlueprint {
  readonly id: ScenarioId;
  readonly badge: string;
  readonly title: string;
  readonly subtitle: string;
  readonly deliverableLabel: string;
  readonly followUpButtonLabel: string;
  readonly microNote?: {
    readonly itemId: string;
    readonly text: string;
    readonly tone: 'tip' | 'constraint';
  };
  readonly targets: readonly MixTarget[];
  readonly items: readonly MixItem[];
  readonly pareto?: {
    readonly title: string;
    readonly xKey: string;
    readonly yKey: string;
    readonly xLabel: string;
    readonly yLabel: string;
    readonly xDomain: readonly [number, number];
    readonly yDomain: readonly [number, number];
    readonly sweetSpot: {
      readonly xMin: number;
      readonly xMax: number;
      readonly yMin: number;
      readonly yMax: number;
    };
    readonly presets: readonly ParetoPreset[];
  };
  readonly gantt?: {
    readonly title: string;
    readonly subtitle: string;
    readonly totalMinutes: number;
    readonly tracks: readonly PrepTrack[];
  };
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

function buildPreset(
  id: string,
  label: string,
  mix: Readonly<Record<string, ParetoMixAssignment>>,
  items: readonly MixItem[],
  targets: readonly MixTarget[],
  xKey: string,
  yKey: string,
  recommended = false,
): ParetoPreset {
  const evaluated = evaluateMixTotals(applyAssignments(items, mix), targets);
  return {
    id,
    label,
    ...(recommended ? {recommended: true} : {}),
    x: evaluated.valuesByKey[xKey] ?? 0,
    y: evaluated.valuesByKey[yKey] ?? 0,
    mix,
  };
}

const MEAL_ITEMS: readonly MixItem[] = [
  {
    id: 'breakfast',
    title: 'Breakfast anchor',
    subtitle: '5x weekday grab-and-go',
    icon: 'bowl',
    scale: 1.0,
    unitHint: '5 jars',
    activeOptionId: 'greek_yogurt',
    recommendedId: 'greek_yogurt',
    options: [
      {
        id: 'greek_yogurt',
        label: 'Greek yogurt',
        note: '38g protein · 2m no-cook jar',
        effects: {kcal: 420, protein: 38, cost: 13, prep: 2},
      },
      {
        id: 'eggs',
        label: 'Eggs',
        note: '32g protein · 5m jammy batch',
        effects: {kcal: 460, protein: 32, cost: 10, prep: 5},
      },
      {
        id: 'tofu',
        label: 'Tofu',
        note: '34g protein · 6m herb scramble',
        effects: {kcal: 410, protein: 34, cost: 9, prep: 6},
      },
    ],
  },
  {
    id: 'main_protein',
    title: 'Main protein batch',
    subtitle: 'Lunch + dinner anchor',
    icon: 'skillet',
    scale: 1.0,
    unitHint: '2.2 lb',
    activeOptionId: 'herb_chicken',
    recommendedId: 'herb_chicken',
    options: [
      {
        id: 'herb_chicken',
        label: 'Herb chicken',
        note: '68g protein · sheet-pan thighs',
        effects: {kcal: 640, protein: 68, cost: 22, prep: 5},
      },
      {
        id: 'salmon',
        label: 'Salmon',
        note: '62g protein · miso broil',
        effects: {kcal: 710, protein: 62, cost: 32, prep: 4},
      },
      {
        id: 'tempeh',
        label: 'Tempeh',
        note: '54g protein · smoky citrus glaze',
        effects: {kcal: 610, protein: 54, cost: 15, prep: 6},
      },
    ],
  },
  {
    id: 'carb_base',
    title: 'Slow-carb base',
    subtitle: 'Cook once, portion 5x',
    icon: 'grain',
    scale: 1.0,
    unitHint: '5 bowls',
    activeOptionId: 'quinoa_rice',
    recommendedId: 'quinoa_rice',
    options: [
      {
        id: 'quinoa_rice',
        label: 'Quinoa blend',
        note: '21g protein · pot simmer',
        effects: {kcal: 510, protein: 21, cost: 12, prep: 4},
      },
      {
        id: 'sweet_potato',
        label: 'Sweet potato',
        note: '12g protein · oven wedges',
        effects: {kcal: 470, protein: 12, cost: 9, prep: 5},
      },
      {
        id: 'pouch_grains',
        label: '90s pouches',
        note: '18g protein · 1m microwave',
        effects: {kcal: 520, protein: 18, cost: 19, prep: 1},
      },
    ],
  },
  {
    id: 'greens_boost',
    title: 'Greens & protein snack',
    subtitle: 'Afternoon + crunch side',
    icon: 'greens',
    scale: 1.0,
    unitHint: '5 packs',
    activeOptionId: 'edamame_slaw',
    recommendedId: 'edamame_slaw',
    options: [
      {
        id: 'edamame_slaw',
        label: 'Edamame slaw',
        note: '18g protein · crisp sesame',
        effects: {kcal: 280, protein: 18, cost: 15, prep: 3},
      },
      {
        id: 'charred_broc',
        label: 'Roasted broc',
        note: '14g protein · lemon tahini',
        effects: {kcal: 260, protein: 14, cost: 11, prep: 4},
      },
      {
        id: 'whey_berries',
        label: 'Whey + berries',
        note: '26g protein · 1m shake',
        effects: {kcal: 270, protein: 26, cost: 20, prep: 1},
      },
    ],
  },
];

const MEAL_TARGETS: readonly MixTarget[] = [
  {
    key: 'kcal',
    label: 'Daily calories',
    unit: 'kcal',
    min: 1750,
    max: 1950,
    gaugeMax: 2300,
    direction: 'band',
    targetLabel: '1,750–1,950',
  },
  {
    key: 'protein',
    label: 'Daily protein',
    unit: 'g protein',
    min: 140,
    max: 210,
    gaugeMax: 185,
    direction: 'atLeast',
    targetLabel: '>=140g',
  },
  {
    key: 'cost',
    label: 'Weekly grocery',
    prefix: '$',
    unit: '/wk',
    min: 0,
    max: 65,
    gaugeMax: 95,
    direction: 'atMost',
    targetLabel: '<=$65/wk',
  },
  {
    key: 'prep',
    label: 'Weekday prep',
    unit: 'm prep',
    min: 0,
    max: 15,
    gaugeMax: 28,
    direction: 'atMost',
    targetLabel: '<=15m',
  },
];

const DEBT_ITEMS: readonly MixItem[] = [
  {
    id: 'apr_paydown',
    title: 'High-APR debt paydown',
    subtitle: '23.9% revolving balance',
    icon: 'card',
    scale: 1.0,
    unitHint: '$620/mo',
    activeOptionId: 'avalanche',
    recommendedId: 'avalanche',
    options: [
      {
        id: 'avalanche',
        label: 'Avalanche $620',
        note: 'Shaves 12 mos · saves $1,380 interest',
        effects: {cushion: -620, debt_months: -12, interest_saved: 1380, emergency_fund: 0},
      },
      {
        id: 'snowball',
        label: 'Snowball $520',
        note: 'Clears small card month 2',
        effects: {cushion: -520, debt_months: -10, interest_saved: 1120, emergency_fund: 0},
      },
      {
        id: 'min_plus',
        label: 'Min + $180',
        note: 'Keeps extra cash liquid',
        effects: {cushion: -340, debt_months: -5, interest_saved: 580, emergency_fund: 0},
      },
    ],
  },
  {
    id: 'emergency_vault',
    title: 'Emergency HYSA transfer',
    subtitle: '4.6% APY liquid reserve',
    icon: 'vault',
    scale: 1.0,
    unitHint: '$380/mo',
    activeOptionId: 'steady_hysa',
    recommendedId: 'steady_hysa',
    options: [
      {
        id: 'steady_hysa',
        label: 'Auto $380',
        note: '+$2,280 reserve over 6 mos',
        effects: {cushion: -380, debt_months: 0, interest_saved: 60, emergency_fund: 2280},
      },
      {
        id: 'seed_buffer',
        label: 'Seed $220',
        note: 'Frees cash for faster payoff',
        effects: {cushion: -220, debt_months: 0, interest_saved: 35, emergency_fund: 1320},
      },
      {
        id: 'fortress_hysa',
        label: 'Fortress $540',
        note: 'Builds 3-month runway fast',
        effects: {cushion: -540, debt_months: 0, interest_saved: 90, emergency_fund: 3240},
      },
    ],
  },
  {
    id: 'sinking_shield',
    title: 'Irregular bills shield',
    subtitle: 'Auto & medical sinking fund',
    icon: 'shield',
    scale: 1.0,
    unitHint: '$180/mo',
    activeOptionId: 'guarded',
    recommendedId: 'guarded',
    options: [
      {
        id: 'guarded',
        label: 'Shield $180',
        note: 'Stops surprise card swipes',
        effects: {cushion: -180, debt_months: -1, interest_saved: 80, emergency_fund: 540},
      },
      {
        id: 'lean_shield',
        label: 'Lean $90',
        note: 'Covers essentials only',
        effects: {cushion: -90, debt_months: 0, interest_saved: 30, emergency_fund: 270},
      },
      {
        id: 'full_sinking',
        label: 'Full $260',
        note: 'Covers car, dental & travel',
        effects: {cushion: -260, debt_months: -1, interest_saved: 110, emergency_fund: 780},
      },
    ],
  },
];

const DEBT_TARGETS: readonly MixTarget[] = [
  {
    key: 'cushion',
    label: 'Monthly cushion',
    prefix: '$',
    unit: '/mo',
    baseline: 1500,
    min: 280,
    max: 1500,
    gaugeMax: 750,
    direction: 'atLeast',
    targetLabel: '>=$280/mo',
  },
  {
    key: 'debt_months',
    label: 'Debt-free months',
    unit: 'mos',
    baseline: 26,
    min: 1,
    max: 15,
    gaugeMax: 26,
    direction: 'atMost',
    targetLabel: '<=15 mos',
  },
  {
    key: 'interest_saved',
    label: 'Interest saved',
    prefix: '$',
    unit: '',
    baseline: 0,
    min: 1100,
    max: 3200,
    gaugeMax: 2100,
    direction: 'atLeast',
    targetLabel: '>=$1,100',
  },
  {
    key: 'emergency_fund',
    label: 'Emergency fund',
    prefix: '$',
    unit: '',
    baseline: 1800,
    min: 4200,
    max: 9500,
    gaugeMax: 6200,
    direction: 'atLeast',
    targetLabel: '>=$4,200',
  },
];

const TRAINING_ITEMS: readonly MixItem[] = [
  {
    id: 'aerobic_block',
    title: 'Zone 2 aerobic engine',
    subtitle: 'Morning conversational sessions',
    icon: 'run',
    scale: 1.0,
    unitHint: '3x / wk',
    activeOptionId: 'tempo_mix',
    recommendedId: 'tempo_mix',
    options: [
      {
        id: 'tempo_mix',
        label: '2x Run + 1x Spin',
        note: '150m Zone 2 · low joint stress',
        effects: {zone2: 150, sets: 2, recovery: -12, hours: 3},
      },
      {
        id: 'all_run',
        label: '4x Road run',
        note: '180m Zone 2 · higher impact',
        effects: {zone2: 180, sets: 0, recovery: -20, hours: 3},
      },
      {
        id: 'incline_erg',
        label: 'Row + incline',
        note: '140m Zone 2 · recovery friendly',
        effects: {zone2: 140, sets: 3, recovery: -8, hours: 2},
      },
    ],
  },
  {
    id: 'strength_block',
    title: 'Compound strength lift',
    subtitle: 'Full-body progressive overload',
    icon: 'weights',
    scale: 1.0,
    unitHint: '3x / wk',
    activeOptionId: 'upper_lower',
    recommendedId: 'upper_lower',
    options: [
      {
        id: 'upper_lower',
        label: '3x Full-body',
        note: '14 hard sets · balanced CNS load',
        effects: {zone2: 15, sets: 14, recovery: -14, hours: 3},
      },
      {
        id: 'power_hypertrophy',
        label: '4x Split',
        note: '18 hard sets · higher fatigue',
        effects: {zone2: 10, sets: 18, recovery: -22, hours: 4},
      },
      {
        id: 'kettlebell_min',
        label: '2x KB density',
        note: '10 hard sets · fast 35m lifts',
        effects: {zone2: 25, sets: 10, recovery: -8, hours: 1},
      },
    ],
  },
  {
    id: 'recovery_habit',
    title: 'Sleep & mobility anchor',
    subtitle: 'Evening parasympathetic buffer',
    icon: 'sleep',
    scale: 1.0,
    unitHint: 'Daily',
    activeOptionId: 'mobility_sleep',
    recommendedId: 'mobility_sleep',
    options: [
      {
        id: 'mobility_sleep',
        label: '8h + 15m mobility',
        note: '+38 recovery · keeps HRV green',
        effects: {zone2: 0, sets: 0, recovery: 38, hours: 1},
      },
      {
        id: 'sauna_stretch',
        label: 'Sauna + stretch',
        note: '+42 recovery · +2h weekly time',
        effects: {zone2: 10, sets: 0, recovery: 42, hours: 2},
      },
      {
        id: 'lights_out_only',
        label: '7.5h sleep only',
        note: '+26 recovery · zero extra time',
        effects: {zone2: 0, sets: 0, recovery: 26, hours: 0},
      },
    ],
  },
];

const TRAINING_TARGETS: readonly MixTarget[] = [
  {
    key: 'zone2',
    label: 'Zone 2 cardio',
    unit: 'm/wk',
    min: 150,
    max: 260,
    gaugeMax: 220,
    direction: 'atLeast',
    targetLabel: '>=150m',
  },
  {
    key: 'sets',
    label: 'Strength volume',
    unit: 'sets',
    min: 14,
    max: 24,
    gaugeMax: 22,
    direction: 'atLeast',
    targetLabel: '>=14 sets',
  },
  {
    key: 'recovery',
    label: 'Recovery readiness',
    baseline: 72,
    unit: 'pts',
    min: 80,
    max: 100,
    gaugeMax: 100,
    direction: 'atLeast',
    targetLabel: '>=80 pts',
  },
  {
    key: 'hours',
    label: 'Weekly training',
    unit: 'h/wk',
    min: 0,
    max: 8,
    gaugeMax: 11,
    direction: 'atMost',
    targetLabel: '<=8h/wk',
  },
];

/** Classifies a natural-language prompt into one of the 3 scenarios when `scenario` is omitted. */
export function inferScenario(prompt: string, explicit?: ScenarioId): ScenarioId {
  if (explicit) return explicit;
  const lower = prompt.toLowerCase();
  if (
    /\b(debt|loan|apr|savings|emergency fund|cushion|surplus|payoff|paydown|hysa|credit card|cash)\b/.test(
      lower,
    )
  ) {
    return 'debt_savings';
  }
  if (
    /\b(train|workout|zone\s*2|cardio|marathon|lift|hypertrophy|recovery|hrv|gym)\b/.test(lower)
  ) {
    return 'training_week';
  }
  return 'meal_prep';
}

export function getScenarioBlueprint(scenario: ScenarioId): ScenarioBlueprint {
  if (scenario === 'debt_savings') {
    const presets: ParetoPreset[] = [
      buildPreset(
        'preset_blitz',
        '10m Debt Blitz',
        {
          apr_paydown: {scale: 1.25, activeOptionId: 'avalanche'},
          emergency_vault: {scale: 0.75, activeOptionId: 'seed_buffer'},
          sinking_shield: {scale: 1.0, activeOptionId: 'guarded'},
        },
        DEBT_ITEMS,
        DEBT_TARGETS,
        'debt_months',
        'cushion',
      ),
      buildPreset(
        'preset_balanced',
        '★ Balanced 13m',
        {
          apr_paydown: {scale: 1.0, activeOptionId: 'avalanche'},
          emergency_vault: {scale: 1.0, activeOptionId: 'steady_hysa'},
          sinking_shield: {scale: 1.0, activeOptionId: 'guarded'},
        },
        DEBT_ITEMS,
        DEBT_TARGETS,
        'debt_months',
        'cushion',
        true,
      ),
      buildPreset(
        'preset_snowball',
        '16m Extra Cushion',
        {
          apr_paydown: {scale: 1.0, activeOptionId: 'snowball'},
          emergency_vault: {scale: 1.0, activeOptionId: 'steady_hysa'},
          sinking_shield: {scale: 1.0, activeOptionId: 'lean_shield'},
        },
        DEBT_ITEMS,
        DEBT_TARGETS,
        'debt_months',
        'cushion',
      ),
      buildPreset(
        'preset_liquidity',
        '21m Max Cash',
        {
          apr_paydown: {scale: 1.0, activeOptionId: 'min_plus'},
          emergency_vault: {scale: 1.0, activeOptionId: 'steady_hysa'},
          sinking_shield: {scale: 1.0, activeOptionId: 'lean_shield'},
        },
        DEBT_ITEMS,
        DEBT_TARGETS,
        'debt_months',
        'cushion',
      ),
    ];

    return {
      id: 'debt_savings',
      badge: 'Surplus allocator',
      title: 'Debt Payoff vs Emergency Reserve Mixer',
      subtitle:
        '★ Recommended: $620 APR avalanche + $380 HYSA + $180 shield clears debt in 13 mos while keeping $320/mo cash cushion.',
      deliverableLabel: 'monthly auto-transfer & APR payoff schedule',
      followUpButtonLabel: 'Action plan ↗',
      microNote: {
        itemId: 'apr_paydown',
        text: '23.9% APR card goes first; $180 shield prevents re-borrowing.',
        tone: 'tip',
      },
      targets: DEBT_TARGETS,
      items: structuredClone(DEBT_ITEMS) as MixItem[],
      pareto: {
        title: 'Months to Debt-Free vs Monthly Cushion',
        xKey: 'debt_months',
        yKey: 'cushion',
        xLabel: 'Months to Debt-Free',
        yLabel: 'Cushion $',
        xDomain: [8, 24],
        yDomain: [150, 760],
        sweetSpot: {xMin: 8, xMax: 15, yMin: 280, yMax: 760},
        presets,
      },
    };
  }

  if (scenario === 'training_week') {
    return {
      id: 'training_week',
      badge: 'Hybrid microcycle',
      title: 'Endurance, Strength & Recovery Mixer',
      subtitle:
        '★ Recommended: 2x run + 1x spin with 3x full-body lifts and 15m nightly mobility hits 84 readiness in 7h/wk.',
      deliverableLabel: '7-day training & recovery checklist',
      followUpButtonLabel: 'Week plan ↗',
      targets: TRAINING_TARGETS,
      items: structuredClone(TRAINING_ITEMS) as MixItem[],
      gantt: {
        title: 'Weekly Block Allocation (90m peak day window)',
        subtitle: '3 non-competing energy tracks',
        totalMinutes: 90,
        tracks: [
          {
            id: 'am_cardio',
            name: 'AM Aerobic',
            blocks: [
              {
                id: 'blk_z2',
                label: 'Zone 2 Run/Spin',
                startMin: 5,
                durationMin: 45,
                accent: 'teal',
                itemId: 'aerobic_block',
                optionLabels: {
                  tempo_mix: 'Zone 2 Run + Spin',
                  all_run: 'Road Aerobic Run',
                  incline_erg: 'Erg + Incline Walk',
                },
              },
            ],
          },
          {
            id: 'pm_lift',
            name: 'PM Lift',
            blocks: [
              {
                id: 'blk_lift',
                label: 'Compound Full-Body',
                startMin: 20,
                durationMin: 48,
                accent: 'blue',
                itemId: 'strength_block',
                optionLabels: {
                  upper_lower: '3x Compound Lift',
                  power_hypertrophy: '4x Split Volume',
                  kettlebell_min: '35m KB Density',
                },
                optionDurations: {
                  upper_lower: 48,
                  power_hypertrophy: 58,
                  kettlebell_min: 35,
                },
              },
            ],
          },
          {
            id: 'eve_rec',
            name: 'PM Recovery',
            blocks: [
              {
                id: 'blk_mob',
                label: '15m Mobility + 8h',
                startMin: 62,
                durationMin: 22,
                accent: 'violet',
                itemId: 'recovery_habit',
                optionLabels: {
                  mobility_sleep: '15m Mobility + Sleep',
                  sauna_stretch: 'Sauna + Stretch',
                  lights_out_only: 'Wind-down Only',
                },
              },
            ],
          },
        ],
      },
    };
  }

  const mealPresets: ParetoPreset[] = [
    buildPreset(
      'preset_no_cook',
      '8m No-Cook',
      {
        breakfast: {scale: 1.0, activeOptionId: 'greek_yogurt'},
        main_protein: {scale: 1.0, activeOptionId: 'salmon'},
        carb_base: {scale: 1.0, activeOptionId: 'pouch_grains'},
        greens_boost: {scale: 1.0, activeOptionId: 'whey_berries'},
      },
      MEAL_ITEMS,
      MEAL_TARGETS,
      'prep',
      'cost',
    ),
    buildPreset(
      'preset_express',
      '12m Express',
      {
        breakfast: {scale: 1.0, activeOptionId: 'greek_yogurt'},
        main_protein: {scale: 1.0, activeOptionId: 'herb_chicken'},
        carb_base: {scale: 1.0, activeOptionId: 'quinoa_rice'},
        greens_boost: {scale: 1.0, activeOptionId: 'whey_berries'},
      },
      MEAL_ITEMS,
      MEAL_TARGETS,
      'prep',
      'cost',
    ),
    buildPreset(
      'preset_balanced',
      '★ Balanced $62',
      {
        breakfast: {scale: 1.0, activeOptionId: 'greek_yogurt'},
        main_protein: {scale: 1.0, activeOptionId: 'herb_chicken'},
        carb_base: {scale: 1.0, activeOptionId: 'quinoa_rice'},
        greens_boost: {scale: 1.0, activeOptionId: 'edamame_slaw'},
      },
      MEAL_ITEMS,
      MEAL_TARGETS,
      'prep',
      'cost',
      true,
    ),
    buildPreset(
      'preset_plant_budget',
      '$44 Plant Saver',
      {
        breakfast: {scale: 1.0, activeOptionId: 'tofu'},
        main_protein: {scale: 1.0, activeOptionId: 'tempeh'},
        carb_base: {scale: 1.0, activeOptionId: 'sweet_potato'},
        greens_boost: {scale: 1.0, activeOptionId: 'charred_broc'},
      },
      MEAL_ITEMS,
      MEAL_TARGETS,
      'prep',
      'cost',
    ),
  ];

  return {
    id: 'meal_prep',
    badge: 'Meal & batch studio',
    title: 'Weekday High-Protein Meal & Batch Mixer',
    subtitle:
      '★ Recommended: Greek yogurt + sheet-pan herb chicken + quinoa + edamame hits 1,850 kcal & 145g protein at $62/wk and 14m/day.',
    deliverableLabel: 'grocery shopping & 45-min Sunday batch checklist',
    followUpButtonLabel: 'Shopping list ↗',
    microNote: {
      itemId: 'breakfast',
      text: 'Sealed yogurt jars hold 4 days; swap to Tofu or Eggs to shift prep track.',
      tone: 'tip',
    },
    targets: MEAL_TARGETS,
    items: structuredClone(MEAL_ITEMS) as MixItem[],
    pareto: {
      title: 'Weekly Cost vs Weekday Prep Frontier',
      xKey: 'prep',
      yKey: 'cost',
      xLabel: 'Weekday Prep Mins',
      yLabel: 'Cost $/wk',
      xDomain: [6, 24],
      yDomain: [38, 90],
      sweetSpot: {xMin: 6, xMax: 15, yMin: 38, yMax: 65},
      presets: mealPresets,
    },
    gantt: {
      title: 'Sunday 45m Parallel Batch-Cook',
      subtitle: 'Oven + Stovetop + Counter',
      totalMinutes: 45,
      tracks: [
        {
          id: 'oven',
          name: 'Oven 425°F',
          blocks: [
            {
              id: 'g_main',
              label: 'Sheet-pan chicken',
              startMin: 4,
              durationMin: 26,
              accent: 'amber',
              itemId: 'main_protein',
              optionLabels: {
                herb_chicken: 'Sheet-pan chicken',
                salmon: 'Miso broil salmon',
                tempeh: 'Citrus baked tempeh',
              },
              optionDurations: {herb_chicken: 26, salmon: 16, tempeh: 22},
            },
          ],
        },
        {
          id: 'stovetop',
          name: 'Stovetop',
          blocks: [
            {
              id: 'g_carb',
              label: 'Quinoa rice pot',
              startMin: 2,
              durationMin: 20,
              accent: 'blue',
              itemId: 'carb_base',
              optionLabels: {
                quinoa_rice: 'Quinoa rice pot',
                sweet_potato: 'Roast wedges',
                pouch_grains: 'Pouch rack (no-cook)',
              },
              optionTracks: {
                quinoa_rice: 'stovetop',
                sweet_potato: 'oven',
                pouch_grains: 'counter',
              },
              optionDurations: {quinoa_rice: 20, sweet_potato: 28, pouch_grains: 6},
            },
          ],
        },
        {
          id: 'counter',
          name: 'Prep counter',
          blocks: [
            {
              id: 'g_bfast',
              label: 'Yogurt jars',
              startMin: 0,
              durationMin: 12,
              accent: 'teal',
              itemId: 'breakfast',
              optionLabels: {
                greek_yogurt: 'Yogurt jars',
                eggs: 'Jammy egg boil',
                tofu: 'Herb tofu skillet',
              },
              optionTracks: {
                greek_yogurt: 'counter',
                eggs: 'stovetop',
                tofu: 'stovetop',
              },
              optionDurations: {greek_yogurt: 10, eggs: 14, tofu: 16},
            },
            {
              id: 'g_greens',
              label: 'Edamame slaw + box',
              startMin: 24,
              durationMin: 18,
              accent: 'violet',
              itemId: 'greens_boost',
              optionLabels: {
                edamame_slaw: 'Edamame slaw + box',
                charred_broc: 'Tahini broc + box',
                whey_berries: 'Portion berry tubs',
              },
              optionDurations: {edamame_slaw: 18, charred_broc: 19, whey_berries: 10},
            },
          ],
        },
      ],
    },
  };
}

/**
 * Snaps an arbitrary user-edited mix back to a converged 4/4 target-hitting mix,
 * preserving user swap choices when a simple scale adjustment already converges,
 * and falling back to the scenario's recommended mix otherwise.
 */
export function snapMixToTargets(
  blueprint: ScenarioBlueprint,
  currentItems: readonly MixItem[],
): {items: MixItem[]; presetId: string} {
  const candidateScales = [1.0, 0.75, 1.25];
  for (const uniformScale of candidateScales) {
    const scaled = currentItems.map(item => ({...item, scale: uniformScale}));
    const evalResult = evaluateMixTotals(scaled, blueprint.targets);
    if (evalResult.converged) {
      return {items: scaled, presetId: 'snapped_custom'};
    }
  }
  const fresh = structuredClone(blueprint.items) as MixItem[];
  const recPreset = blueprint.pareto?.presets.find(p => p.recommended)?.id ?? 'preset_balanced';
  return {items: fresh, presetId: recPreset};
}
