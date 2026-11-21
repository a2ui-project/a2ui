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

import {CAPTURED_AT, ISSUES, PULLS} from '../testing/synthetic_snapshot.js';
import {dashboardStats, normalizeFilters, weekOf} from './dashboard_stats.js';

const now = new Date(CAPTURED_AT);

describe('dashboardStats', () => {
  it('counts by priority and component, finds stale PRs and the oldest untriaged issues', () => {
    const stats = dashboardStats(ISSUES, PULLS, {staleDays: 30, since: '2026-10-01'}, now);
    expect(stats.openIssues).toBe(17);
    expect(stats.untriaged).toBe(14);
    expect(stats.byPriority).toEqual([
      {bucket: 'P1', count: 1},
      {bucket: 'P2', count: 1},
      {bucket: 'P3', count: 1},
      {bucket: 'untriaged', count: 14},
    ]);
    expect(stats.byComponent).toEqual([{label: 'component: specification', count: 1}]);
    expect(stats.stale.map(pull => pull.number)).toEqual([202]);
    expect(stats.oldestUntriaged[0]?.number).toBe(161);
    expect(stats.openedSince).toBe(16);
    expect(stats.weekly.reduce((sum, row) => sum + row.count, 0)).toBe(16);
  });

  it('clamps filters', () => {
    expect(normalizeFilters({staleDays: 1, since: 'soon'}, now)).toEqual({
      staleDays: 7,
      since: '2026-08-28',
    });
    expect(normalizeFilters({staleDays: 999, since: '2030-01-01'}, now).staleDays).toBe(180);
    expect(normalizeFilters({since: '2026-10-05T00:00'}, now).since).toBe('2026-10-05');
  });

  it('starts weeks on Monday', () => {
    expect(weekOf('2026-11-20T12:00:00Z')).toBe('2026-11-16');
    expect(weekOf('2026-11-16T00:00:00Z')).toBe('2026-11-16');
  });
});
