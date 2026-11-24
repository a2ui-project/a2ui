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

import {describe, expect, it} from 'vitest';

import {
  computeTripStats,
  formatClock,
  resolveSelectedStopTitle,
  TRIP_CATALOG_ID,
  tripCatalog,
  type HotelItem,
  type StopItem,
} from './index.js';

describe('tripCatalog', () => {
  it('registers only custom Day & Trip Studio components and zero basicCatalog components', () => {
    expect(tripCatalog.id).toBe(TRIP_CATALOG_ID);
    const componentNames = [...tripCatalog.components.keys()].sort();
    expect(componentNames).toEqual([
      'ActionFooter',
      'BudgetSplitBar',
      'RouteMinimap',
      'SplitStage',
      'StudioShell',
      'SwapDeck',
      'TimelineStrip',
      'WeatherRibbon',
    ]);
    for (const forbidden of ['Text', 'Button', 'Row', 'Column', 'Card', 'Icon', 'ChoicePicker']) {
      expect(componentNames).not.toContain(forbidden);
    }
    expect([...tripCatalog.functions.keys()].sort()).toEqual(['selectedStopTitle', 'tripStats']);
  });
});

describe('computeTripStats & catalog functions', () => {
  const stops: StopItem[] = [
    {
      id: 's_one',
      title: 'Espresso Stop',
      area: 'Baixa',
      category: 'food',
      startMin: 600,
      durationMin: 45,
      openMin: 480,
      closeMin: 1080,
      cost: 15,
      indoor: true,
      x: 20,
      y: 30,
    },
    {
      id: 's_two',
      title: 'Tile Museum',
      area: 'Alfama',
      category: 'tickets',
      startMin: 690,
      durationMin: 60,
      openMin: 600,
      closeMin: 1020,
      cost: 30,
      indoor: true,
      x: 70,
      y: 30,
    },
  ];

  const hotel: HotelItem = {
    id: 'h_baixa',
    name: 'Baixa Hotel',
    area: 'Baixa',
    nights: 2,
    totalCost: 320,
    transitCost: 20,
    x: 10,
    y: 30,
    tag: '★ Agent pick',
  };

  it('computes category breakdown, budget headroom, and walking legs with zero conflicts', () => {
    const stats = computeTripStats(stops, hotel, 450);
    expect(stats.categories).toEqual({food: 15, tickets: 30, transit: 20, stay: 320});
    expect(stats.totalCost).toBe(385);
    expect(stats.remainingBudget).toBe(65);
    expect(stats.overBudget).toBe(false);
    expect(stats.totalWalkMin).toBeGreaterThan(15);
    expect(stats.conflictCount).toBe(0);
  });

  it('flags tight transfer, schedule overlap, and closing-hour conflicts', () => {
    const conflicted: StopItem[] = [
      stops[0]!,
      {
        ...stops[1]!,
        startMin: 650, // only 5m gap for a ~17m walk
        durationMin: 400, // ends at 1050 > closeMin 1020
      },
    ];
    const stats = computeTripStats(conflicted, undefined, 100);
    expect(stats.conflictCount).toBe(1);
    expect(stats.byStop['s_two']?.rushWarning).toContain('Tight:');
    expect(stats.byStop['s_two']?.hoursWarning).toBe('Closes 17:00');
  });

  it('resolves clock formatting and selected stop title', () => {
    expect(formatClock(840)).toBe('14:00');
    expect(formatClock(950)).toBe('15:50');
    expect(resolveSelectedStopTitle(stops, 's_two')).toBe('Tile Museum');
    expect(resolveSelectedStopTitle(stops, 'missing')).toBe('Espresso Stop');
  });
});
