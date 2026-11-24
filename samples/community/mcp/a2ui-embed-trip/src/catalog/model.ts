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
 * Shared domain model and pure reactive statistics for Day & Trip Studio.
 * Runs identically in the browser catalog functions/components and on the MCP server.
 */

export type SpendCategory = 'food' | 'tickets' | 'transit' | 'stay';

export interface StopItem {
  readonly id: string;
  readonly title: string;
  readonly area: string;
  readonly category: SpendCategory;
  readonly startMin: number;
  readonly durationMin: number;
  readonly openMin: number;
  readonly closeMin: number;
  readonly cost: number;
  readonly indoor: boolean;
  readonly x: number;
  readonly y: number;
  readonly locked?: boolean;
  readonly note?: string;
  readonly optionId?: string;
}

export interface HotelItem {
  readonly id: string;
  readonly name: string;
  readonly area: string;
  readonly nights: number;
  readonly totalCost: number;
  readonly transitCost: number;
  readonly x: number;
  readonly y: number;
  readonly tag: string;
}

export type WeatherCondition = 'sun' | 'cloud' | 'rain';

export interface WeatherHour {
  readonly hour: number;
  readonly label: string;
  readonly tempC: number;
  readonly rainPct: number;
  readonly condition: WeatherCondition;
}

export interface SwapOption {
  readonly id: string;
  readonly badge: string;
  readonly reason: string;
  readonly title: string;
  readonly area: string;
  readonly category: SpendCategory;
  readonly cost: number;
  readonly durationMin?: number;
  readonly openMin?: number;
  readonly closeMin?: number;
  readonly indoor?: boolean;
  readonly nights?: number;
  readonly transitCost?: number;
  readonly x: number;
  readonly y: number;
}

export interface CategoryTotals {
  readonly food: number;
  readonly tickets: number;
  readonly transit: number;
  readonly stay: number;
}

export interface StopDiag {
  readonly stopId: string;
  readonly walkMin: number;
  readonly fromLabel: string;
  readonly gapMin: number | null;
  readonly rushWarning: string | null;
  readonly hoursWarning: string | null;
  readonly hasConflict: boolean;
}

export interface TripStats {
  readonly totalCost: number;
  readonly budgetCap: number;
  readonly remainingBudget: number;
  readonly overBudget: boolean;
  readonly categories: CategoryTotals;
  readonly totalWalkMin: number;
  readonly conflictCount: number;
  readonly byStop: Readonly<Record<string, StopDiag>>;
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return !Array.isArray(val) && typeof val === 'object' && val !== null;
}

function num(val: unknown, fallback = 0): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

function str(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

function categoryOf(val: unknown): SpendCategory {
  if (val === 'food' || val === 'tickets' || val === 'transit' || val === 'stay') {
    return val;
  }
  return 'tickets';
}

function conditionOf(val: unknown): WeatherCondition {
  if (val === 'sun' || val === 'cloud' || val === 'rain') {
    return val;
  }
  return 'cloud';
}

/** Formats minutes since midnight (such as `945`) as `15:45`. */
export function formatClock(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 + 59, Math.round(totalMinutes)));
  const h = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Walking minutes between two projected `(x, y)` coordinates in `0..100` space. */
export function estimateWalkMinutes(x1: number, y1: number, x2: number, y2: number): number {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  if (dist < 1) return 2;
  return Math.max(4, Math.round(dist * 0.34));
}

export function parseStops(raw: unknown): StopItem[] {
  if (!Array.isArray(raw)) return [];
  const items: StopItem[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = str(entry['id']);
    if (!id) continue;
    items.push({
      id,
      title: str(entry['title'], 'Untitled stop'),
      area: str(entry['area'], 'Center'),
      category: categoryOf(entry['category']),
      startMin: num(entry['startMin'], 840),
      durationMin: Math.max(15, num(entry['durationMin'], 60)),
      openMin: num(entry['openMin'], 480),
      closeMin: num(entry['closeMin'], 1320),
      cost: Math.max(0, num(entry['cost'], 0)),
      indoor: Boolean(entry['indoor']),
      x: num(entry['x'], 50),
      y: num(entry['y'], 50),
      ...(typeof entry['locked'] === 'boolean' ? {locked: entry['locked']} : {}),
      ...(typeof entry['note'] === 'string' ? {note: entry['note']} : {}),
      ...(typeof entry['optionId'] === 'string' ? {optionId: entry['optionId']} : {}),
    });
  }
  return items;
}

export function parseHotel(raw: unknown): HotelItem | undefined {
  if (!isRecord(raw)) return undefined;
  const id = str(raw['id']);
  if (!id) return undefined;
  return {
    id,
    name: str(raw['name'], 'Hotel'),
    area: str(raw['area'], 'Center'),
    nights: Math.max(1, num(raw['nights'], 1)),
    totalCost: Math.max(0, num(raw['totalCost'], 0)),
    transitCost: Math.max(0, num(raw['transitCost'], 0)),
    x: num(raw['x'], 50),
    y: num(raw['y'], 50),
    tag: str(raw['tag'], 'Basecamp'),
  };
}

export function parseWeatherHours(raw: unknown): WeatherHour[] {
  if (!Array.isArray(raw)) return [];
  const hours: WeatherHour[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    hours.push({
      hour: num(entry['hour'], 12),
      label: str(entry['label'], '12p'),
      tempC: num(entry['tempC'], 18),
      rainPct: Math.max(0, Math.min(100, num(entry['rainPct'], 0))),
      condition: conditionOf(entry['condition']),
    });
  }
  return hours;
}

export function parseSwapList(raw: unknown): SwapOption[] {
  if (!Array.isArray(raw)) return [];
  const out: SwapOption[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = str(entry['id']);
    if (!id) continue;
    out.push({
      id,
      badge: str(entry['badge'], 'Option'),
      reason: str(entry['reason'], ''),
      title: str(entry['title'], 'Option'),
      area: str(entry['area'], ''),
      category: categoryOf(entry['category']),
      cost: Math.max(0, num(entry['cost'], 0)),
      ...(typeof entry['durationMin'] === 'number' ? {durationMin: entry['durationMin']} : {}),
      ...(typeof entry['openMin'] === 'number' ? {openMin: entry['openMin']} : {}),
      ...(typeof entry['closeMin'] === 'number' ? {closeMin: entry['closeMin']} : {}),
      ...(typeof entry['indoor'] === 'boolean' ? {indoor: entry['indoor']} : {}),
      ...(typeof entry['nights'] === 'number' ? {nights: entry['nights']} : {}),
      ...(typeof entry['transitCost'] === 'number' ? {transitCost: entry['transitCost']} : {}),
      x: num(entry['x'], 50),
      y: num(entry['y'], 50),
    });
  }
  return out;
}

export function parseStopSwapsMap(raw: unknown): Record<string, SwapOption[]> {
  if (!isRecord(raw)) return {};
  const out: Record<string, SwapOption[]> = {};
  for (const [stopId, list] of Object.entries(raw)) {
    out[stopId] = parseSwapList(list);
  }
  return out;
}

export function parseTripStats(raw: unknown): TripStats | undefined {
  if (!isRecord(raw)) return undefined;
  const catsRaw = isRecord(raw['categories']) ? raw['categories'] : {};
  const byStopRaw = isRecord(raw['byStop']) ? raw['byStop'] : {};
  const byStop: Record<string, StopDiag> = {};
  for (const [stopId, diag] of Object.entries(byStopRaw)) {
    if (!isRecord(diag)) continue;
    byStop[stopId] = {
      stopId,
      walkMin: num(diag['walkMin'], 0),
      fromLabel: str(diag['fromLabel'], ''),
      gapMin: typeof diag['gapMin'] === 'number' ? diag['gapMin'] : null,
      rushWarning: typeof diag['rushWarning'] === 'string' ? diag['rushWarning'] : null,
      hoursWarning: typeof diag['hoursWarning'] === 'string' ? diag['hoursWarning'] : null,
      hasConflict: Boolean(diag['hasConflict']),
    };
  }
  return {
    totalCost: num(raw['totalCost'], 0),
    budgetCap: num(raw['budgetCap'], 0),
    remainingBudget: num(raw['remainingBudget'], 0),
    overBudget: Boolean(raw['overBudget']),
    categories: {
      food: num(catsRaw['food'], 0),
      tickets: num(catsRaw['tickets'], 0),
      transit: num(catsRaw['transit'], 0),
      stay: num(catsRaw['stay'], 0),
    },
    totalWalkMin: num(raw['totalWalkMin'], 0),
    conflictCount: num(raw['conflictCount'], 0),
    byStop,
  };
}

/**
 * Reactively computes total spend, category breakdown, walking leg minutes,
 * and schedule/open-hours conflicts across `stops` and `hotel`.
 */
export function computeTripStats(
  rawStops: unknown,
  rawHotel: unknown,
  rawBudgetCap: unknown,
): TripStats {
  const stops = parseStops(rawStops);
  const hotel = parseHotel(rawHotel);
  const budgetCap = Math.max(0, num(rawBudgetCap, 0));

  let food = 0;
  let tickets = 0;
  let transit = hotel ? hotel.transitCost : 0;
  let stay = hotel ? hotel.totalCost : 0;

  let totalWalkMin = 0;
  let conflictCount = 0;
  const byStop: Record<string, StopDiag> = {};

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!;
    if (stop.category === 'food') food += stop.cost;
    else if (stop.category === 'tickets') tickets += stop.cost;
    else if (stop.category === 'transit') transit += stop.cost;
    else if (stop.category === 'stay') stay += stop.cost;

    const prev = i > 0 ? stops[i - 1] : undefined;
    let walkMin = 0;
    let fromLabel = '';
    let gapMin: number | null = null;
    let rushWarning: string | null = null;

    if (prev) {
      walkMin = estimateWalkMinutes(prev.x, prev.y, stop.x, stop.y);
      fromLabel = prev.title;
      const prevEnd = prev.startMin + prev.durationMin;
      gapMin = stop.startMin - prevEnd;
      if (gapMin < 0) {
        rushWarning = `Overlap ${Math.abs(gapMin)}m`;
      } else if (gapMin < walkMin) {
        rushWarning = `Tight: ${gapMin}m gap for ${walkMin}m walk`;
      }
    } else if (hotel && stop.category !== 'stay') {
      walkMin = estimateWalkMinutes(hotel.x, hotel.y, stop.x, stop.y);
      fromLabel = hotel.name;
    }

    totalWalkMin += walkMin;

    const endMin = stop.startMin + stop.durationMin;
    let hoursWarning: string | null = null;
    if (stop.startMin < stop.openMin) {
      hoursWarning = `Opens ${formatClock(stop.openMin)}`;
    } else if (endMin > stop.closeMin) {
      hoursWarning = `Closes ${formatClock(stop.closeMin)}`;
    }

    const hasConflict = rushWarning !== null || hoursWarning !== null;
    if (hasConflict) conflictCount += 1;

    byStop[stop.id] = {
      stopId: stop.id,
      walkMin,
      fromLabel,
      gapMin,
      rushWarning,
      hoursWarning,
      hasConflict,
    };
  }

  const totalCost = Math.round(food + tickets + transit + stay);
  const remainingBudget = Math.round(budgetCap - totalCost);
  const overBudget = budgetCap > 0 && totalCost > budgetCap;

  return {
    totalCost,
    budgetCap,
    remainingBudget,
    overBudget,
    categories: {
      food: Math.round(food),
      tickets: Math.round(tickets),
      transit: Math.round(transit),
      stay: Math.round(stay),
    },
    totalWalkMin,
    conflictCount,
    byStop,
  };
}
