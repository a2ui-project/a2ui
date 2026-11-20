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

/** Shared formatting of issues, users and dates for views and summaries. */

import type {GhIssue, GhLabel} from '../github/types.js';
import {daysSince} from '../triage/rules.js';
import {plainLine} from '../triage/sanitize.js';

/** A label as the views store it. */
export interface LabelData {
  readonly name: string;
  readonly color: string;
}

export function labelData(labels: readonly GhLabel[]): LabelData[] {
  return labels.map(label => ({name: label.name, color: label.color}));
}

/** A short age such as `today`, `3d`, `5w` or `14mo`. */
export function age(iso: string, now: Date): string {
  const days = daysSince(iso, now);
  if (days === 0) return 'today';
  if (days < 14) return `${days}d`;
  if (days < 90) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

/** `today`, or a short age followed by `ago`, such as `3d ago`. */
export function ago(iso: string, now: Date): string {
  const short = age(iso, now);
  return short === 'today' ? short : `${short} ago`;
}

/** An issue title as one line of plain text, safe to quote. */
export function safeTitle(issue: Pick<GhIssue, 'title'>, maxLength = 120): string {
  return plainLine(issue.title, maxLength);
}

/** One line describing an issue for summaries; the title is JSON-quoted as untrusted text. */
export function issueLine(issue: GhIssue, now: Date): string {
  const labels = issue.labels.map(label => label.name);
  const assignees = issue.assignees.map(user => `@${user.login}`);
  return [
    `#${issue.number} ${JSON.stringify(safeTitle(issue))}`,
    `by @${issue.author.login}`,
    `opened ${ago(issue.createdAt, now)}`,
    `${issue.comments} comment${issue.comments === 1 ? '' : 's'}`,
    labels.length > 0 ? `labels: ${labels.join(', ')}` : 'no labels',
    ...(assignees.length > 0 ? [`assigned: ${assignees.join(', ')}`] : []),
  ].join(' · ');
}

/** The sentence every summary ends with about writes. */
export function writeModeSentence(dryRunReason: string | undefined): string {
  return dryRunReason === undefined
    ? 'Writes are ENABLED for this repository: confirmed actions change GitHub.'
    : `Writes are dry runs (${dryRunReason}): confirmed actions only show what would change.`;
}
