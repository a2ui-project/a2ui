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

/** The model-facing tool: its name carries the intent, since hosts may show only names. */

import {z} from 'zod';

import {GROUP_IDS} from './decisions/types.js';

/** `inbox_decisions(focus?)`. */
export const INBOX_DECISIONS_TOOL = {
  name: 'inbox_decisions',
  config: {
    title: 'Inbox decisions',
    description:
      'Email inbox assistant: shows one card with every email that needs the user (replies, calendar invites, scheduling requests, bills, shared expenses, newsletters to clean up, phishing, documents to sign), each with a pre-selected recommendation, its reason and what happens. The user approves or changes the picks, edits reply drafts and confirms once in the card. Nothing is sent until they confirm, and the mailbox is a demo.',
    inputSchema: {
      focus: z
        .enum(GROUP_IDS)
        .optional()
        .describe(
          'Optional (default: everything). Only one group: reply (replies and scheduling), calendar (invites), money (bills and payment requests), cleanup (newsletters and promotions) or review (phishing and documents).',
        ),
    },
    annotations: {readOnlyHint: true, openWorldHint: false},
  },
};
