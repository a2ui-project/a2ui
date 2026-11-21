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

/** Filtering, sorting and paging of the triage inbox. */

import type {GhIssue} from '../github/types.js';
import {isUntriaged, labelNames} from './rules.js';

export const INBOX_SORTS = ['newest', 'oldest', 'updated', 'comments'] as const;

export type InboxSort = (typeof INBOX_SORTS)[number];

export const INBOX_SORT_LABELS: Record<InboxSort, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  updated: 'Recently updated',
  comments: 'Most commented',
};

/** Issues per inbox page; keeps the shared data model well under 16 KiB. */
export const INBOX_PAGE_SIZE = 6;

/** An inbox filter, as the model or the filter form sets it. */
export interface InboxFilter {
  /** Issues must have every one of these labels. */
  readonly labels: readonly string[];
  /** Author login, case-insensitive. Empty for any. */
  readonly author: string;
  /** Case-insensitive text in the title or body. */
  readonly text: string;
  readonly sort: InboxSort;
  /** Only issues without a priority label. */
  readonly onlyUntriaged: boolean;
}

export const DEFAULT_INBOX_FILTER: InboxFilter = {
  labels: [],
  author: '',
  text: '',
  sort: 'newest',
  onlyUntriaged: true,
};

/** Fills the missing fields of a partial filter with the defaults. */
export function normalizeFilter(filter: Partial<InboxFilter> = {}): InboxFilter {
  return {
    labels: [...new Set((filter.labels ?? []).map(label => label.trim()).filter(Boolean))],
    author: (filter.author ?? '').trim().replace(/^@/, ''),
    text: (filter.text ?? '').trim(),
    sort: filter.sort ?? DEFAULT_INBOX_FILTER.sort,
    onlyUntriaged: filter.onlyUntriaged ?? DEFAULT_INBOX_FILTER.onlyUntriaged,
  };
}

function compare(sort: InboxSort): (a: GhIssue, b: GhIssue) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => a.createdAt.localeCompare(b.createdAt) || a.number - b.number;
    case 'updated':
      return (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.number - a.number;
    case 'comments':
      return (a, b) => b.comments - a.comments || b.number - a.number;
    case 'newest':
      return (a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number;
  }
}

/** The issues matching `filter`, sorted. */
export function filterIssues(issues: readonly GhIssue[], filter: InboxFilter): GhIssue[] {
  const author = filter.author.toLowerCase();
  const text = filter.text.toLowerCase();
  return issues
    .filter(issue => !filter.onlyUntriaged || isUntriaged(issue))
    .filter(issue => !author || issue.author.login.toLowerCase() === author)
    .filter(issue => {
      const names = labelNames(issue);
      return filter.labels.every(label => names.includes(label));
    })
    .filter(
      issue =>
        !text ||
        issue.title.toLowerCase().includes(text) ||
        issue.body.toLowerCase().includes(text),
    )
    .sort(compare(filter.sort));
}

/** Describes a filter in words, for summaries. */
export function describeFilter(filter: InboxFilter): string {
  const parts = [filter.onlyUntriaged ? 'untriaged open issues' : 'open issues'];
  if (filter.labels.length > 0) parts.push(`labeled ${filter.labels.join(' + ')}`);
  if (filter.author) parts.push(`by @${filter.author}`);
  if (filter.text) parts.push(`matching ${JSON.stringify(filter.text)}`);
  parts.push(`sorted by ${INBOX_SORT_LABELS[filter.sort].toLowerCase()}`);
  return parts.join(', ');
}
