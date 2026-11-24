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
 * Scenario router and multi-layout A2UI composer for Day & Trip Studio.
 * Each scenario composes a genuinely distinct custom component tree from `tripCatalog`.
 */

import {computeTripStats, formatClock} from '../catalog/model.js';
import {
  SCENARIO_FIXTURES,
  type ScenarioFixture,
  type ScenarioId,
} from '../scenarios/catalog_data.js';
import {
  bind,
  call,
  component,
  createSurfaceMessages,
  event,
  jsonBytes,
  type A2uiComponent,
  type A2uiMessage,
} from './a2ui.js';

/** Maximum JSON size of the shared data model (`sendDataModel: true`). */
export const MAX_DATA_MODEL_BYTES = 12 * 1024;

/** Classifies a natural-language prompt into a studio scenario when `scenario` is omitted. */
export function resolveScenario(prompt: string, explicit?: ScenarioId): ScenarioId {
  if (explicit) return explicit;
  const text = prompt.toLowerCase();
  if (/\b(family|kids?|children|stroller|aquarium)\b/.test(text)) {
    return 'rainy_family';
  }
  if (
    /\b(weekend|budget|compar(e|ing)|under\s*\$|\$\s*\d+|3\s+.*hotels?|three\s+.*hotels?|basecamp)\b/.test(
      text,
    )
  ) {
    return 'weekend_budget';
  }
  return 'afternoon_gap';
}

/** Extracts an explicit `$NNN` budget cap from the prompt, or returns the scenario default. */
export function extractBudgetCap(prompt: string, fallback: number): number {
  const match = /\$\s*(\d{2,4})\b/.exec(prompt);
  if (!match?.[1]) return fallback;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed >= 50 ? parsed : fallback;
}

function statsCall(includeHotel: boolean) {
  return call('tripStats', {
    stops: bind('/stops'),
    ...(includeHotel ? {hotel: bind('/hotel')} : {}),
    budgetCap: bind('/budgetCap'),
  });
}

function composeComponents(fixture: ScenarioFixture): A2uiComponent[] {
  const hasHotel = fixture.hotel !== undefined;
  const liveStats = statsCall(hasHotel);
  const followUp = event('ask_local_spots', {
    neighborhood: bind('/neighborhood'),
    stopTitle: call('selectedStopTitle', {
      stops: bind('/stops'),
      selectedStopId: bind('/selectedStopId'),
    }),
  });

  if (fixture.id === 'afternoon_gap') {
    // Composition A: WeatherRibbon + SplitStage(TimelineStrip[SwapDeck slotted], RouteMinimap) + ActionFooter
    // Deliberately omits BudgetSplitBar; slots SwapDeck directly inside TimelineStrip.
    return [
      component('root', 'StudioShell', {
        title: fixture.title,
        subtitle: bind('/summaryLine'),
        badge: bind('/statusBadge'),
        stats: liveStats,
        children: ['weather_main', 'stage_main'],
        footer: 'footer_main',
      }),
      component('weather_main', 'WeatherRibbon', {
        hours: bind('/weather'),
        alertText: bind('/weatherAlert'),
      }),
      component('stage_main', 'SplitStage', {
        ratio: 'wideLeft',
        children: ['timeline_main', 'map_main'],
      }),
      component('timeline_main', 'TimelineStrip', {
        stops: bind('/stops'),
        selectedStopId: bind('/selectedStopId'),
        stats: liveStats,
        dayStartMin: 810,
        dayEndMin: 1290,
        activeChild: 'swap_stop_deck',
      }),
      component('swap_stop_deck', 'SwapDeck', {
        mode: 'stop',
        title: 'Swap selected stop',
        options: bind('/stopSwaps'),
        selectedStopId: bind('/selectedStopId'),
        stops: bind('/stops'),
      }),
      component('map_main', 'RouteMinimap', {
        stops: bind('/stops'),
        selectedStopId: bind('/selectedStopId'),
        neighborhood: bind('/neighborhood'),
        walkRadiusMinutes: 15,
      }),
      component('footer_main', 'ActionFooter', {
        status: bind('/statusNote'),
        lockLabel: 'Lock itinerary',
        lockAction: event('lock_itinerary', {
          scenario: fixture.id,
          stops: bind('/stops'),
          budgetCap: bind('/budgetCap'),
        }),
        rainLabel: 'Rain reschedule',
        rainAction: event('rain_reschedule', {
          scenario: fixture.id,
          stops: bind('/stops'),
        }),
        followUpLabel: 'Ask local spots',
        followUpAction: followUp,
      }),
    ];
  }

  if (fixture.id === 'weekend_budget') {
    // Composition B: BudgetSplitBar + top-level hotel SwapDeck + SplitStage(RouteMinimap, TimelineStrip) + ActionFooter
    // Deliberately omits WeatherRibbon and TimelineStrip child slot; cross-wires hotel SwapDeck to BudgetSplitBar & RouteMinimap.
    return [
      component('root', 'StudioShell', {
        title: fixture.title,
        subtitle: bind('/summaryLine'),
        badge: bind('/statusBadge'),
        stats: liveStats,
        children: ['budget_bar', 'hotel_deck', 'stage_main'],
        footer: 'footer_main',
      }),
      component('budget_bar', 'BudgetSplitBar', {
        stats: liveStats,
        budgetCap: bind('/budgetCap'),
      }),
      component('hotel_deck', 'SwapDeck', {
        mode: 'hotel',
        title: 'Compare 2-night neighborhood hotels',
        options: bind('/hotelSwaps'),
        hotel: bind('/hotel'),
      }),
      component('stage_main', 'SplitStage', {
        ratio: 'wideRight',
        children: ['map_main', 'timeline_main'],
      }),
      component('map_main', 'RouteMinimap', {
        stops: bind('/stops'),
        hotel: bind('/hotel'),
        selectedStopId: bind('/selectedStopId'),
        neighborhood: bind('/neighborhood'),
        walkRadiusMinutes: 18,
      }),
      component('timeline_main', 'TimelineStrip', {
        stops: bind('/stops'),
        selectedStopId: bind('/selectedStopId'),
        stats: liveStats,
        dayStartMin: 510,
        dayEndMin: 1320,
      }),
      component('footer_main', 'ActionFooter', {
        status: bind('/statusNote'),
        lockLabel: 'Lock weekend plan',
        lockAction: event('lock_itinerary', {
          scenario: fixture.id,
          stops: bind('/stops'),
          hotel: bind('/hotel'),
          budgetCap: bind('/budgetCap'),
        }),
        followUpLabel: 'Ask local spots',
        followUpAction: followUp,
      }),
    ];
  }

  // Composition C (`rainy_family`): WeatherRibbon + BudgetSplitBar + SplitStage(TimelineStrip[SwapDeck], RouteMinimap) + ActionFooter
  return [
    component('root', 'StudioShell', {
      title: fixture.title,
      subtitle: bind('/summaryLine'),
      badge: bind('/statusBadge'),
      stats: liveStats,
      children: ['weather_main', 'budget_bar', 'stage_main'],
      footer: 'footer_main',
    }),
    component('weather_main', 'WeatherRibbon', {
      hours: bind('/weather'),
      alertText: bind('/weatherAlert'),
    }),
    component('budget_bar', 'BudgetSplitBar', {
      stats: liveStats,
      budgetCap: bind('/budgetCap'),
    }),
    component('stage_main', 'SplitStage', {
      ratio: 'wideLeft',
      children: ['timeline_main', 'map_main'],
    }),
    component('timeline_main', 'TimelineStrip', {
      stops: bind('/stops'),
      selectedStopId: bind('/selectedStopId'),
      stats: liveStats,
      dayStartMin: 540,
      dayEndMin: 1080,
      activeChild: 'swap_stop_deck',
    }),
    component('swap_stop_deck', 'SwapDeck', {
      mode: 'stop',
      title: 'Swap family stop',
      options: bind('/stopSwaps'),
      selectedStopId: bind('/selectedStopId'),
      stops: bind('/stops'),
    }),
    component('map_main', 'RouteMinimap', {
      stops: bind('/stops'),
      selectedStopId: bind('/selectedStopId'),
      neighborhood: bind('/neighborhood'),
      walkRadiusMinutes: 12,
    }),
    component('footer_main', 'ActionFooter', {
      status: bind('/statusNote'),
      lockLabel: 'Lock family plan',
      lockAction: event('lock_itinerary', {
        scenario: fixture.id,
        stops: bind('/stops'),
        budgetCap: bind('/budgetCap'),
      }),
      rainLabel: 'Rain reschedule',
      rainAction: event('rain_reschedule', {
        scenario: fixture.id,
        stops: bind('/stops'),
      }),
      followUpLabel: 'Ask local spots',
      followUpAction: followUp,
    }),
  ];
}

function buildSummaryText(
  fixture: ScenarioFixture,
  budgetCap: number,
  components: readonly A2uiComponent[],
): string {
  const stats = computeTripStats(fixture.stops, fixture.hotel, budgetCap);
  const componentTypes = [...new Set(components.map(c => c.component))].join(', ');
  const stopLines = fixture.stops.map(stop => {
    const diag = stats.byStop[stop.id];
    const walk = diag && diag.walkMin > 0 ? `, ${diag.walkMin}m walk` : '';
    return `- ${formatClock(stop.startMin)}–${formatClock(stop.startMin + stop.durationMin)} ${stop.title} (${stop.area}, $${stop.cost}, ${stop.indoor ? 'indoor' : 'outdoor'}, open ${formatClock(stop.openMin)}–${formatClock(stop.closeMin)}${walk})`;
  });

  const sections: string[] = [
    `Rendered ${fixture.title} (${fixture.id}, neighborhood: ${fixture.neighborhood}) with custom components: ${componentTypes}.`,
    `Totals: $${stats.totalCost} total spend${budgetCap > 0 ? ` against $${budgetCap} cap ($${Math.abs(stats.remainingBudget)} ${stats.overBudget ? 'over' : 'under'} cap)` : ''} [stay $${stats.categories.stay}, food $${stats.categories.food}, tickets $${stats.categories.tickets}, transit $${stats.categories.transit}], ${stats.totalWalkMin}m total walking, ${stats.conflictCount} schedule conflicts.`,
  ];

  if (fixture.weather && fixture.weather.length > 0) {
    const hoursLine = fixture.weather
      .map(h => `${h.label} ${h.tempC}°C (${h.condition}, ${h.rainPct}% rain)`)
      .join(', ');
    sections.push(
      `Weather window${fixture.weatherAlert ? ` (${fixture.weatherAlert})` : ''}: ${hoursLine}.`,
    );
  }

  if (fixture.hotel) {
    sections.push(
      `Selected basecamp hotel: ${fixture.hotel.name} (${fixture.hotel.area}, $${fixture.hotel.totalCost} for ${fixture.hotel.nights} nights + $${fixture.hotel.transitCost} transit, ${fixture.hotel.tag}).`,
    );
  }

  if (fixture.hotelSwaps && fixture.hotelSwaps.length > 0) {
    sections.push(
      'Hotel swap options in card:',
      ...fixture.hotelSwaps.map(
        opt =>
          `  * [${opt.badge}] ${opt.title} (${opt.area}): $${opt.cost} stay + $${opt.transitCost ?? 0} transit — ${opt.reason}`,
      ),
    );
  }

  sections.push('Scheduled stops:', ...stopLines);

  if (fixture.stopSwaps) {
    const swapLines: string[] = [];
    for (const stop of fixture.stops) {
      const opts = fixture.stopSwaps[stop.id];
      if (!opts || opts.length === 0 || stop.locked) continue;
      const summary = opts
        .map(
          opt =>
            `[${opt.badge}] ${opt.title} ($${opt.cost}, ${opt.indoor ? 'indoor' : 'outdoor'}: ${opt.reason})`,
        )
        .join('; ');
      swapLines.push(`  * Alternatives for ${stop.title}: ${summary}`);
    }
    if (swapLines.length > 0) {
      sections.push('Stop swap options in card:', ...swapLines);
    }
  }

  sections.push(
    "Make trip_studio the final tool call of your turn: never call read_file, run_command, or any other tool in parallel after trip_studio or after trip_studio returns, because the interactive A2UI studio is already rendered inline for the user and any subsequent tool call collapses the app into the 'Worked for' block. Answer directly from this tool's text summary.",
  );

  return sections.join('\n');
}

export interface ComposedStudio {
  readonly scenario: ScenarioId;
  readonly surfaceId: string;
  readonly text: string;
  readonly a2ui: A2uiMessage[];
}

export function composeTripStudio(
  prompt: string,
  explicitScenario?: ScenarioId,
  surfaceId = `trip_${resolveScenario(prompt, explicitScenario)}`,
): ComposedStudio {
  const scenario = resolveScenario(prompt, explicitScenario);
  const fixture = SCENARIO_FIXTURES[scenario];
  const budgetCap = extractBudgetCap(prompt, fixture.defaultBudgetCap);
  const components = composeComponents(fixture);

  const dataModel: Record<string, unknown> = {
    scenario: fixture.id,
    neighborhood: fixture.neighborhood,
    summaryLine: fixture.subtitle,
    statusBadge: 'Draft',
    statusNote:
      scenario === 'weekend_budget'
        ? 'Click any hotel card or stop time to compare live budget and walk legs.'
        : 'Click a stop or pin to shift times by 15m or swap to an indoor rain backup.',
    budgetCap,
    selectedStopId: fixture.selectedStopId,
    stops: structuredClone(fixture.stops),
    ...(fixture.weather ? {weather: structuredClone(fixture.weather)} : {}),
    ...(fixture.weatherAlert ? {weatherAlert: fixture.weatherAlert} : {}),
    ...(fixture.hotel ? {hotel: structuredClone(fixture.hotel)} : {}),
    ...(fixture.hotelSwaps ? {hotelSwaps: structuredClone(fixture.hotelSwaps)} : {}),
    ...(fixture.stopSwaps ? {stopSwaps: structuredClone(fixture.stopSwaps)} : {}),
  };

  const bytes = jsonBytes(dataModel);
  if (bytes > MAX_DATA_MODEL_BYTES) {
    throw new Error(
      `Data model for ${scenario} is ${bytes} bytes (limit ${MAX_DATA_MODEL_BYTES}).`,
    );
  }

  return {
    scenario,
    surfaceId,
    text: buildSummaryText(fixture, budgetCap, components),
    a2ui: createSurfaceMessages({
      surfaceId,
      sendDataModel: true,
      components,
      dataModel,
    }),
  };
}
