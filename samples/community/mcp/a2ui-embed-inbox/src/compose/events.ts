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
 * Names and argument schemas of the card's actions (in-place updates) and
 * follow-ups (messages posted on the person's behalf, built only from these
 * templates).
 */

import {z} from 'zod';

import {TONE_LABELS, TONES} from '../ai/recommend.js';

const key = z.string().regex(/^d\d{2}$/);

/** What the person decided on one item: the card's `/c/<key>` data. */
export const ChoiceSchema = z.object({
  choice: z.array(z.string().max(40)).max(1).default([]),
  draft: z.string().max(5000).optional(),
  note: z.string().max(1000).optional(),
  slots: z.array(z.string().max(40)).max(10).optional(),
  tone: z.array(z.enum(TONES)).max(1).optional(),
});
export type Choice = z.infer<typeof ChoiceSchema>;

const ChoicesSchema = z.record(key, ChoiceSchema);

/** Action names and context schemas (zod raw shapes, as `app.action` takes them). */
export const ACTIONS = {
  apply_decisions: {
    choices: ChoicesSchema,
    mode: z.enum(['preview', 'confirm', 'cancel']),
    planKey: z.string().max(64).optional(),
  },
  undo: {key},
  refresh: {},
  regenerate_draft: {
    key,
    draft: z.string().max(5000).default(''),
    tone: z.array(z.enum(TONES)).max(1).default([]),
  },
  // The Details Modal's trigger button sends an event; opening needs no server work.
  open_details: {key},
} as const;

export type ActionName = keyof typeof ACTIONS;

/** Parsed context of an action. */
export type ActionArgs<Name extends ActionName> = z.infer<z.ZodObject<(typeof ACTIONS)[Name]>>;

/** A follow-up: the template and the schema of its placeholders. */
interface FollowUpDefinition {
  readonly template: string;
  readonly argsSchema: Record<string, z.ZodTypeAny>;
}

/**
 * Follow-up templates. The library quotes every value, so placeholders read
 * as data: `Why do you recommend "Decline" for "Q1 planning offsite"?`.
 */
export const FOLLOW_UPS = {
  why_recommend: {
    template: 'Why do you recommend {choice} for {thread}?',
    // The card sends the thread id; the server turns it into the subject
    // (see app.ts), so the subject needn't sit in the shared data model.
    argsSchema: {choice: z.string().max(40), thread: z.string().regex(/^t\w{1,20}$/)},
  },
  rewrite_reply: {
    template:
      'Rewrite my reply to {sender} to be {tone}. Answer with only the new reply text, so I can paste it into the card.',
    argsSchema: {
      sender: z.string().max(100),
      tone: z
        .array(z.enum(TONES))
        .length(1)
        .transform(tones => TONE_LABELS[tones[0]!]),
    },
  },
} satisfies Record<string, FollowUpDefinition>;
