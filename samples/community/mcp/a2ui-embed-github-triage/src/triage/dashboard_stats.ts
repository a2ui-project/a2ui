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

/** The numbers behind the triage dashboard. */

import type {GhIssue, GhPullRequest} from '../github/types.js';
import {COMPONENT_PREFIX, daysSince, isUntriaged, priorityOf} from './rules.js';

/** Dashboard filters, as the filter form holds them. */
export interface DashboardFilters {
  /** PRs not updated for this many days are stale. */
  readonly staleDays: number;
  /** First day (`YYYY-MM-DD`) of the opened-over-time chart. */
  readonly since: string;
}

export const MIN_STALE_DAYS = 7;
export const MAX_STALE_DAYS = 180;

/** Default filters: stale after 30 days, chart from 12 weeks ago. */
export function defaultFilters(now: Date): DashboardFilters {
  return {staleDays: 30, since: isoDay(new Date(now.getTime() - 84 * 86_400_000))};
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Clamps filters into their allowed ranges; an invalid date falls back to the default. */
export function normalizeFilters(
  filters: Partial<DashboardFilters> | undefined,
  now: Date,
): DashboardFilters {
  const defaults = defaultFilters(now);
  const staleDays = Math.round(Number(filters?.staleDays ?? defaults.staleDays));
  const day = /^\d{4}-\d{2}-\d{2}/.exec(filters?.since ?? '')?.[0];
  return {
    staleDays: Number.isFinite(staleDays)
      ? Math.min(MAX_STALE_DAYS, Math.max(MIN_STALE_DAYS, staleDays))
      : defaults.staleDays,
    since: day && !Number.isNaN(Date.parse(day)) && day <= isoDay(now) ? day : defaults.since,
  };
}

/** Monday (UTC) of the week of `iso`, as `YYYY-MM-DD`. */
export function weekOf(iso: string): string {
  const date = new Date(iso);
  const offset = (date.getUTCDay() + 6) % 7;
  return isoDay(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset)),
  );
}

/** The priority bucket of an issue for charts: its priority label or `untriaged`. */
export function bucketOf(issue: GhIssue): string {
  return priorityOf(issue) ?? 'untriaged';
}

export const BUCKETS = ['P0', 'P1', 'P2', 'P3', 'P4', 'untriaged'] as const;

export interface DashboardStats {
  readonly openIssues: number;
  readonly untriaged: number;
  readonly openPulls: number;
  readonly stalePulls: number;
  readonly byPriority: Array<{bucket: string; count: number}>;
  readonly byComponent: Array<{label: string; count: number}>;
  /** Open issues opened per week since `filters.since`, by bucket. */
  readonly weekly: Array<{week: string; bucket: string; count: number}>;
  readonly openedSince: number;
  readonly stale: GhPullRequest[];
  readonly oldestUntriaged: GhIssue[];
}

/** Computes the dashboard numbers from open issues and PRs. */
export function dashboardStats(
  issues: readonly GhIssue[],
  pulls: readonly GhPullRequest[],
  filters: DashboardFilters,
  now: Date,
): DashboardStats {
  const priorityCounts = new Map<string, number>();
  const componentCounts = new Map<string, number>();
  for (const issue of issues) {
    priorityCounts.set(bucketOf(issue), (priorityCounts.get(bucketOf(issue)) ?? 0) + 1);
    for (const label of issue.labels) {
      if (label.name.toLowerCase().startsWith(COMPONENT_PREFIX)) {
        componentCounts.set(label.name, (componentCounts.get(label.name) ?? 0) + 1);
      }
    }
  }
  const weeklyCounts = new Map<string, number>();
  const recent = issues.filter(issue => issue.createdAt.slice(0, 10) >= filters.since);
  for (const issue of recent) {
    const key = `${weekOf(issue.createdAt)}|${bucketOf(issue)}`;
    weeklyCounts.set(key, (weeklyCounts.get(key) ?? 0) + 1);
  }
  const stale = pulls
    .filter(pull => daysSince(pull.updatedAt, now) >= filters.staleDays)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return {
    openIssues: issues.length,
    untriaged: issues.filter(isUntriaged).length,
    openPulls: pulls.length,
    stalePulls: stale.length,
    byPriority: BUCKETS.filter(bucket => priorityCounts.has(bucket)).map(bucket => ({
      bucket,
      count: priorityCounts.get(bucket) ?? 0,
    })),
    byComponent: [...componentCounts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([label, count]) => ({label, count})),
    weekly: [...weeklyCounts]
      .map(([key, count]) => {
        const [week = '', bucket = ''] = key.split('|');
        return {week, bucket, count};
      })
      .sort((a, b) => a.week.localeCompare(b.week) || a.bucket.localeCompare(b.bucket)),
    openedSince: recent.length,
    stale,
    oldestUntriaged: issues
      .filter(isUntriaged)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, 5),
  };
}
