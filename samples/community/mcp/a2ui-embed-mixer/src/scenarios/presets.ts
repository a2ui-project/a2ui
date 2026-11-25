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
 * Curated multi-goal scenario blueprints across 8 domains (`meal_prep`, `debt_savings`,
 * `training_week`, `wedding_budget`, `solar_home`, `apartment_commute`, `startup_runway`,
 * `family_routine`), 4 distinct `layoutMode` component compositions, keyword routing,
 * and target-band snapping.
 */

import {
  evaluateMixTotals,
  type MixItem,
  type MixTarget,
  type ParetoMixAssignment,
  type ParetoPreset,
  type PrepTrack,
} from '../catalog/functions.js';

export const LAYOUT_MODES = [
  'rings_pareto_gantt',
  'rings_pareto',
  'rings_gantt',
  'pareto_hero',
] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

export const CURATED_SCENARIO_IDS = [
  'meal_prep',
  'debt_savings',
  'training_week',
  'wedding_budget',
  'solar_home',
  'apartment_commute',
  'startup_runway',
  'family_routine',
] as const;
export type CuratedScenarioId = (typeof CURATED_SCENARIO_IDS)[number];

export const SCENARIO_MODES = ['auto', 'custom', ...CURATED_SCENARIO_IDS] as const;
export type ScenarioMode = (typeof SCENARIO_MODES)[number];

export interface ScenarioBlueprint {
  readonly id: string;
  readonly layoutMode: LayoutMode;
  readonly source?: 'gemini' | 'curated';
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
    readonly unitSuffix?: string;
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
    title: 'Zone 2 & long-run volume',
    subtitle: 'Half-marathon aerobic base',
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
    subtitle: 'Full-body tendon & power',
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

const WEDDING_ITEMS: readonly MixItem[] = [
  {
    id: 'venue_guests',
    title: 'Guest list & venue tier',
    subtitle: 'Headcount drives catering & rentals',
    icon: 'heart',
    scale: 1.0,
    unitHint: '120 guests',
    activeOptionId: 'greenhouse_120',
    recommendedId: 'greenhouse_120',
    options: [
      {
        id: 'greenhouse_120',
        label: '120 Greenhouse',
        note: 'Botanical atrium · $10.8k venue+tables',
        effects: {total_spend: 10800, guests: 120, experience: 18, contingency: -800},
      },
      {
        id: 'estate_150',
        label: '150 Estate',
        note: 'Full extended list · $15.2k grand hall',
        effects: {total_spend: 15200, guests: 150, experience: 21, contingency: -2200},
      },
      {
        id: 'bistro_85',
        label: '85 Courtyard',
        note: 'Intimate A-list · $7.4k private patio',
        effects: {total_spend: 7400, guests: 85, experience: 16, contingency: 1200},
      },
    ],
  },
  {
    id: 'catering_bar',
    title: 'Dinner & bar package',
    subtitle: 'Per-head hospitality & beverage tier',
    icon: 'bowl',
    scale: 1.0,
    unitHint: '5h service',
    activeOptionId: 'sig_cocktails',
    recommendedId: 'sig_cocktails',
    options: [
      {
        id: 'sig_cocktails',
        label: '2 Sig + beer/wine',
        note: 'Family-style + 2 craft cocktails',
        effects: {total_spend: 7600, guests: 0, experience: 14, contingency: 600},
      },
      {
        id: 'top_shelf_open',
        label: 'Full open bar',
        note: 'Plated 3-course + top-shelf spirits',
        effects: {total_spend: 10400, guests: 0, experience: 18, contingency: -1400},
      },
      {
        id: 'brunch_toast',
        label: 'Brunch + spritz',
        note: 'Daytime chef stations + espresso bar',
        effects: {total_spend: 5200, guests: 0, experience: 10, contingency: 1800},
      },
    ],
  },
  {
    id: 'photo_music',
    title: 'Photo, floral & music',
    subtitle: 'Atmosphere & keepsake coverage',
    icon: 'vault',
    scale: 1.0,
    unitHint: '8h coverage',
    activeOptionId: 'doc_photo_dj',
    recommendedId: 'doc_photo_dj',
    options: [
      {
        id: 'doc_photo_dj',
        label: '8h Photo + DJ',
        note: 'Editorial shooter + vinyl DJ + seasonal stems',
        effects: {total_spend: 4800, guests: 0, experience: 11, contingency: 400},
      },
      {
        id: 'live_band_film',
        label: 'Live band + film',
        note: '7-piece soul band + Super-8 cinema',
        effects: {total_spend: 8200, guests: 0, experience: 16, contingency: -1600},
      },
      {
        id: 'acoustic_curated',
        label: '6h Photo + trio',
        note: 'Cocktail trio + curated dance set',
        effects: {total_spend: 2900, guests: 0, experience: 7, contingency: 1400},
      },
    ],
  },
];

const WEDDING_TARGETS: readonly MixTarget[] = [
  {
    key: 'total_spend',
    label: 'Total wedding spend',
    prefix: '$',
    unit: '',
    baseline: 3600,
    min: 0,
    max: 28000,
    gaugeMax: 36000,
    direction: 'atMost',
    targetLabel: '<=$28,000',
  },
  {
    key: 'guests',
    label: 'Invited headcount',
    unit: 'guests',
    min: 110,
    max: 135,
    gaugeMax: 165,
    direction: 'band',
    targetLabel: '110–135',
  },
  {
    key: 'experience',
    label: 'Guest vibe score',
    unit: 'pts',
    baseline: 48,
    min: 88,
    max: 100,
    gaugeMax: 100,
    direction: 'atLeast',
    targetLabel: '>=88 pts',
  },
  {
    key: 'contingency',
    label: 'Contingency buffer',
    prefix: '$',
    unit: '',
    baseline: 2600,
    min: 2400,
    max: 9000,
    gaugeMax: 5200,
    direction: 'atLeast',
    targetLabel: '>=$2,400',
  },
];

const SOLAR_ITEMS: readonly MixItem[] = [
  {
    id: 'pv_array',
    title: 'Rooftop solar PV array',
    subtitle: 'Net of 30% federal clean-energy credit',
    icon: 'sun',
    scale: 1.0,
    unitHint: '8.4 kW DC',
    activeOptionId: 'pv_8kw',
    recommendedId: 'pv_8kw',
    options: [
      {
        id: 'pv_8kw',
        label: '8.4 kW South+West',
        note: 'Covers 96% annual kWh · $1,650/yr saved',
        effects: {net_cost: 8400, annual_savings: 1650, backup_hrs: 6, payback_yrs: -4},
      },
      {
        id: 'pv_12kw',
        label: '12 kW Max Roof',
        note: 'EV-ready surplus export · $2,250/yr saved',
        effects: {net_cost: 11800, annual_savings: 2250, backup_hrs: 8, payback_yrs: -4},
      },
      {
        id: 'pv_5kw',
        label: '5.2 kW Peak Shave',
        note: 'Offsets daytime AC & TOU peak',
        effects: {net_cost: 5600, annual_savings: 1050, backup_hrs: 2, payback_yrs: -3},
      },
    ],
  },
  {
    id: 'battery_wall',
    title: 'Home LFP battery backup',
    subtitle: 'TOU arbitrage + outage islanding',
    icon: 'shield',
    scale: 1.0,
    unitHint: '13.5 kWh',
    activeOptionId: 'lfp_13kwh',
    recommendedId: 'lfp_13kwh',
    options: [
      {
        id: 'lfp_13kwh',
        label: '13.5 kWh LFP',
        note: '26h critical loads + evening peak shift',
        effects: {net_cost: 5200, annual_savings: 420, backup_hrs: 22, payback_yrs: -1},
      },
      {
        id: 'dual_27kwh',
        label: '27 kWh Dual Stack',
        note: 'Whole-home HVAC backup for 2 days',
        effects: {net_cost: 9800, annual_savings: 620, backup_hrs: 42, payback_yrs: 1},
      },
      {
        id: 'grid_tied_only',
        label: 'No battery',
        note: 'Fastest payback, 0h outage backup',
        effects: {net_cost: 600, annual_savings: 120, backup_hrs: 0, payback_yrs: -3},
      },
    ],
  },
  {
    id: 'heat_pump',
    title: 'Inverter heat-pump HVAC',
    subtitle: 'Replaces gas furnace + old central AC',
    icon: 'home',
    scale: 1.0,
    unitHint: '3-ton variable',
    activeOptionId: 'inverter_3t',
    recommendedId: 'inverter_3t',
    options: [
      {
        id: 'inverter_3t',
        label: '3T Cold-Climate HP',
        note: 'After $2k rebate · cuts gas bill $780/yr',
        effects: {net_cost: 3200, annual_savings: 780, backup_hrs: -2, payback_yrs: -1},
      },
      {
        id: 'hp_plus_water',
        label: 'HP + HP Water Heater',
        note: 'Full electrification · $1,080/yr saved',
        effects: {net_cost: 4900, annual_savings: 1080, backup_hrs: -4, payback_yrs: -1},
      },
      {
        id: 'defer_hvac',
        label: 'Keep gas furnace',
        note: '$0 HVAC capex · preserves battery hours',
        effects: {net_cost: 0, annual_savings: 0, backup_hrs: 4, payback_yrs: 0},
      },
    ],
  },
];

const SOLAR_TARGETS: readonly MixTarget[] = [
  {
    key: 'net_cost',
    label: 'Net upfront cost',
    prefix: '$',
    unit: '',
    baseline: 2000,
    min: 0,
    max: 19500,
    gaugeMax: 28000,
    direction: 'atMost',
    targetLabel: '<=$19,500',
  },
  {
    key: 'annual_savings',
    label: 'Utility savings',
    prefix: '$',
    unit: '/yr',
    min: 2600,
    max: 5000,
    gaugeMax: 3900,
    direction: 'atLeast',
    targetLabel: '>=$2,600/yr',
  },
  {
    key: 'backup_hrs',
    label: 'Blackout backup',
    unit: 'hrs',
    min: 24,
    max: 72,
    gaugeMax: 48,
    direction: 'atLeast',
    targetLabel: '>=24 hrs',
  },
  {
    key: 'payback_yrs',
    label: 'Simple payback',
    unit: 'yrs',
    baseline: 12,
    min: 1,
    max: 7,
    gaugeMax: 12,
    direction: 'atMost',
    targetLabel: '<=7 yrs',
  },
];

const APARTMENT_ITEMS: readonly MixItem[] = [
  {
    id: 'transit_zone',
    title: 'Neighborhood & transit',
    subtitle: 'Controls door-to-desk rail time vs base rent',
    icon: 'home',
    scale: 1.0,
    unitHint: 'Zone 1–2',
    activeOptionId: 'midtown_rail',
    recommendedId: 'midtown_rail',
    options: [
      {
        id: 'midtown_rail',
        label: 'Midtown Express',
        note: '2 rail stops · groceries & parks 4m walk',
        effects: {commute: 14, rent: 1450, sqft: 340, walk_score: 42},
      },
      {
        id: 'downtown_core',
        label: 'Walk-to-Office',
        note: '11m walk to desk · highest $/sqft',
        effects: {commute: 5, rent: 1980, sqft: 250, walk_score: 48},
      },
      {
        id: 'inner_streetcar',
        label: 'Leafy Streetcar',
        note: 'Quiet tree-lined block · 32m commute',
        effects: {commute: 26, rent: 1080, sqft: 480, walk_score: 30},
      },
    ],
  },
  {
    id: 'floorplan_tier',
    title: 'Floorplan & WFH space',
    subtitle: 'Square footage & desk acoustic separation',
    icon: 'vault',
    scale: 1.0,
    unitHint: '790 sqft',
    activeOptionId: 'one_bed_alcove',
    recommendedId: 'one_bed_alcove',
    options: [
      {
        id: 'one_bed_alcove',
        label: '1BR + WFH Alcove',
        note: 'Dedicated desk nook + bedroom door',
        effects: {commute: 2, rent: 680, sqft: 310, walk_score: 10},
      },
      {
        id: 'corner_two_bed',
        label: 'Corner 2BR',
        note: 'Full office room · +$340/mo rent',
        effects: {commute: 3, rent: 1020, sqft: 460, walk_score: 10},
      },
      {
        id: 'loft_studio',
        label: 'Sunny Studio',
        note: 'Saves $320/mo · desk shares living zone',
        effects: {commute: 1, rent: 360, sqft: 180, walk_score: 12},
      },
    ],
  },
  {
    id: 'lease_perks',
    title: 'Laundry, bike & lease terms',
    subtitle: 'Monthly utility & amenity bundle',
    icon: 'shield',
    scale: 1.0,
    unitHint: '14-mo lease',
    activeOptionId: 'in_unit_bike',
    recommendedId: 'in_unit_bike',
    options: [
      {
        id: 'in_unit_bike',
        label: 'In-unit W/D + Bike',
        note: '1 mo free amortized + secure bike room',
        effects: {commute: 2, rent: 240, sqft: 20, walk_score: 8},
      },
      {
        id: 'full_amenity',
        label: 'Doorman + Gym',
        note: 'Roof deck, gym & package concierge',
        effects: {commute: 0, rent: 480, sqft: 30, walk_score: 6},
      },
      {
        id: 'classic_walkup',
        label: 'Pre-war Walk-up',
        note: 'Basement laundry · lowest monthly carry',
        effects: {commute: 4, rent: 80, sqft: 40, walk_score: 9},
      },
    ],
  },
];

const APARTMENT_TARGETS: readonly MixTarget[] = [
  {
    key: 'commute',
    label: 'Door-to-desk',
    unit: 'm',
    baseline: 6,
    min: 0,
    max: 28,
    gaugeMax: 48,
    direction: 'atMost',
    targetLabel: '<=28m',
  },
  {
    key: 'rent',
    label: 'Rent + utilities',
    prefix: '$',
    unit: '/mo',
    baseline: 400,
    min: 0,
    max: 2850,
    gaugeMax: 3800,
    direction: 'atMost',
    targetLabel: '<=$2,850/mo',
  },
  {
    key: 'sqft',
    label: 'Living space',
    unit: 'sqft',
    baseline: 120,
    min: 750,
    max: 1400,
    gaugeMax: 1100,
    direction: 'atLeast',
    targetLabel: '>=750 sqft',
  },
  {
    key: 'walk_score',
    label: 'Walkability',
    unit: 'pts',
    baseline: 30,
    min: 85,
    max: 100,
    gaugeMax: 100,
    direction: 'atLeast',
    targetLabel: '>=85 pts',
  },
];

const STARTUP_ITEMS: readonly MixItem[] = [
  {
    id: 'eng_hiring',
    title: 'Engineering hiring pace',
    subtitle: 'Core product & AI roadmap velocity',
    icon: 'rocket',
    scale: 1.0,
    unitHint: '+2 Staff Eng',
    activeOptionId: 'two_staff_eng',
    recommendedId: 'two_staff_eng',
    options: [
      {
        id: 'two_staff_eng',
        label: '+2 Staff Full-Stack',
        note: '$32k/mo · ships v2 enterprise workflows',
        effects: {runway: -7, arr_growth: 38, velocity: 36, net_burn: 32},
      },
      {
        id: 'four_eng_blitz',
        label: '+4 Pod Blitz',
        note: '$62k/mo · fastest roadmap, cuts 13m runway',
        effects: {runway: -13, arr_growth: 52, velocity: 48, net_burn: 62},
      },
      {
        id: 'lean_design_eng',
        label: '+1 Design Eng',
        note: '$18k/mo · preserves maximum cash buffer',
        effects: {runway: -4, arr_growth: 22, velocity: 22, net_burn: 18},
      },
    ],
  },
  {
    id: 'gtm_motion',
    title: 'Go-to-market & pipeline',
    subtitle: 'Customer acquisition vs burn efficiency',
    icon: 'card',
    scale: 1.0,
    unitHint: 'PLG + AE',
    activeOptionId: 'plg_founding_ae',
    recommendedId: 'plg_founding_ae',
    options: [
      {
        id: 'plg_founding_ae',
        label: 'PLG + Founding AE',
        note: '$18k/mo · converts self-serve teams',
        effects: {runway: -4, arr_growth: 36, velocity: 10, net_burn: 18},
      },
      {
        id: 'outbound_squad',
        label: '2 AEs + Paid Ads',
        note: '$38k/mo · aggressive enterprise pipeline',
        effects: {runway: -8, arr_growth: 54, velocity: 6, net_burn: 38},
      },
      {
        id: 'organic_founder',
        label: 'Founder-led PLG',
        note: '$6k/mo · lowest CAC, slower mid-market',
        effects: {runway: -1, arr_growth: 18, velocity: 12, net_burn: 6},
      },
    ],
  },
  {
    id: 'infra_cloud',
    title: 'AI inference & cloud tier',
    subtitle: 'Model latency, margin & GPU commitments',
    icon: 'vault',
    scale: 1.0,
    unitHint: '$9k/mo net',
    activeOptionId: 'reserved_hybrid',
    recommendedId: 'reserved_hybrid',
    options: [
      {
        id: 'reserved_hybrid',
        label: 'Prompt cache + commit',
        note: '$9k/mo · sub-400ms latency, 78% gross margin',
        effects: {runway: -2, arr_growth: 12, velocity: 10, net_burn: 9},
      },
      {
        id: 'dedicated_gpus',
        label: 'Dedicated GPU cluster',
        note: '$22k/mo · custom fine-tunes + zero rate limits',
        effects: {runway: -5, arr_growth: 16, velocity: 14, net_burn: 22},
      },
      {
        id: 'credits_serverless',
        label: 'Cloud credits + batch',
        note: '$4k/mo · uses startup credits first',
        effects: {runway: -1, arr_growth: 8, velocity: 6, net_burn: 4},
      },
    ],
  },
];

const STARTUP_TARGETS: readonly MixTarget[] = [
  {
    key: 'runway',
    label: 'Seed runway',
    unit: 'mos',
    baseline: 34,
    min: 20,
    max: 36,
    gaugeMax: 32,
    direction: 'atLeast',
    targetLabel: '>=20 mos',
  },
  {
    key: 'arr_growth',
    label: 'ARR growth rate',
    unit: '% YoY',
    baseline: 35,
    min: 115,
    max: 240,
    gaugeMax: 180,
    direction: 'atLeast',
    targetLabel: '>=115% YoY',
  },
  {
    key: 'velocity',
    label: 'Ship velocity',
    unit: 'pts',
    baseline: 30,
    min: 82,
    max: 100,
    gaugeMax: 100,
    direction: 'atLeast',
    targetLabel: '>=82 pts',
  },
  {
    key: 'net_burn',
    label: 'Net monthly burn',
    prefix: '$',
    unit: 'k/mo',
    baseline: 18,
    min: 0,
    max: 78,
    gaugeMax: 115,
    direction: 'atMost',
    targetLabel: '<=$78k/mo',
  },
];

const FAMILY_ITEMS: readonly MixItem[] = [
  {
    id: 'dinner_mode',
    title: '5:30pm family dinner',
    subtitle: 'Cleanup + cook load after work/school',
    icon: 'skillet',
    scale: 1.0,
    unitHint: '5 nights',
    activeOptionId: 'sheet_pan_20m',
    recommendedId: 'sheet_pan_20m',
    options: [
      {
        id: 'sheet_pan_20m',
        label: '20m Sheet-pan + prep',
        note: '1-pan cleanup · on table by 6:00pm',
        effects: {bedtime_buf: -8, kids_enrich: 10, cook_effort: 18, parent_recharge: 18},
      },
      {
        id: 'scratch_cook',
        label: '40m Fresh recipe',
        note: 'Pushes cleanup to 6:50pm · 36m stove effort',
        effects: {bedtime_buf: -22, kids_enrich: 4, cook_effort: 36, parent_recharge: 4},
      },
      {
        id: 'slow_cooker',
        label: 'AM Slow-cooker',
        note: '10m evening assembly · max family margin',
        effects: {bedtime_buf: -4, kids_enrich: 14, cook_effort: 10, parent_recharge: 24},
      },
    ],
  },
  {
    id: 'homework_play',
    title: 'Homework & outdoor block',
    subtitle: '6:15pm–7:15pm focus + movement',
    icon: 'clock',
    scale: 1.0,
    unitHint: '60m block',
    activeOptionId: 'sprint_plus_park',
    recommendedId: 'sprint_plus_park',
    options: [
      {
        id: 'sprint_plus_park',
        label: '25m Timer + scooters',
        note: 'Kitchen-table timer then 25m outdoor play',
        effects: {bedtime_buf: -8, kids_enrich: 32, cook_effort: 0, parent_recharge: 12},
      },
      {
        id: 'deep_workbook',
        label: '45m Guided study',
        note: 'Extra math/music practice · less free play',
        effects: {bedtime_buf: -16, kids_enrich: 26, cook_effort: 0, parent_recharge: 4},
      },
      {
        id: 'yard_first',
        label: 'Play first + 15m check',
        note: 'Burns energy before dinner · light review',
        effects: {bedtime_buf: -6, kids_enrich: 28, cook_effort: 0, parent_recharge: 16},
      },
    ],
  },
  {
    id: 'screen_winddown',
    title: 'Screen rule & 8:00pm bedtime',
    subtitle: 'Melatonin wind-down & parent evening reset',
    icon: 'sleep',
    scale: 1.0,
    unitHint: '8:30pm out',
    activeOptionId: 'screens_off_read',
    recommendedId: 'screens_off_read',
    options: [
      {
        id: 'screens_off_read',
        label: '7:15 Off + 20m read',
        note: 'Calm 8:10pm lights-out · +71m parent window',
        effects: {bedtime_buf: -6, kids_enrich: 18, cook_effort: 0, parent_recharge: 16},
      },
      {
        id: 'family_show_30m',
        label: '30m Family show',
        note: 'Co-watch episode · tighter 8:25pm lights-out',
        effects: {bedtime_buf: -14, kids_enrich: 8, cook_effort: 0, parent_recharge: 12},
      },
      {
        id: 'bath_audiobook',
        label: 'Warm bath + audio',
        note: 'Zero screen friction · kids asleep 8:05pm',
        effects: {bedtime_buf: -4, kids_enrich: 16, cook_effort: 0, parent_recharge: 20},
      },
    ],
  },
];

const FAMILY_TARGETS: readonly MixTarget[] = [
  {
    key: 'bedtime_buf',
    label: '8:30pm bedtime buffer',
    unit: 'm',
    baseline: 42,
    min: 15,
    max: 60,
    gaugeMax: 45,
    direction: 'atLeast',
    targetLabel: '>=15m early',
  },
  {
    key: 'kids_enrich',
    label: 'Active + reading',
    unit: 'm',
    baseline: 10,
    min: 50,
    max: 110,
    gaugeMax: 90,
    direction: 'atLeast',
    targetLabel: '>=50m',
  },
  {
    key: 'cook_effort',
    label: 'Evening cook effort',
    unit: 'm',
    baseline: 4,
    min: 0,
    max: 25,
    gaugeMax: 45,
    direction: 'atMost',
    targetLabel: '<=25m',
  },
  {
    key: 'parent_recharge',
    label: 'Parent recharge',
    unit: 'm',
    baseline: 25,
    min: 65,
    max: 120,
    gaugeMax: 95,
    direction: 'atLeast',
    targetLabel: '>=65m',
  },
];

/** Classifies a natural-language prompt into the closest curated domain blueprint. */
export function inferScenario(prompt: string, explicit?: string): CuratedScenarioId {
  if (
    explicit &&
    explicit !== 'auto' &&
    (CURATED_SCENARIO_IDS as readonly string[]).includes(explicit)
  ) {
    return explicit as CuratedScenarioId;
  }
  const lower = prompt.toLowerCase();
  if (/\b(wedding|guest|open[- ]bar|venue|catering|reception|floral)\b/.test(lower)) {
    return 'wedding_budget';
  }
  if (
    /\b(solar|battery|heat[- ]pump|kilowatt|kwh|outage|blackout|utility|panel|payback)\b/.test(
      lower,
    )
  ) {
    return 'solar_home';
  }
  if (/\b(apartment|commute|rent|sqft|square feet|walkability|neighborhood|lease)\b/.test(lower)) {
    return 'apartment_commute';
  }
  if (/\b(startup|runway|seed|burn|hiring|arr|saas|gtm|velocity)\b/.test(lower)) {
    return 'startup_runway';
  }
  if (
    /\b(family|bedtime|homework|screen[- ]time|kids|weeknight|lights[- ]out|parent)\b/.test(lower)
  ) {
    return 'family_routine';
  }
  if (
    /\b(debt|loan|apr|savings|emergency fund|cushion|surplus|payoff|paydown|hysa|credit card)\b/.test(
      lower,
    )
  ) {
    return 'debt_savings';
  }
  if (
    /\b(train|workout|zone\s*2|cardio|half[- ]marathon|marathon|lift|hypertrophy|recovery|hrv|gym|run volume)\b/.test(
      lower,
    )
  ) {
    return 'training_week';
  }
  return 'meal_prep';
}

export function getScenarioBlueprint(scenario: CuratedScenarioId): ScenarioBlueprint {
  switch (scenario) {
    case 'debt_savings': {
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
        layoutMode: 'rings_pareto',
        source: 'curated',
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

    case 'training_week':
      return {
        id: 'training_week',
        layoutMode: 'rings_gantt',
        source: 'curated',
        badge: 'Hybrid microcycle',
        title: 'Half-Marathon, Strength & Recovery Mixer',
        subtitle:
          '★ Recommended: 2x run + 1x spin with 3x full-body lifts and 15m nightly mobility hits 84 readiness in 7h/wk.',
        deliverableLabel: '7-day run, lift & recovery schedule',
        followUpButtonLabel: 'Week plan ↗',
        targets: TRAINING_TARGETS,
        items: structuredClone(TRAINING_ITEMS) as MixItem[],
        gantt: {
          title: 'Weekly Peak-Day Allocation (90m window)',
          subtitle: '3 non-competing energy tracks',
          totalMinutes: 90,
          unitSuffix: 'm',
          tracks: [
            {
              id: 'am_cardio',
              name: 'AM Aerobic',
              blocks: [
                {
                  id: 'blk_z2',
                  label: 'Zone 2 Run + Spin',
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
                  label: '3x Compound Lift',
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
                  label: '15m Mobility + Sleep',
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

    case 'wedding_budget': {
      const presets: ParetoPreset[] = [
        buildPreset(
          'preset_intimate',
          '85 Courtyard $19k',
          {
            venue_guests: {scale: 1.0, activeOptionId: 'bistro_85'},
            catering_bar: {scale: 1.0, activeOptionId: 'sig_cocktails'},
            photo_music: {scale: 1.0, activeOptionId: 'acoustic_curated'},
          },
          WEDDING_ITEMS,
          WEDDING_TARGETS,
          'guests',
          'total_spend',
        ),
        buildPreset(
          'preset_brunch',
          '120 Brunch $22k',
          {
            venue_guests: {scale: 1.0, activeOptionId: 'greenhouse_120'},
            catering_bar: {scale: 1.0, activeOptionId: 'brunch_toast'},
            photo_music: {scale: 1.0, activeOptionId: 'acoustic_curated'},
          },
          WEDDING_ITEMS,
          WEDDING_TARGETS,
          'guests',
          'total_spend',
        ),
        buildPreset(
          'preset_balanced',
          '★ 120 Sig Bar $27k',
          {
            venue_guests: {scale: 1.0, activeOptionId: 'greenhouse_120'},
            catering_bar: {scale: 1.0, activeOptionId: 'sig_cocktails'},
            photo_music: {scale: 1.0, activeOptionId: 'doc_photo_dj'},
          },
          WEDDING_ITEMS,
          WEDDING_TARGETS,
          'guests',
          'total_spend',
          true,
        ),
        buildPreset(
          'preset_gala',
          '150 Gala $37k',
          {
            venue_guests: {scale: 1.0, activeOptionId: 'estate_150'},
            catering_bar: {scale: 1.0, activeOptionId: 'top_shelf_open'},
            photo_music: {scale: 1.0, activeOptionId: 'live_band_film'},
          },
          WEDDING_ITEMS,
          WEDDING_TARGETS,
          'guests',
          'total_spend',
        ),
      ];
      return {
        id: 'wedding_budget',
        layoutMode: 'rings_pareto',
        source: 'curated',
        badge: 'Event budget mixer',
        title: 'Wedding Budget, Guest Count & Open-Bar Mixer',
        subtitle:
          '★ Recommended: 120 guests in the Greenhouse with 2 signature cocktails + wine and 8h photo/DJ lands at $26,800 with $2,800 contingency.',
        deliverableLabel: 'vendor budget breakdown & guest-tier checklist',
        followUpButtonLabel: 'Vendor plan ↗',
        microNote: {
          itemId: 'venue_guests',
          text: 'Every +10 guests adds ~$1,150 across catering, rentals, and service fees.',
          tone: 'tip',
        },
        targets: WEDDING_TARGETS,
        items: structuredClone(WEDDING_ITEMS) as MixItem[],
        pareto: {
          title: 'Guest Headcount vs Total Wedding Spend',
          xKey: 'guests',
          yKey: 'total_spend',
          xLabel: 'Invited Guests',
          yLabel: 'Spend $',
          xDomain: [70, 165],
          yDomain: [16000, 40000],
          sweetSpot: {xMin: 110, xMax: 135, yMin: 16000, yMax: 28000},
          presets,
        },
      };
    }

    case 'solar_home': {
      const presets: ParetoPreset[] = [
        buildPreset(
          'preset_fast_roi',
          '4yr Solar-Only',
          {
            pv_array: {scale: 1.0, activeOptionId: 'pv_8kw'},
            battery_wall: {scale: 1.0, activeOptionId: 'grid_tied_only'},
            heat_pump: {scale: 1.0, activeOptionId: 'defer_hvac'},
          },
          SOLAR_ITEMS,
          SOLAR_TARGETS,
          'payback_yrs',
          'backup_hrs',
        ),
        buildPreset(
          'preset_balanced',
          '★ 8.4kW + 13kWh + HP',
          {
            pv_array: {scale: 1.0, activeOptionId: 'pv_8kw'},
            battery_wall: {scale: 1.0, activeOptionId: 'lfp_13kwh'},
            heat_pump: {scale: 1.0, activeOptionId: 'inverter_3t'},
          },
          SOLAR_ITEMS,
          SOLAR_TARGETS,
          'payback_yrs',
          'backup_hrs',
          true,
        ),
        buildPreset(
          'preset_electrify',
          '12kW Full Electric',
          {
            pv_array: {scale: 1.0, activeOptionId: 'pv_12kw'},
            battery_wall: {scale: 1.0, activeOptionId: 'lfp_13kwh'},
            heat_pump: {scale: 1.0, activeOptionId: 'hp_plus_water'},
          },
          SOLAR_ITEMS,
          SOLAR_TARGETS,
          'payback_yrs',
          'backup_hrs',
        ),
        buildPreset(
          'preset_offgrid',
          '48h Storm Fortress',
          {
            pv_array: {scale: 1.0, activeOptionId: 'pv_12kw'},
            battery_wall: {scale: 1.0, activeOptionId: 'dual_27kwh'},
            heat_pump: {scale: 1.0, activeOptionId: 'inverter_3t'},
          },
          SOLAR_ITEMS,
          SOLAR_TARGETS,
          'payback_yrs',
          'backup_hrs',
        ),
      ];
      return {
        id: 'solar_home',
        layoutMode: 'rings_pareto_gantt',
        source: 'curated',
        badge: 'Home electrification',
        title: 'Solar PV, Battery Backup & Heat-Pump Sizing Mixer',
        subtitle:
          '★ Recommended: 8.4 kW PV + 13.5 kWh LFP battery + 3T heat pump nets $18,800 post-ITC, saves $2,850/yr, and gives 26h backup (6-yr payback).',
        deliverableLabel: 'equipment sizing & 30% ITC / utility rebate checklist',
        followUpButtonLabel: 'Quote spec ↗',
        microNote: {
          itemId: 'pv_array',
          text: 'West-facing strings boost 4–7pm TOU export right before battery discharge.',
          tone: 'tip',
        },
        targets: SOLAR_TARGETS,
        items: structuredClone(SOLAR_ITEMS) as MixItem[],
        pareto: {
          title: 'Payback Years vs Outage Backup Hours',
          xKey: 'payback_yrs',
          yKey: 'backup_hrs',
          xLabel: 'Payback (yrs)',
          yLabel: 'Backup hrs',
          xDomain: [3, 10],
          yDomain: [0, 56],
          sweetSpot: {xMin: 3, xMax: 7, yMin: 24, yMax: 56},
          presets,
        },
        gantt: {
          title: '24h Solar, Battery & Heat-Pump Dispatch',
          subtitle: 'TOU peak shave + night reserve',
          totalMinutes: 24,
          unitSuffix: 'h',
          tracks: [
            {
              id: 'pv_gen',
              name: 'PV Harvest',
              blocks: [
                {
                  id: 'blk_pv',
                  label: '8.4kW Solar Curve',
                  startMin: 7,
                  durationMin: 11,
                  accent: 'amber',
                  itemId: 'pv_array',
                  optionLabels: {
                    pv_8kw: '8.4kW South+West',
                    pv_12kw: '12kW Full Roof',
                    pv_5kw: '5.2kW Daytime PV',
                  },
                },
              ],
            },
            {
              id: 'bat_dispatch',
              name: 'LFP Battery',
              blocks: [
                {
                  id: 'blk_chg',
                  label: 'Midday Charge',
                  startMin: 9,
                  durationMin: 6,
                  accent: 'teal',
                },
                {
                  id: 'blk_peak',
                  label: '4–9pm TOU Peak',
                  startMin: 16,
                  durationMin: 6,
                  accent: 'violet',
                  itemId: 'battery_wall',
                  optionLabels: {
                    lfp_13kwh: '13.5kWh Peak Shift',
                    dual_27kwh: '27kWh Whole-Home',
                    grid_tied_only: 'Grid Import',
                  },
                },
              ],
            },
            {
              id: 'hvac_load',
              name: 'Thermal Load',
              blocks: [
                {
                  id: 'blk_hp',
                  label: 'Pre-cool / Pre-heat',
                  startMin: 11,
                  durationMin: 5,
                  accent: 'blue',
                  itemId: 'heat_pump',
                  optionLabels: {
                    inverter_3t: '3T Inverter Pre-cool',
                    hp_plus_water: 'HP + Thermal Tank',
                    defer_hvac: 'Legacy AC Cycle',
                  },
                },
              ],
            },
          ],
        },
      };
    }

    case 'apartment_commute': {
      const presets: ParetoPreset[] = [
        buildPreset(
          'preset_walk_core',
          '12m Core Walk $3.3k',
          {
            transit_zone: {scale: 1.0, activeOptionId: 'downtown_core'},
            floorplan_tier: {scale: 1.0, activeOptionId: 'one_bed_alcove'},
            lease_perks: {scale: 1.0, activeOptionId: 'in_unit_bike'},
          },
          APARTMENT_ITEMS,
          APARTMENT_TARGETS,
          'commute',
          'rent',
        ),
        buildPreset(
          'preset_core_studio',
          '14m Core Studio $2.8k',
          {
            transit_zone: {scale: 1.0, activeOptionId: 'downtown_core'},
            floorplan_tier: {scale: 1.0, activeOptionId: 'loft_studio'},
            lease_perks: {scale: 1.0, activeOptionId: 'classic_walkup'},
          },
          APARTMENT_ITEMS,
          APARTMENT_TARGETS,
          'commute',
          'rent',
        ),
        buildPreset(
          'preset_balanced',
          '★ 24m Midtown 1BR+Den',
          {
            transit_zone: {scale: 1.0, activeOptionId: 'midtown_rail'},
            floorplan_tier: {scale: 1.0, activeOptionId: 'one_bed_alcove'},
            lease_perks: {scale: 1.0, activeOptionId: 'in_unit_bike'},
          },
          APARTMENT_ITEMS,
          APARTMENT_TARGETS,
          'commute',
          'rent',
          true,
        ),
        buildPreset(
          'preset_leafy_saver',
          '38m Spacious 2BR $2.6k',
          {
            transit_zone: {scale: 1.0, activeOptionId: 'inner_streetcar'},
            floorplan_tier: {scale: 1.0, activeOptionId: 'corner_two_bed'},
            lease_perks: {scale: 1.0, activeOptionId: 'classic_walkup'},
          },
          APARTMENT_ITEMS,
          APARTMENT_TARGETS,
          'commute',
          'rent',
        ),
      ];
      return {
        id: 'apartment_commute',
        layoutMode: 'pareto_hero',
        source: 'curated',
        badge: 'Housing trade-off',
        title: 'Apartment Hunt: Commute vs Rent vs Space Mixer',
        subtitle:
          '★ Recommended: Midtown Express 1BR + WFH alcove with in-unit laundry hits a 24m commute, $2,770/mo all-in, 790 sqft, and 90 walk score.',
        deliverableLabel: 'apartment viewing shortlist & lease negotiation checklist',
        followUpButtonLabel: 'Tour checklist ↗',
        microNote: {
          itemId: 'transit_zone',
          text: '2 express stops saves $530/mo vs walk-to-office while adding +90 sqft.',
          tone: 'tip',
        },
        targets: APARTMENT_TARGETS,
        items: structuredClone(APARTMENT_ITEMS) as MixItem[],
        pareto: {
          title: 'Door-to-Desk Commute Mins vs Monthly All-In Rent',
          xKey: 'commute',
          yKey: 'rent',
          xLabel: 'Commute (mins)',
          yLabel: 'Rent $/mo',
          xDomain: [8, 44],
          yDomain: [2100, 3600],
          sweetSpot: {xMin: 8, xMax: 28, yMin: 2100, yMax: 2850},
          presets,
        },
      };
    }

    case 'startup_runway': {
      const presets: ParetoPreset[] = [
        buildPreset(
          'preset_default_alive',
          '28m Lean PLG ($46k)',
          {
            eng_hiring: {scale: 1.0, activeOptionId: 'lean_design_eng'},
            gtm_motion: {scale: 1.0, activeOptionId: 'organic_founder'},
            infra_cloud: {scale: 1.0, activeOptionId: 'credits_serverless'},
          },
          STARTUP_ITEMS,
          STARTUP_TARGETS,
          'net_burn',
          'runway',
        ),
        buildPreset(
          'preset_balanced',
          '★ 21m Seed Plan ($77k)',
          {
            eng_hiring: {scale: 1.0, activeOptionId: 'two_staff_eng'},
            gtm_motion: {scale: 1.0, activeOptionId: 'plg_founding_ae'},
            infra_cloud: {scale: 1.0, activeOptionId: 'reserved_hybrid'},
          },
          STARTUP_ITEMS,
          STARTUP_TARGETS,
          'net_burn',
          'runway',
          true,
        ),
        buildPreset(
          'preset_gtm_push',
          '17m Outbound Push ($97k)',
          {
            eng_hiring: {scale: 1.0, activeOptionId: 'two_staff_eng'},
            gtm_motion: {scale: 1.0, activeOptionId: 'outbound_squad'},
            infra_cloud: {scale: 1.0, activeOptionId: 'reserved_hybrid'},
          },
          STARTUP_ITEMS,
          STARTUP_TARGETS,
          'net_burn',
          'runway',
        ),
        buildPreset(
          'preset_hyperblitz',
          '8m Hypergrowth ($140k)',
          {
            eng_hiring: {scale: 1.0, activeOptionId: 'four_eng_blitz'},
            gtm_motion: {scale: 1.0, activeOptionId: 'outbound_squad'},
            infra_cloud: {scale: 1.0, activeOptionId: 'dedicated_gpus'},
          },
          STARTUP_ITEMS,
          STARTUP_TARGETS,
          'net_burn',
          'runway',
        ),
      ];
      return {
        id: 'startup_runway',
        layoutMode: 'rings_pareto',
        source: 'curated',
        badge: 'Seed operating plan',
        title: 'Startup Seed Runway, Hiring & Growth Mixer',
        subtitle:
          '★ Recommended: +2 Staff full-stack engineers + PLG founding AE + cached GPU commit sustains 21 mos runway at $77k/mo net burn and 121% YoY ARR pace.',
        deliverableLabel: 'quarterly hiring & burn milestone plan',
        followUpButtonLabel: 'Board memo ↗',
        microNote: {
          itemId: 'eng_hiring',
          text: 'Keeping net burn <=$78k/mo preserves 6+ mos Series A fundraising cushion.',
          tone: 'tip',
        },
        targets: STARTUP_TARGETS,
        items: structuredClone(STARTUP_ITEMS) as MixItem[],
        pareto: {
          title: 'Net Monthly Burn ($k/mo) vs Cash Runway (Months)',
          xKey: 'net_burn',
          yKey: 'runway',
          xLabel: 'Net Burn ($k/mo)',
          yLabel: 'Runway mos',
          xDomain: [35, 150],
          yDomain: [6, 32],
          sweetSpot: {xMin: 35, xMax: 78, yMin: 20, yMax: 32},
          presets,
        },
      };
    }

    case 'family_routine':
      return {
        id: 'family_routine',
        layoutMode: 'rings_gantt',
        source: 'curated',
        badge: 'Weeknight cadence',
        title: 'Family Weeknight: Dinner, Homework, Screens & Bedtime',
        subtitle:
          '★ Recommended: 20m sheet-pan dinner + 25m timer/scooter block + 7:15pm screens-off reading hits lights-out 20m early with 71m parent recharge.',
        deliverableLabel: 'fridge weeknight schedule & screen-cutoff checklist',
        followUpButtonLabel: 'Fridge chart ↗',
        microNote: {
          itemId: 'screen_winddown',
          text: 'Cutting screens 60m before bed protects the 8:10pm lights-out buffer.',
          tone: 'tip',
        },
        targets: FAMILY_TARGETS,
        items: structuredClone(FAMILY_ITEMS) as MixItem[],
        gantt: {
          title: '5:30pm–8:30pm Weeknight Flow (180m window)',
          subtitle: 'Kitchen + Kids + Wind-down',
          totalMinutes: 180,
          unitSuffix: 'm',
          tracks: [
            {
              id: 'kitchen_track',
              name: 'Kitchen',
              blocks: [
                {
                  id: 'blk_cook',
                  label: '20m Sheet-pan + eat',
                  startMin: 5,
                  durationMin: 45,
                  accent: 'amber',
                  itemId: 'dinner_mode',
                  optionLabels: {
                    sheet_pan_20m: '20m Sheet-pan + eat',
                    scratch_cook: '40m Cook + late dishes',
                    slow_cooker: 'Slow-cooker serve',
                  },
                  optionDurations: {
                    sheet_pan_20m: 45,
                    scratch_cook: 68,
                    slow_cooker: 35,
                  },
                },
              ],
            },
            {
              id: 'kids_track',
              name: 'Homework/Play',
              blocks: [
                {
                  id: 'blk_hw',
                  label: '25m Timer + scooters',
                  startMin: 52,
                  durationMin: 55,
                  accent: 'teal',
                  itemId: 'homework_play',
                  optionLabels: {
                    sprint_plus_park: '25m Timer + scooters',
                    deep_workbook: '45m Guided study',
                    yard_first: 'Outdoor play + check',
                  },
                },
              ],
            },
            {
              id: 'bed_track',
              name: 'Wind-down',
              blocks: [
                {
                  id: 'blk_bed',
                  label: '7:15 Off + 20m read',
                  startMin: 112,
                  durationMin: 48,
                  accent: 'violet',
                  itemId: 'screen_winddown',
                  optionLabels: {
                    screens_off_read: '7:15 Off + 20m read',
                    family_show_30m: '30m Show + rush brush',
                    bath_audiobook: 'Warm bath + audio',
                  },
                },
              ],
            },
          ],
        },
      };

    case 'meal_prep':
    default: {
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
        layoutMode: 'rings_pareto_gantt',
        source: 'curated',
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
          unitSuffix: 'm',
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
  }
}

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
