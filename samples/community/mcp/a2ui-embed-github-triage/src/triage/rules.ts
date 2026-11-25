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
 * The repo's triage rules (docs/contributing/triage/triage.md, labels.md and
 * templates.md in a2ui-project/a2ui), as data the tools and views share.
 */

import type {GhIssue, GhLabel} from '../github/types.js';

/** Priority labels, most urgent first. P4 is legacy; new triage uses P0 to P3. */
export const PRIORITY_LABELS = ['P0', 'P1', 'P2', 'P3', 'P4'] as const;

/** Priorities a triager can set. */
export const TRIAGE_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;

export type Priority = (typeof TRIAGE_PRIORITIES)[number];

/** One-line meaning of each priority, from triage.md. */
export const PRIORITY_MEANINGS: Record<Priority, string> = {
  P0: 'Urgent. Assign someone.',
  P1: 'A priority the team works on now or soon. Assign someone or set a milestone.',
  P2: 'The team intends to work on it.',
  P3: 'A good request, not currently planned.',
};

export const NEEDS_TRIAGE_LABEL = 'status: needs-triage';
export const FIRST_LINE_HANDLED_LABEL = 'status: first-line-handled';
export const WAITING_FOR_AUTHOR_LABEL = 'status: waiting-for-author-response';

/** Prefixes of single-valued label groups: setting one replaces the others. */
export const TYPE_PREFIX = 'type:';
export const COMPONENT_PREFIX = 'component:';

/** A canonical reply from templates.md. */
export interface ReplyTemplate {
  readonly id: string;
  readonly title: string;
  /** When to use it. */
  readonly when: string;
  /** What the triager does with it, as labels or a close. */
  readonly triage: string;
  readonly body: string;
}

/** The canonical replies, copied from docs/contributing/triage/templates.md. */
export const REPLY_TEMPLATES: readonly ReplyTemplate[] = [
  {
    id: 'request_info',
    title: 'Requesting information',
    when: 'A bug report has no reproduction steps or logs.',
    triage: `Add \`${WAITING_FOR_AUTHOR_LABEL}\`.`,
    body: [
      'To help us diagnose this, please provide:',
      '',
      '1. Browser console logs or exact protocol payload',
      '2. Minimal reproduction schema or code snippet',
      '',
      'Marked as `status: waiting-for-author-response` for now.',
    ].join('\n'),
  },
  {
    id: 'compliance_report',
    title: 'Weekly A2UI Compliance Report',
    when: 'An AI-generated compliance report issue.',
    triage: 'Close as not planned.',
    body: 'As agreed, we are closing this report: we need a better workflow to make it easier to follow up on the findings.',
  },
  {
    id: 'assigned_no_priority',
    title: 'Assigned issue without a priority',
    when: 'The issue has an assignee but no priority label.',
    triage: 'Set priority P2.',
    body: "I assigned a P2 priority to move this out of the triage queue. Please adjust the priority if needed to better reflect the issue's status.",
  },
  {
    id: 'stale_p1',
    title: 'Stale assigned P1 issue',
    when: 'A P1 issue with an assignee has been stale for a while.',
    triage: 'Add a comment.',
    body: 'Ping from triage process: is this issue still on your radar?',
  },
  {
    id: 'out_of_scope',
    title: 'Out of scope / roadmap conflict',
    when: 'A feature outside the current scope of the A2UI protocol roadmap.',
    triage: 'Close as not planned.',
    body: [
      'Thanks for the suggestion. This falls outside the current scope of the A2UI protocol roadmap.',
      '',
      'We do not plan to invest in it, so we are closing this issue. Comment here if you have new arguments to share.',
    ].join('\n'),
  },
];

/** Template ids, for argument schemas. */
export const REPLY_TEMPLATE_IDS = REPLY_TEMPLATES.map(template => template.id) as [
  string,
  ...string[],
];

export function findTemplate(id: string): ReplyTemplate | undefined {
  return REPLY_TEMPLATES.find(template => template.id === id);
}

export function labelNames(issue: Pick<GhIssue, 'labels'>): string[] {
  return issue.labels.map(label => label.name);
}

/** The priority label of an issue, if any. */
export function priorityOf(issue: Pick<GhIssue, 'labels'>): string | undefined {
  return PRIORITY_LABELS.find(priority => issue.labels.some(label => label.name === priority));
}

/** Untriaged: open with no priority label (the second-line triage queue). */
export function isUntriaged(issue: Pick<GhIssue, 'labels'>): boolean {
  return priorityOf(issue) === undefined;
}

/** Labels of a group (`type:` or `component:`), in the repo's label list. */
export function labelsWithPrefix(labels: readonly GhLabel[], prefix: string): GhLabel[] {
  return labels.filter(label => label.name.toLowerCase().startsWith(prefix));
}

/** Label prefixes that matter for triage filters and bulk edits. */
const TRIAGE_LABEL_PREFIXES = [TYPE_PREFIX, COMPONENT_PREFIX, 'status:', 'size:'];

/** The priority, `type:`, `component:`, `status:` and `size:` labels, for compact pickers. */
export function triageLabels(labels: readonly GhLabel[]): GhLabel[] {
  return labels.filter(
    label =>
      (TRIAGE_PRIORITIES as readonly string[]).includes(label.name) ||
      TRIAGE_LABEL_PREFIXES.some(prefix => label.name.toLowerCase().startsWith(prefix)),
  );
}

/** Whole days between two ISO timestamps (or from `iso` to now). */
export function daysSince(iso: string, now: Date): number {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? 0 : Math.max(0, Math.floor((now.getTime() - time) / 86_400_000));
}

/** Problems with a priority and owner choice, from the triage invariants. */
export function priorityProblems(
  priority: string | undefined,
  assignees: readonly string[],
  milestone: number | null | undefined,
): string[] {
  if (priority === 'P0' && assignees.length === 0) return ['A P0 issue needs an assignee.'];
  if (priority === 'P1' && assignees.length === 0 && !milestone) {
    return ['A P1 issue needs an assignee or a milestone.'];
  }
  return [];
}
