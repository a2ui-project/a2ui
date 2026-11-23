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

/** Decisions the card asks the person to make, and the agent's recommendation for each. */

import type {Person, Relationship} from '../mail/types.js';

export const DECISION_TYPES = [
  'reply',
  'scheduling',
  'invite',
  'bill',
  'shared_expense',
  'cleanup',
  'security',
  'document',
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

/** Tabs of the card, in order, and the decision types each holds. */
export const GROUPS = [
  {id: 'reply', title: 'Reply', types: ['reply', 'scheduling']},
  {id: 'calendar', title: 'Calendar', types: ['invite']},
  {id: 'money', title: 'Money', types: ['bill', 'shared_expense']},
  {id: 'cleanup', title: 'Clean up', types: ['cleanup']},
  {id: 'review', title: 'Review', types: ['security', 'document']},
] as const satisfies ReadonlyArray<{id: string; title: string; types: readonly DecisionType[]}>;
export type GroupId = (typeof GROUPS)[number]['id'];
export const GROUP_IDS = GROUPS.map(group => group.id) as [GroupId, ...GroupId[]];

export function groupOf(type: DecisionType): GroupId {
  return GROUPS.find(group => (group.types as readonly DecisionType[]).includes(type))!.id;
}

/** One choice of a decision. */
export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
}

/**
 * A decision the rules found, with the evidence the card shows. Everything
 * here is deterministic: it comes from the mailbox, not from a model.
 */
export interface DecisionCandidate {
  /** Stable key, a valid component id prefix such as `d03`. */
  readonly key: string;
  readonly threadId: string;
  readonly type: DecisionType;
  readonly group: GroupId;
  readonly subject: string;
  readonly sender: Person;
  readonly relationship?: Relationship;
  readonly received: string;
  /** The choices, in display order. Server-defined; a model can only pick among them. */
  readonly options: readonly ChoiceOption[];
  /** Short evidence lines, such as `Overlaps Dentist, Fri Dec 4, 2:00 PM`. */
  readonly facts: readonly string[];
  /** The email, as sanitized markdown, cut to fit the Details dialog. */
  readonly excerpt: string;
  /** Free slots to offer (scheduling). */
  readonly slots?: readonly ChoiceOption[];
  /** Facts from other emails the reply may need, such as a flight's arrival time. */
  readonly related?: readonly string[];
  /** Red flags (security). */
  readonly redFlags?: readonly string[];
  /** Type-specific values the fallback and the apply step use. */
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

/** The agent's recommendation for one decision. */
export interface Recommendation {
  readonly recommended: string;
  /** One line: why this choice. */
  readonly reason: string;
  /** One line: what happens if the person applies the recommended choice. */
  readonly consequence: string;
  /** Reply draft (reply, scheduling). */
  readonly draft?: string;
  /** Recommended slot values (scheduling). */
  readonly pickedSlots?: readonly string[];
  /** Note to the organizer (invite). */
  readonly note?: string;
}

/** A decision with its recommendation, ready to render. */
export interface Decision extends DecisionCandidate, Recommendation {
  /** Where the recommendation came from. */
  readonly source: 'gemini' | 'rules';
}
