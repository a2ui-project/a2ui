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

/** Model-facing tool definitions. */

import {z} from 'zod';

import {MAX_SUGGESTION_ISSUES} from './ai/suggest.js';
import {INBOX_SORTS} from './triage/inbox_filter.js';

const READ_ONLY = {readOnlyHint: true, destructiveHint: false, openWorldHint: true} as const;

const issueNumber = z.number().int().positive();

/** `triage_inbox(filter?)`. */
export const TRIAGE_INBOX_TOOL = {
  name: 'triage_inbox',
  config: {
    title: 'Triage inbox',
    description:
      'Shows open issues to triage (by default only untriaged ones, without a priority label) with a filter form, a multi-select list and a bulk edit dialog. Returns a text summary of the issues shown. Use for "what needs triage", queues and bulk edits.',
    inputSchema: {
      labels: z
        .array(z.string().max(100))
        .max(10)
        .optional()
        .describe('Optional. Issues must have all of these labels.'),
      author: z.string().max(40).optional().describe('Optional author login.'),
      text: z.string().max(80).optional().describe('Optional text to find in titles and bodies.'),
      sort: z.enum(INBOX_SORTS).optional().describe("Optional (default: 'newest')."),
      onlyUntriaged: z
        .boolean()
        .optional()
        .describe('Optional (default: true). Only issues without a priority label.'),
    },
    annotations: READ_ONLY,
  },
};

/** `issue(number)`. */
export const ISSUE_TOOL = {
  name: 'issue',
  config: {
    title: 'Issue triage view',
    description:
      "Shows one issue: description, recent comments, and a triage form (priority, type, components, assignee, milestone, canonical reply) the user reviews and applies. Applying needs the user's confirmation and is a dry run unless writes are enabled.",
    inputSchema: {number: issueNumber.describe('The issue number.')},
    annotations: READ_ONLY,
  },
};

/** `pull_request(number)`. */
export const PULL_REQUEST_TOOL = {
  name: 'pull_request',
  config: {
    title: 'Pull request review',
    description:
      "Shows a pull request: summary, CI checks, changed files with line counts, and a review form (checklist, Approve / Comment / Request changes, comment). Submitting needs the user's confirmation and is a dry run unless writes are enabled.",
    inputSchema: {number: issueNumber.describe('The pull request number.')},
    annotations: READ_ONLY,
  },
};

/** `triage_dashboard()`. */
export const DASHBOARD_TOOL = {
  name: 'triage_dashboard',
  config: {
    title: 'Triage dashboard',
    description:
      'Shows triage health: open and untriaged issue counts, counts by priority and component, a chart of open issues by week opened, stale PRs and the oldest untriaged issues, with filters and drill-down buttons.',
    inputSchema: {
      staleDays: z
        .number()
        .int()
        .min(7)
        .max(180)
        .optional()
        .describe('Optional (default: 30). PRs idle this many days are stale.'),
      since: z
        .string()
        .max(10)
        .optional()
        .describe('Optional start day of the chart, YYYY-MM-DD (default: 12 weeks ago).'),
    },
    annotations: READ_ONLY,
  },
};

/** `suggest_triage(numbers)`. */
export const SUGGEST_TRIAGE_TOOL = {
  name: 'suggest_triage',
  config: {
    title: 'AI triage suggestions',
    description: `Asks a server-side model (Gemini) to propose a priority, labels, an assignee and a canonical reply for up to ${MAX_SUGGESTION_ISSUES} issues, following the repo's triage rules, and shows them as editable pre-filled forms. Nothing is applied: the user previews and confirms each issue.`,
    inputSchema: {
      numbers: z.array(issueNumber).min(1).max(MAX_SUGGESTION_ISSUES).describe('Issue numbers.'),
    },
    annotations: READ_ONLY,
  },
};
