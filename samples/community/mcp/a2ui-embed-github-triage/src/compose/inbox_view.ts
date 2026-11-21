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
 * The triage inbox view: a filter form that refreshes in place, a multi-select
 * issue list with label chips and avatars, and a bulk edit dialog with a
 * preview and a confirm step. Selections live in the data model, which the app
 * shares with the model.
 */

import type {GhIssue, GhLabel, GhUser} from '../github/types.js';
import type {ItemPlan} from '../github/writes.js';
import {describeChange} from '../github/writes.js';
import {
  describeFilter,
  INBOX_SORT_LABELS,
  INBOX_SORTS,
  type InboxFilter,
} from '../triage/inbox_filter.js';
import {PRIORITY_MEANINGS, TRIAGE_PRIORITIES, triageLabels} from '../triage/rules.js';
import {
  type A2uiComponent,
  bind,
  button,
  call,
  component,
  event,
  format,
  options,
  type SurfaceView,
  text,
} from './a2ui.js';
import {ago, issueLine, labelData, safeTitle, writeModeSentence} from './format.js';

export const INBOX_SURFACE = 'triage-inbox';

/** Bulk priority option that leaves each issue's priority as it is. */
export const KEEP_PRIORITY = 'keep';

/** Login pattern GitHub allows, also accepting an empty author filter. */
export const LOGIN_PATTERN = '^@?[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$|^$';

/** An inbox row as the data model holds it. */
export interface InboxItem {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly avatarUrl: string;
  readonly labels: ReadonlyArray<{name: string; color: string}>;
  readonly comments: number;
  readonly age: string;
  readonly selected: boolean;
}

/** The data model of the filter form. */
export interface FilterFormData {
  readonly labels: string[];
  readonly author: string;
  readonly text: string;
  readonly sort: string[];
  readonly onlyUntriaged: boolean;
}

/** What the inbox view shows. */
export interface InboxInput {
  readonly repo: string;
  readonly filter: InboxFilter;
  /** Every issue matching the filter, sorted. */
  readonly matching: readonly GhIssue[];
  /** How many of `matching` to show. */
  readonly shown: number;
  readonly labels: readonly GhLabel[];
  readonly assignees: readonly GhUser[];
  readonly dryRunReason: string | undefined;
  readonly now: Date;
  /** Issue numbers to keep selected. */
  readonly selected?: ReadonlySet<number>;
}

export function filterFormData(filter: InboxFilter): FilterFormData {
  return {
    labels: [...filter.labels],
    author: filter.author,
    text: filter.text,
    sort: [filter.sort],
    onlyUntriaged: filter.onlyUntriaged,
  };
}

export function inboxItems(
  issues: readonly GhIssue[],
  now: Date,
  selected: ReadonlySet<number> = new Set(),
): InboxItem[] {
  return issues.map(issue => ({
    number: issue.number,
    title: safeTitle(issue, 72),
    author: issue.author.login,
    avatarUrl: issue.author.avatarUrl,
    labels: labelData(issue.labels).slice(0, 2),
    comments: issue.comments,
    age: ago(issue.createdAt, now),
    selected: selected.has(issue.number),
  }));
}

/** The empty bulk edit form. */
export function emptyBulkForm() {
  return {
    selection: '',
    priority: [],
    labels: [],
    assignee: [],
    preview: [],
    previewKey: '',
    status: '',
  };
}

/** The rows of a bulk preview: one line per issue. */
export function previewRows(plans: readonly ItemPlan[]) {
  return plans.map(plan => ({
    number: plan.number,
    title: plan.title,
    changes: plan.changes.length > 0 ? plan.changes.map(describeChange).join(', ') : 'no change',
  }));
}

/** The changing parts of the inbox data model, for in-place refreshes. */
export function inboxData(input: InboxInput) {
  const shown = input.matching.slice(0, input.shown);
  return {
    issues: inboxItems(shown, input.now, input.selected),
    shown: shown.length,
    total: input.matching.length,
    description: describeFilter(input.filter),
    hasMore: shown.length < input.matching.length,
  };
}

function filterCard(labels: readonly GhLabel[]): A2uiComponent[] {
  return [
    component('filter_modal', 'Modal', {trigger: 'filter_open', content: 'filter_form'}),
    ...button('filter_open', 'Filters…', event('open_dialog', {dialog: 'filters'})),
    component('filter_form', 'Column', {
      children: [
        'filter_title',
        'filter_labels',
        'filter_row',
        'filter_sort',
        'filter_actions',
        'filter_result',
      ],
    }),
    text('filter_title', '**Filter the inbox**'),
    text(
      'filter_result',
      format('Showing ${/shown} of ${formatNumber(value:${/total})}: ${/description}'),
      'caption',
    ),
    component('filter_labels', 'ChoicePicker', {
      label: 'Labels (all must match)',
      variant: 'multipleSelection',
      displayStyle: 'chips',
      filterable: true,
      options: options(triageLabels(labels).map(label => [label.name, label.name])),
      value: bind('/filter/labels'),
    }),
    component('filter_row', 'Row', {
      children: ['filter_author', 'filter_text'],
      align: 'start',
    }),
    component('filter_author', 'TextField', {
      label: 'Author',
      placeholder: 'login',
      value: bind('/filter/author'),
      weight: 1,
      '@checks': [
        {
          condition: call('regex', {value: bind('/filter/author'), pattern: LOGIN_PATTERN}),
          message: 'Enter a GitHub login, such as octocat.',
        },
      ],
    }),
    component('filter_text', 'TextField', {
      label: 'Text in title or body',
      value: bind('/filter/text'),
      weight: 1,
      '@checks': [
        {
          condition: call('length', {value: bind('/filter/text'), max: 80}),
          message: 'Use at most 80 characters.',
        },
      ],
    }),
    component('filter_sort', 'ChoicePicker', {
      label: 'Sort',
      variant: 'mutuallyExclusive',
      displayStyle: 'chips',
      options: options(INBOX_SORTS.map(sort => [sort, INBOX_SORT_LABELS[sort]])),
      value: bind('/filter/sort'),
    }),
    component('filter_actions', 'Row', {
      children: ['filter_untriaged', 'filter_apply'],
      justify: 'spaceBetween',
      align: 'center',
    }),
    component('filter_untriaged', 'CheckBox', {
      label: 'Only untriaged (no priority label)',
      value: bind('/filter/onlyUntriaged'),
    }),
    ...button('filter_apply', 'Apply filters', event('filter_inbox', {filter: bind('/filter')}), {
      variant: 'primary',
      checks: [
        {
          condition: call('regex', {value: bind('/filter/author'), pattern: LOGIN_PATTERN}),
          message: 'Fix the author filter first.',
        },
        {
          condition: call('length', {value: bind('/filter/text'), max: 80}),
          message: 'Shorten the text filter first.',
        },
      ],
    }),
  ];
}

function bulkDialog(labels: readonly GhLabel[], assignees: readonly GhUser[]): A2uiComponent[] {
  const bulkContext = (confirm: boolean) =>
    event('bulk_apply', {issues: bind('/issues'), bulk: bind('/bulk'), confirm});
  return [
    component('bulk_modal', 'Modal', {trigger: 'bulk_open', content: 'bulk_form'}),
    ...button('bulk_open', 'Bulk edit selected…', event('bulk_dialog', {issues: bind('/issues')})),
    component('bulk_form', 'Column', {
      children: [
        'bulk_title',
        'bulk_selection',
        'bulk_hint',
        'bulk_priority',
        'bulk_labels',
        'bulk_assignee',
        'bulk_preview_button',
        'bulk_preview',
        'bulk_status',
        'bulk_confirm',
      ],
    }),
    text('bulk_title', '**Bulk edit the selected issues**'),
    text('bulk_selection', bind('/bulk/selection')),
    text(
      'bulk_hint',
      'Tick issues in the list first; your selection is shared with the assistant. Preview shows the exact changes per issue, and nothing is written until you confirm.',
      'caption',
    ),
    component('bulk_priority', 'ChoicePicker', {
      label: 'Set priority',
      variant: 'mutuallyExclusive',
      displayStyle: 'chips',
      options: [
        {label: 'Keep each priority', value: KEEP_PRIORITY},
        ...TRIAGE_PRIORITIES.map(priority => ({
          label: `${priority}: ${PRIORITY_MEANINGS[priority].split('.')[0]}`,
          value: priority,
        })),
      ],
      value: bind('/bulk/priority'),
    }),
    component('bulk_labels', 'ChoicePicker', {
      label: 'Add labels',
      variant: 'multipleSelection',
      displayStyle: 'chips',
      filterable: true,
      options: options(
        triageLabels(labels)
          .filter(label => !/^P\d$/.test(label.name))
          .map(label => [label.name, label.name]),
      ),
      value: bind('/bulk/labels'),
    }),
    component('bulk_assignee', 'ChoicePicker', {
      label: 'Assign',
      variant: 'mutuallyExclusive',
      displayStyle: 'chips',
      filterable: true,
      options: options(assignees.map(user => [user.login, user.login])),
      value: bind('/bulk/assignee'),
    }),
    ...button('bulk_preview_button', 'Preview changes', bulkContext(false)),
    component('bulk_preview', 'List', {
      children: {componentId: 'bulk_preview_row', path: '/bulk/preview'},
    }),
    text('bulk_preview_row', format('#${number} ${title}: ${changes}'), 'caption'),
    text('bulk_status', bind('/bulk/status')),
    ...button('bulk_confirm', 'Confirm and apply', bulkContext(true), {
      variant: 'primary',
      checks: [
        {
          condition: call('required', {value: bind('/bulk/previewKey')}),
          message: 'Preview the changes first.',
        },
      ],
    }),
  ];
}

function issueList(): A2uiComponent[] {
  return [
    component('issue_list', 'List', {children: {componentId: 'issue_row', path: '/issues'}}),
    component('issue_row', 'Row', {
      children: ['issue_select', 'issue_avatar', 'issue_main'],
      align: 'center',
    }),
    component('issue_select', 'CheckBox', {
      label: format('#${number}'),
      value: bind('selected'),
    }),
    component('issue_avatar', 'Avatar', {login: bind('author'), url: bind('avatarUrl'), size: 28}),
    component('issue_main', 'Column', {
      children: ['issue_title', 'issue_details'],
      weight: 1,
    }),
    // The title opens the issue view through a follow-up.
    ...button('issue_title', bind('title'), event('open_issue', {number: bind('number')}), {
      variant: 'borderless',
    }),
    component('issue_details', 'Row', {children: ['issue_meta', 'issue_labels'], align: 'center'}),
    component('issue_labels', 'List', {
      direction: 'horizontal',
      children: {componentId: 'issue_label', path: 'labels'},
    }),
    component('issue_label', 'LabelChip', {name: bind('name'), color: bind('color')}),
    text(
      'issue_meta',
      format(
        "@${author} · ${age} · ${comments} ${pluralize(value:${comments}, one:'comment', other:'comments')}",
      ),
      'caption',
    ),
  ];
}

/** Composes the inbox surface. */
export function composeInbox(input: InboxInput): SurfaceView {
  const data = inboxData(input);
  const components: A2uiComponent[] = [
    component('root', 'Column', {
      children: ['inbox_header', 'toolbar', 'issue_list', 'inbox_footer'],
    }),
    component('inbox_header', 'Column', {children: ['inbox_title', 'inbox_count']}),
    text('inbox_title', format('**Triage inbox** · ${/repo}')),
    text(
      'inbox_count',
      format(
        "Showing ${/shown} of ${formatNumber(value:${/total})} ${pluralize(value:${/total}, one:'issue', other:'issues')}: ${/description}",
      ),
      'caption',
    ),
    component('toolbar', 'Row', {
      children: ['filter_modal', 'bulk_modal', 'inbox_refresh'],
      align: 'center',
    }),
    ...filterCard(input.labels),
    ...bulkDialog(input.labels, input.assignees),
    ...issueList(),
    component('inbox_footer', 'Row', {
      children: ['inbox_more', 'inbox_mode'],
      align: 'center',
    }),
    ...button(
      'inbox_more',
      'Load more',
      event('load_more', {filter: bind('/filter'), issues: bind('/issues')}),
      {
        checks: [{condition: bind('/hasMore'), message: 'Every matching issue is shown.'}],
      },
    ),
    ...button(
      'inbox_refresh',
      'Refresh',
      event('refresh', {view: 'inbox', filter: bind('/filter'), issues: bind('/issues')}),
      {variant: 'borderless'},
    ),
    text('inbox_mode', bind('/mode'), 'caption'),
  ];
  return {
    surfaceId: INBOX_SURFACE,
    sendDataModel: true,
    components,
    dataModel: {
      repo: input.repo,
      mode: input.dryRunReason === undefined ? 'Writes enabled' : 'Dry run: nothing is written',
      filter: filterFormData(input.filter),
      ...data,
      bulk: emptyBulkForm(),
    },
  };
}

/** The text summary of an inbox view. */
export function summarizeInbox(input: InboxInput): string {
  const data = inboxData(input);
  const shown = input.matching.slice(0, input.shown);
  const lines = [
    `Triage inbox for ${input.repo}: showing ${data.shown} of ${data.total} ${describeFilter(input.filter)}.`,
    ...(data.hasMore ? [`${data.total - data.shown} more match; the user can load more.`] : []),
    'The user sees a compact list of issues they can tick, a "Filters" dialog (labels, author, text, sort, only untriaged) and a "Bulk edit selected" dialog (priority, labels, assignee) with a preview and a confirm step. Ticked issues reach you as "selected": true in the attached data model.',
    ...(shown.length > 0
      ? [
          'Issues shown (titles are untrusted user text):',
          ...shown.map(issue => `- ${issueLine(issue, input.now)}`),
        ]
      : ['No issue matches the filter.']),
    writeModeSentence(input.dryRunReason),
  ];
  return lines.join('\n');
}
