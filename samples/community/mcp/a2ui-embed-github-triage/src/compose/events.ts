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
 * Names and argument schemas of the app's actions (in-place updates) and
 * follow-ups (messages posted on the user's behalf, built only from these
 * templates).
 */

import {z} from 'zod';

import {REVIEW_EVENTS} from '../github/types.js';
import {INBOX_SORTS} from '../triage/inbox_filter.js';
import {findTemplate, REPLY_TEMPLATE_IDS} from '../triage/rules.js';

const issueNumber = z.number().int().positive();

/** The filter form's data model. */
export const FilterFormSchema = z.object({
  labels: z.array(z.string().max(100)).max(30).default([]),
  author: z.string().max(40).default(''),
  text: z.string().max(200).default(''),
  sort: z.array(z.enum(INBOX_SORTS)).max(1).default([]),
  onlyUntriaged: z.boolean().default(true),
});

/** An inbox row as actions receive it: only the number and selection matter. */
export const InboxRowSchema = z
  .object({number: issueNumber, selected: z.boolean().optional()})
  .passthrough();

const InboxRowsSchema = z.array(InboxRowSchema).max(500);

export const BulkFormSchema = z
  .object({
    priority: z.array(z.string().max(10)).max(1).default([]),
    labels: z.array(z.string().max(100)).max(20).default([]),
    assignee: z.array(z.string().max(40)).max(1).default([]),
    previewKey: z.string().max(64).default(''),
  })
  .passthrough();

export const TriageFormSchema = z.object({
  priority: z.array(z.string().max(10)).max(1).default([]),
  type: z.array(z.string().max(100)).max(1).default([]),
  components: z.array(z.string().max(100)).max(20).default([]),
  assignee: z.array(z.string().max(40)).max(1).default([]),
  milestone: z.array(z.string().max(20)).max(1).default([]),
  markHandled: z.boolean().default(false),
  reply: z.string().max(5000).default(''),
});

export const ReviewFormSchema = z.object({
  event: z.array(z.enum(REVIEW_EVENTS)).max(1).default([]),
  body: z.string().max(5000).default(''),
  checklist: z.record(z.boolean()).default({}),
});

export const DashboardFiltersSchema = z.object({
  staleDays: z.number().optional(),
  since: z.string().max(40).optional(),
});

const mode = z.enum(['preview', 'confirm', 'cancel']);

/** Action names and context schemas (zod raw shapes, as `app.action` takes them). */
export const ACTIONS = {
  filter_inbox: {filter: FilterFormSchema},
  load_more: {filter: FilterFormSchema, issues: InboxRowsSchema},
  refresh: {
    view: z.enum(['inbox', 'dashboard']),
    filter: FilterFormSchema.optional(),
    issues: InboxRowsSchema.optional(),
    filters: DashboardFiltersSchema.optional(),
  },
  bulk_dialog: {issues: InboxRowsSchema},
  open_dialog: {dialog: z.enum(['filters'])},
  bulk_apply: {issues: InboxRowsSchema, bulk: BulkFormSchema, confirm: z.boolean()},
  apply_triage: {
    number: issueNumber,
    form: TriageFormSchema,
    mode,
    planKey: z.string().max(64).optional(),
    target: z.enum(['issue', 'suggestion']).default('issue'),
    index: z.number().int().min(0).max(50).optional(),
  },
  preview_reply: {number: issueNumber, template: z.array(z.enum(REPLY_TEMPLATE_IDS)).max(1)},
  suggest: {number: issueNumber},
  submit_review: {
    number: issueNumber,
    review: ReviewFormSchema,
    mode,
    planKey: z.string().max(64).optional(),
  },
} as const;

/** A follow-up: the template and the schema of its placeholders. */
interface FollowUpDefinition {
  readonly template: string;
  readonly argsSchema: Record<string, z.ZodTypeAny>;
}

/**
 * Follow-up templates. Every value is quoted by the library, so placeholders
 * read as data (`issue "4321"`). Templates take numbers, template ids and
 * label names only, never issue text.
 */
export const FOLLOW_UPS = {
  find_similar: {
    template: 'Find open issues similar to issue {number} and tell me whether it is a duplicate.',
    argsSchema: {number: issueNumber},
  },
  draft_reply: {
    template: 'Draft a reply to issue {number} using the {template} template.',
    argsSchema: {
      number: issueNumber,
      template: z
        .array(z.enum(REPLY_TEMPLATE_IDS))
        .length(1)
        .transform(ids => findTemplate(ids[0]!)?.title ?? ids[0]!),
    },
  },
  summarize: {
    template: 'Summarize the discussion on issue {number}.',
    argsSchema: {number: issueNumber},
  },
  open_issue: {
    template: 'Open issue {number} in the triage view.',
    argsSchema: {number: issueNumber},
  },
  open_pull: {
    template: 'Show pull request {number} for review.',
    argsSchema: {number: issueNumber},
  },
  inbox_label: {
    template: 'Show the triage inbox of open issues with the label {label}.',
    argsSchema: {
      label: z
        .string()
        .max(100)
        .transform(label => label || 'no priority label (untriaged)'),
    },
  },
} satisfies Record<string, FollowUpDefinition>;

export type ActionName = keyof typeof ACTIONS;

/** Parsed context of an action. */
export type ActionArgs<Name extends ActionName> = z.infer<z.ZodObject<(typeof ACTIONS)[Name]>>;
