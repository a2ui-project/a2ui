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
 * The triage dashboard: KPI cards, filters (a Slider for the staleness
 * threshold and a DateTimeInput for the chart start) that refresh in place,
 * and tabs with a Vega-Lite chart of issues opened per week, counts by
 * priority and component with drill-down buttons, stale PRs and the oldest
 * untriaged issues.
 */

import type {GhPullRequest} from '../github/types.js';
import {
  type DashboardFilters,
  type DashboardStats,
  MAX_STALE_DAYS,
  MIN_STALE_DAYS,
} from '../triage/dashboard_stats.js';
import {
  type A2uiComponent,
  type A2uiMessage,
  bind,
  button,
  component,
  event,
  format,
  type SurfaceView,
  text,
  updateData,
} from './a2ui.js';
import {age, ago, safeTitle} from './format.js';

export const DASHBOARD_SURFACE = 'triage-dashboard';

/** Bucket colors: GitHub-like reds to grays, untriaged in blue. */
const BUCKET_COLORS: Record<string, string> = {
  P0: '#b60205',
  P1: '#d93f0b',
  P2: '#fbca04',
  P3: '#0e8a16',
  P4: '#bfbfbf',
  untriaged: '#1d76db',
};

export interface DashboardInput {
  readonly repo: string;
  readonly filters: DashboardFilters;
  readonly stats: DashboardStats;
  /** Stale PRs with line counts, for the diff stats. */
  readonly stalePulls: readonly GhPullRequest[];
  readonly now: Date;
}

/** The Vega-Lite spec of the opened-per-week chart, with its data inline. */
export function weeklyChart(stats: DashboardStats): Record<string, unknown> {
  const buckets = [...new Set(stats.weekly.map(row => row.bucket))];
  const domain = Object.keys(BUCKET_COLORS).filter(bucket => buckets.includes(bucket));
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    description: 'Open issues by the week they were opened, stacked by priority.',
    width: 'container',
    data: {values: stats.weekly},
    mark: {type: 'bar', tooltip: true},
    encoding: {
      x: {field: 'week', type: 'ordinal', title: 'Week opened', axis: {labelAngle: -45}},
      y: {field: 'count', type: 'quantitative', title: 'Open issues', stack: 'zero'},
      color: {
        field: 'bucket',
        type: 'nominal',
        title: 'Priority',
        scale: {domain, range: domain.map(bucket => BUCKET_COLORS[bucket])},
      },
      order: {field: 'bucket'},
    },
  };
}

/** The data model parts that change with the filters. */
export function dashboardData(input: DashboardInput) {
  const {stats, now} = input;
  return {
    kpis: {
      openIssues: stats.openIssues,
      untriaged: stats.untriaged,
      openPulls: stats.openPulls,
      stalePulls: stats.stalePulls,
    },
    chart: weeklyChart(stats),
    openedSince: stats.openedSince,
    byPriority: stats.byPriority.map(row => ({
      ...row,
      label: row.bucket === 'untriaged' ? 'Untriaged' : row.bucket,
      filterLabel: row.bucket === 'untriaged' ? '' : row.bucket,
    })),
    byComponent: stats.byComponent,
    stale: input.stalePulls.slice(0, 5).map(pull => ({
      number: pull.number,
      title: safeTitle(pull, 90),
      author: pull.author.login,
      avatarUrl: pull.author.avatarUrl,
      idle: age(pull.updatedAt, now),
      additions: pull.additions,
      deletions: pull.deletions,
    })),
    oldest: stats.oldestUntriaged.map(issue => ({
      number: issue.number,
      title: safeTitle(issue, 90),
      author: issue.author.login,
      avatarUrl: issue.author.avatarUrl,
      age: ago(issue.createdAt, now),
    })),
  };
}

function kpi(id: string, value: string, label: string): A2uiComponent[] {
  return [
    component(id, 'Card', {child: `${id}_column`, weight: 1}),
    component(`${id}_column`, 'Column', {children: [`${id}_value`, `${id}_label`]}),
    text(`${id}_value`, format(`**\${formatNumber(value:\${${value}})}**`)),
    text(`${id}_label`, label, 'caption'),
  ];
}

export function composeDashboard(input: DashboardInput): SurfaceView {
  const components: A2uiComponent[] = [
    component('root', 'Column', {children: ['title', 'kpis', 'filters', 'tabs']}),
    text('title', format('**Triage dashboard** · ${/repo}')),
    component('kpis', 'Row', {children: ['kpi_open', 'kpi_untriaged', 'kpi_prs', 'kpi_stale']}),
    ...kpi('kpi_open', '/kpis/openIssues', 'open issues'),
    ...kpi('kpi_untriaged', '/kpis/untriaged', 'untriaged'),
    ...kpi('kpi_prs', '/kpis/openPulls', 'open PRs'),
    ...kpi('kpi_stale', '/kpis/stalePulls', 'stale PRs'),
    component('filters', 'Card', {child: 'filters_column'}),
    // The Slider shows its value at the end of its row, so it gets a row of its own.
    component('filters_column', 'Column', {children: ['stale_days', 'filters_row']}),
    component('filters_row', 'Row', {children: ['since', 'update'], align: 'end'}),
    component('stale_days', 'Slider', {
      label: format('PRs are stale after ${/filters/staleDays} days'),
      min: MIN_STALE_DAYS,
      max: MAX_STALE_DAYS,
      value: bind('/filters/staleDays'),
    }),
    component('since', 'DateTimeInput', {
      label: 'Chart issues opened since',
      enableDate: true,
      enableTime: false,
      max: bind('/today'),
      value: bind('/filters/since'),
      weight: 1,
    }),
    ...button(
      'update',
      'Update',
      event('refresh', {view: 'dashboard', filters: bind('/filters')}),
      {
        variant: 'primary',
      },
    ),
    component('tabs', 'Tabs', {
      tabs: [
        {title: 'Opened over time', child: 'chart_column'},
        {title: 'By priority', child: 'priority_list'},
        {title: 'By component', child: 'component_list'},
        {title: format('Stale PRs (${/kpis/stalePulls})'), child: 'stale_list'},
        {title: 'Oldest untriaged', child: 'oldest_list'},
      ],
    }),
    component('chart_column', 'Column', {children: ['chart_caption', 'chart']}),
    text(
      'chart_caption',
      format(
        "${/openedSince} open ${pluralize(value:${/openedSince}, one:'issue', other:'issues')} opened since ${/filters/since}, by week and priority",
      ),
      'caption',
    ),
    component('chart', 'VegaChart', {spec: bind('/chart'), height: 260}),
    component('priority_list', 'List', {
      children: {componentId: 'priority_row', path: '/byPriority'},
    }),
    component('priority_row', 'Row', {
      children: ['priority_label', 'priority_open'],
      justify: 'spaceBetween',
      align: 'center',
    }),
    text('priority_label', format('**${label}**: ${count}')),
    ...button(
      'priority_open',
      'Show in inbox',
      event('inbox_label', {label: bind('filterLabel')}),
      {variant: 'borderless'},
    ),
    component('component_list', 'List', {
      children: {componentId: 'component_row', path: '/byComponent'},
    }),
    component('component_row', 'Row', {
      children: ['component_chip', 'component_count', 'component_open'],
      align: 'center',
    }),
    component('component_chip', 'LabelChip', {name: bind('label'), color: 'c5def5'}),
    text('component_count', format('${count} open'), 'caption'),
    ...button('component_open', 'Show in inbox', event('inbox_label', {label: bind('label')}), {
      variant: 'borderless',
    }),
    component('stale_list', 'List', {children: {componentId: 'stale_row', path: '/stale'}}),
    component('stale_row', 'Row', {
      children: ['stale_avatar', 'stale_main', 'stale_diff', 'stale_open'],
      align: 'center',
    }),
    component('stale_avatar', 'Avatar', {login: bind('author'), url: bind('avatarUrl')}),
    component('stale_main', 'Column', {children: ['stale_title', 'stale_meta'], weight: 1}),
    text('stale_title', format('#${number} ${title}')),
    text('stale_meta', format('@${author} · idle ${idle}'), 'caption'),
    component('stale_diff', 'DiffStat', {
      additions: bind('additions'),
      deletions: bind('deletions'),
    }),
    ...button('stale_open', 'Review', event('open_pull', {number: bind('number')}), {
      variant: 'borderless',
    }),
    component('oldest_list', 'List', {children: {componentId: 'oldest_row', path: '/oldest'}}),
    component('oldest_row', 'Row', {
      children: ['oldest_avatar', 'oldest_main', 'oldest_open'],
      align: 'center',
    }),
    component('oldest_avatar', 'Avatar', {login: bind('author'), url: bind('avatarUrl')}),
    component('oldest_main', 'Column', {children: ['oldest_title', 'oldest_meta'], weight: 1}),
    text('oldest_title', format('#${number} ${title}')),
    text('oldest_meta', format('@${author} · opened ${age}'), 'caption'),
    ...button('oldest_open', 'Triage', event('open_issue', {number: bind('number')}), {
      variant: 'borderless',
    }),
  ];
  return {
    surfaceId: DASHBOARD_SURFACE,
    sendDataModel: false,
    components,
    dataModel: {
      repo: input.repo,
      today: input.now.toISOString().slice(0, 10),
      filters: {...input.filters},
      ...dashboardData(input),
    },
  };
}

/** Messages that refresh the dashboard data in place after a filter change. */
export function dashboardUpdateMessages(input: DashboardInput): A2uiMessage[] {
  return [
    updateData(DASHBOARD_SURFACE, '/filters', {...input.filters}),
    ...Object.entries(dashboardData(input)).map(([key, value]) =>
      updateData(DASHBOARD_SURFACE, `/${key}`, value),
    ),
  ];
}

export function summarizeDashboard(input: DashboardInput): string {
  const {stats, filters} = input;
  return [
    `Triage dashboard for ${input.repo}: ${stats.openIssues} open issues (newest ${stats.openIssues} read), ${stats.untriaged} untriaged, ${stats.openPulls} open PRs, ${stats.stalePulls} stale (no update for ${filters.staleDays}+ days).`,
    `By priority: ${stats.byPriority.map(row => `${row.bucket} ${row.count}`).join(', ')}.`,
    `Top components: ${stats.byComponent.map(row => `${row.label} ${row.count}`).join(', ') || 'none'}.`,
    `Chart: ${stats.openedSince} open issues opened since ${filters.since}, per week, stacked by priority.`,
    `Stale PRs shown: ${
      input.stalePulls
        .slice(0, 5)
        .map(pull => `#${pull.number} (idle ${age(pull.updatedAt, input.now)})`)
        .join(', ') || 'none'
    }.`,
    `Oldest untriaged: ${stats.oldestUntriaged.map(issue => `#${issue.number} (${age(issue.createdAt, input.now)})`).join(', ') || 'none'}.`,
    'The user can move the staleness Slider and the "opened since" date and press Update (refreshes in place), switch tabs, and drill down: "Show in inbox", "Review" and "Triage" buttons send a follow-up message.',
  ].join('\n');
}
