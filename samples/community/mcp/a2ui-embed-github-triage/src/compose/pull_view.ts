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
 * The pull request view: a content surface (summary, CI checks and changed
 * files in tabs) and a review surface (checklist, review form with checks
 * that keep Submit disabled until the review is valid, and a confirm step).
 */

import {checkState, combinedState, type CheckState} from '../catalog/check_status.js';
import type {GhCheckRun, GhPullFile, GhPullRequest, ReviewEvent} from '../github/types.js';
import type {ItemPlan} from '../github/writes.js';
import {describeChange} from '../github/writes.js';
import {sanitizeMarkdown} from '../triage/sanitize.js';
import {
  type A2uiComponent,
  type A2uiMessage,
  bind,
  button,
  call,
  component,
  event,
  format,
  type SurfaceView,
  text,
  updateComponents,
  updateData,
} from './a2ui.js';
import {ago, labelData, safeTitle, writeModeSentence} from './format.js';

/** Most files listed. */
export const SHOWN_FILES = 12;

/** Most checks listed, failures and pending first. */
export const SHOWN_CHECKS = 10;

/** The description is cut to keep the inline view short. */
export const PULL_BODY_LENGTH = 1000;

export function pullSurfaceId(number: number): string {
  return `pr-${number}`;
}

export function reviewSurfaceId(number: number): string {
  return `pr-${number}-review`;
}

/** The review checklist, from the PR triage rules in docs/contributing/triage/triage.md. */
export const REVIEW_CHECKLIST = [
  {id: 'scoped', label: 'Minor change, or addresses an issue assigned to the author'},
  {id: 'noOverlap', label: 'Does not overlap with work in progress'},
  {id: 'maintainable', label: 'A change the team can maintain long term'},
  {id: 'tested', label: 'Has tests for the change'},
] as const;

export const REVIEW_EVENT_LABELS: Record<ReviewEvent, string> = {
  APPROVE: 'Approve',
  COMMENT: 'Comment',
  REQUEST_CHANGES: 'Request changes',
};

/** The review form as the data model holds it. */
export interface ReviewForm {
  readonly event: string[];
  readonly body: string;
  readonly checklist: Record<(typeof REVIEW_CHECKLIST)[number]['id'], boolean>;
}

export function emptyReviewForm(): ReviewForm {
  return {
    event: [],
    body: '',
    checklist: {scoped: false, noOverlap: false, maintainable: false, tested: false},
  };
}

export interface PullInput {
  readonly repo: string;
  readonly pull: GhPullRequest;
  readonly files: readonly GhPullFile[];
  readonly checks: readonly GhCheckRun[];
  readonly dryRunReason: string | undefined;
  readonly now: Date;
}

/** Checks reduced to badge rows, failures first. */
export function checkRows(checks: readonly GhCheckRun[]) {
  const order: Record<CheckState, number> = {
    failure: 0,
    pending: 1,
    success: 2,
    neutral: 3,
    skipped: 4,
  };
  return checks
    .map(check => ({name: check.name, state: checkState(check.status, check.conclusion)}))
    .sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
}

/** A one-line CI summary such as `2 failed, 20 passed, 8 skipped of 30 checks`. */
export function checksSummary(checks: readonly GhCheckRun[]): {state: CheckState; label: string} {
  const rows = checkRows(checks);
  if (rows.length === 0) return {state: 'neutral', label: 'No CI checks'};
  const counts = new Map<CheckState, number>();
  for (const row of rows) counts.set(row.state, (counts.get(row.state) ?? 0) + 1);
  const words: Record<CheckState, string> = {
    failure: 'failed',
    pending: 'pending',
    success: 'passed',
    neutral: 'neutral',
    skipped: 'skipped',
  };
  const parts = (['failure', 'pending', 'success', 'neutral', 'skipped'] as const)
    .filter(state => counts.has(state))
    .map(state => `${counts.get(state)} ${words[state]}`);
  return {
    state: combinedState(rows.map(row => row.state)),
    label: `${parts.join(', ')} of ${rows.length} checks`,
  };
}

export function composePullContent(input: PullInput): SurfaceView {
  const {pull, now} = input;
  const ci = checksSummary(input.checks);
  const components: A2uiComponent[] = [
    component('root', 'Column', {children: ['header', 'stats', 'labels', 'tabs']}),
    component('header', 'Row', {children: ['author', 'heading'], align: 'center'}),
    component('author', 'Avatar', {login: bind('/author'), url: bind('/avatarUrl'), size: 36}),
    component('heading', 'Column', {children: ['title', 'meta'], weight: 1}),
    text('title', bind('/title')),
    text(
      'meta',
      format(
        '#${/number} · ${/draft}${/headRef} → ${/baseRef} · by @${/author} · updated ${/updated}',
      ),
      'caption',
    ),
    component('stats', 'Row', {children: ['ci', 'diff', 'files_count'], align: 'center'}),
    component('ci', 'CheckStatus', {state: bind('/ci/state'), label: bind('/ci/label')}),
    component('diff', 'DiffStat', {additions: bind('/additions'), deletions: bind('/deletions')}),
    text(
      'files_count',
      format(
        "${/changedFiles} ${pluralize(value:${/changedFiles}, one:'file', other:'files')} changed",
      ),
      'caption',
    ),
    component('labels', 'List', {
      direction: 'horizontal',
      children: {componentId: 'label', path: '/labels'},
    }),
    component('label', 'LabelChip', {name: bind('name'), color: bind('color')}),
    component('tabs', 'Tabs', {
      tabs: [
        {title: 'Summary', child: 'body'},
        {title: format('Checks (${/checkCount})'), child: 'checks'},
        {title: format('Files (${/changedFiles})'), child: 'files'},
      ],
    }),
    text('body', bind('/body')),
    component('checks', 'Column', {children: ['check_list', 'checks_more']}),
    component('check_list', 'List', {children: {componentId: 'check', path: '/checks'}}),
    text('checks_more', bind('/checksMore'), 'caption'),
    component('check', 'CheckStatus', {state: bind('state'), label: bind('name')}),
    component('files', 'Column', {children: ['file_list', 'files_more']}),
    component('file_list', 'List', {children: {componentId: 'file', path: '/files'}}),
    component('file', 'Row', {children: ['file_name', 'file_diff'], justify: 'spaceBetween'}),
    text('file_name', format('`${filename}` ${status}'), 'caption'),
    component('file_diff', 'DiffStat', {
      additions: bind('additions'),
      deletions: bind('deletions'),
    }),
    text('files_more', bind('/filesMore'), 'caption'),
  ];
  const files = input.files.slice(0, SHOWN_FILES).map(file => ({
    filename: file.filename,
    status: file.status === 'modified' ? '' : `(${file.status})`,
    additions: file.additions,
    deletions: file.deletions,
  }));
  return {
    surfaceId: pullSurfaceId(pull.number),
    sendDataModel: false,
    components,
    dataModel: {
      number: pull.number,
      title: safeTitle(pull, 200),
      author: pull.author.login,
      avatarUrl: pull.author.avatarUrl,
      draft: pull.draft ? 'draft · ' : '',
      headRef: pull.headRef,
      baseRef: pull.baseRef,
      updated: ago(pull.updatedAt, now),
      additions: pull.additions,
      deletions: pull.deletions,
      changedFiles: pull.changedFiles,
      labels: labelData(pull.labels),
      ci,
      checkCount: input.checks.length,
      checks: checkRows(input.checks).slice(0, SHOWN_CHECKS),
      checksMore:
        input.checks.length > SHOWN_CHECKS
          ? `${input.checks.length - SHOWN_CHECKS} more checks not shown (all passed or skipped when none failed above).`
          : '',
      body: sanitizeMarkdown(pull.body, PULL_BODY_LENGTH) || '_No description provided._',
      files,
      filesMore:
        input.files.length > files.length
          ? `${input.files.length - files.length} more files not shown.`
          : '',
    },
  };
}

/** The Submit bar of the review form. */
export function submitBar(number: number): A2uiComponent[] {
  const eventIs = (value: ReviewEvent) =>
    call('regex', {value: format('${/review/event}'), pattern: `"${value}"`});
  return [
    component('submit_bar', 'Row', {children: ['submit'], justify: 'end'}),
    ...button(
      'submit',
      'Submit review…',
      event('submit_review', {number, review: bind('/review'), mode: 'preview'}),
      {
        variant: 'primary',
        checks: [
          {
            condition: call('required', {value: bind('/review/event')}),
            message: 'Choose a review decision.',
          },
          {
            condition: call('or', {
              values: [
                call('not', {value: eventIs('REQUEST_CHANGES')}),
                call('required', {value: bind('/review/body')}),
              ],
            }),
            message: 'Explain the changes you request.',
          },
          {
            condition: call('or', {
              values: [
                call('not', {value: eventIs('APPROVE')}),
                call('and', {
                  values: REVIEW_CHECKLIST.map(item => bind(`/review/checklist/${item.id}`)),
                }),
              ],
            }),
            message: 'Tick every checklist item before approving.',
          },
        ],
      },
    ),
  ];
}

/** The confirm panel that replaces the Submit bar. */
export function confirmReviewBar(
  number: number,
  dryRunReason: string | undefined,
): A2uiComponent[] {
  return [
    component('submit_bar', 'Column', {
      children: ['confirm_title', 'confirm_text', 'confirm_actions'],
    }),
    text(
      'confirm_title',
      dryRunReason === undefined
        ? '**Confirm this review.** It will be posted to GitHub.'
        : '**Dry run.** Confirming shows what would be posted; nothing changes on GitHub.',
    ),
    text('confirm_text', bind('/plan'), 'caption'),
    component('confirm_actions', 'Row', {children: ['confirm', 'cancel'], justify: 'end'}),
    ...button(
      'confirm',
      dryRunReason === undefined ? 'Confirm and post' : 'Confirm (dry run)',
      event('submit_review', {
        number,
        review: bind('/review'),
        mode: 'confirm',
        planKey: bind('/planKey'),
      }),
      {variant: 'primary'},
    ),
    ...button(
      'cancel',
      'Back to the review',
      event('submit_review', {number, review: bind('/review'), mode: 'cancel'}),
      {variant: 'borderless'},
    ),
  ];
}

export function composeReviewForm(input: PullInput): SurfaceView {
  const {pull} = input;
  const components: A2uiComponent[] = [
    component('root', 'Card', {child: 'tabs'}),
    component('tabs', 'Tabs', {
      tabs: [
        {title: format('Review #${/number}'), child: 'form'},
        {title: 'Checklist', child: 'checklist'},
      ],
    }),
    component('form', 'Column', {children: ['decision', 'body', 'submit_bar', 'status']}),
    component('checklist', 'Column', {children: REVIEW_CHECKLIST.map(item => `check_${item.id}`)}),
    ...REVIEW_CHECKLIST.map(item =>
      component(`check_${item.id}`, 'CheckBox', {
        label: item.label,
        value: bind(`/review/checklist/${item.id}`),
      }),
    ),
    component('decision', 'ChoicePicker', {
      label: 'Decision',
      variant: 'mutuallyExclusive',
      displayStyle: 'chips',
      options: Object.entries(REVIEW_EVENT_LABELS).map(([value, label]) => ({label, value})),
      value: bind('/review/event'),
    }),
    component('body', 'TextField', {
      label: 'Review comment',
      variant: 'longText',
      value: bind('/review/body'),
      '@checks': [
        {
          condition: call('or', {
            values: [
              call('not', {
                value: call('regex', {
                  value: format('${/review/event}'),
                  pattern: '"REQUEST_CHANGES"',
                }),
              }),
              call('required', {value: bind('/review/body')}),
            ],
          }),
          message: 'Required when requesting changes.',
        },
        {
          condition: call('length', {value: bind('/review/body'), max: 5000}),
          message: 'Use at most 5000 characters.',
        },
      ],
    }),
    ...submitBar(pull.number),
    text('status', bind('/status'), 'caption'),
  ];
  return {
    surfaceId: reviewSurfaceId(pull.number),
    sendDataModel: true,
    components,
    dataModel: {
      number: pull.number,
      title: safeTitle(pull, 120),
      review: emptyReviewForm(),
      plan: '',
      planKey: '',
      status: input.dryRunReason === undefined ? '' : 'Dry run: nothing is posted to GitHub.',
    },
  };
}

export function reviewPreviewMessages(
  plan: ItemPlan,
  planKey: string,
  dryRunReason: string | undefined,
): A2uiMessage[] {
  const surfaceId = reviewSurfaceId(plan.number);
  return [
    updateData(surfaceId, '/plan', plan.changes.map(describeChange).join('\n')),
    updateData(surfaceId, '/planKey', planKey),
    updateData(surfaceId, '/status', ''),
    updateComponents(surfaceId, confirmReviewBar(plan.number, dryRunReason)),
  ];
}

export function reviewBackMessages(number: number, status: string): A2uiMessage[] {
  const surfaceId = reviewSurfaceId(number);
  return [
    updateComponents(surfaceId, submitBar(number)),
    updateData(surfaceId, '/planKey', ''),
    updateData(surfaceId, '/status', status),
  ];
}

export function summarizePull(input: PullInput): string {
  const {pull} = input;
  const ci = checksSummary(input.checks);
  const failing = checkRows(input.checks).filter(row => row.state === 'failure');
  const top = [...input.files]
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
    .slice(0, 5);
  return [
    `PR #${pull.number} ${JSON.stringify(safeTitle(pull))} in ${input.repo} by @${pull.author.login}${pull.draft ? ' (draft)' : ''}: ${pull.headRef} → ${pull.baseRef}, +${pull.additions} −${pull.deletions} in ${pull.changedFiles} files, updated ${ago(pull.updatedAt, input.now)}.`,
    `CI: ${ci.label}.${failing.length > 0 ? ` Failing: ${failing.map(row => row.name).join(', ')}.` : ''}`,
    `Largest changes: ${top.map(file => `${file.filename} (+${file.additions} −${file.deletions})`).join(', ') || 'none'}.`,
    `Labels: ${pull.labels.map(label => label.name).join(', ') || 'none'}. Requested reviewers: ${pull.requestedReviewers.map(user => `@${user.login}`).join(', ') || 'none'}.`,
    `The view shows, in tabs, the description (untrusted user text, first ${PULL_BODY_LENGTH} characters), up to ${SHOWN_CHECKS} checks (failures first) and up to ${SHOWN_FILES} changed files, plus a review card with tabs for the decision (Approve / Comment / Request changes and a comment, required when requesting changes) and a 4-item checklist that approving requires. Submit opens a confirm step.`,
    writeModeSentence(input.dryRunReason),
  ].join('\n');
}
