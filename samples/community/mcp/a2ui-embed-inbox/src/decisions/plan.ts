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
 * The confirm step: turns the person's choices into a plan (one action per
 * pending decision), the summary sentence ("Send 2 replies, decline 1 invite,
 * ...") and a key that ties the confirmation to exactly what was previewed.
 */

import {createHash} from 'node:crypto';

import type {Choice} from '../compose/events.js';
import {formatMoney, joinList, plural, truncate} from '../format.js';
import {firstName} from '../mail/mailbox.js';
import type {Decision} from './types.js';

/** One action of the plan. */
export interface PlanItem {
  readonly key: string;
  readonly choice: string;
  readonly label: string;
  readonly changedFromPick: boolean;
  readonly draft?: string;
  readonly note?: string;
  readonly slots?: readonly string[];
  /** Line of the confirm list. */
  readonly line: string;
}

export interface Plan {
  readonly items: readonly PlanItem[];
  readonly summary: string;
  readonly changed: number;
  readonly key: string;
}

/** The plan for `decisions` (pending ones) with the person's `choices`. */
export function buildPlan(
  decisions: readonly Decision[],
  choices: Readonly<Record<string, Choice>>,
): Plan {
  const items = decisions.map(decision => {
    const choice = choices[decision.key];
    const value = choice?.choice[0];
    const chosen =
      value && decision.options.some(option => option.value === value)
        ? value
        : decision.recommended;
    const label = decision.options.find(option => option.value === chosen)!.label;
    const draft =
      decision.type === 'reply' || decision.type === 'scheduling'
        ? (choice?.draft ?? decision.draft ?? '')
        : undefined;
    const validSlots = new Set(decision.slots?.map(slot => slot.value));
    const slots =
      decision.type === 'scheduling'
        ? (choice?.slots ?? decision.pickedSlots ?? []).filter(slot => validSlots.has(slot))
        : undefined;
    // The agent's suggested note is written for a decline; it only goes with
    // another answer when the person edited it.
    const typed = choice?.note ?? decision.note ?? '';
    const note =
      decision.type === 'invite'
        ? chosen === 'decline' || typed !== (decision.note ?? '')
          ? typed
          : ''
        : undefined;
    return {
      key: decision.key,
      choice: chosen,
      label,
      changedFromPick: chosen !== decision.recommended,
      ...(draft !== undefined ? {draft} : {}),
      ...(slots !== undefined ? {slots} : {}),
      ...(note !== undefined ? {note} : {}),
      line: `${label} · ${truncate(decision.subject, 60)}`,
    } satisfies PlanItem;
  });
  const key = createHash('sha256')
    .update(JSON.stringify(items.map(({line: _line, ...rest}) => rest)))
    .digest('hex')
    .slice(0, 16);
  return {
    items,
    summary: summarize(decisions, items),
    changed: items.filter(item => item.changedFromPick).length,
    key,
  };
}

/** `Send 2 replies, decline 1 invite and schedule $84.20 on Dec 1.` */
export function summarize(decisions: readonly Decision[], items: readonly PlanItem[]): string {
  const count = new Map<string, number>();
  const phrases: string[] = [];
  const tally = (bucket: string) => count.set(bucket, (count.get(bucket) ?? 0) + 1);
  for (const item of items)
    tally(`${decisions.find(d => d.key === item.key)!.type}:${item.choice}`);
  const n = (bucket: string) => count.get(bucket) ?? 0;
  const once = new Set<string>();
  for (const item of items) {
    const decision = decisions.find(d => d.key === item.key)!;
    const bucket = `${decision.type}:${item.choice}`;
    const who = firstName(decision.sender.name);
    const amount = formatMoney(Number(decision.details['amount'] ?? 0));
    let phrase: string | undefined;
    switch (bucket) {
      case 'reply:send':
        phrase = `send ${plural(n(bucket), 'reply', 'replies')}`;
        break;
      case 'reply:later':
      case 'scheduling:skip':
        phrase = `snooze ${plural(n('reply:later') + n('scheduling:skip'), 'email', 'emails')} to tomorrow`;
        break;
      case 'reply:skip':
        phrase = `archive ${n(bucket)} without replying`;
        break;
      case 'scheduling:offer':
        phrase = `offer ${plural(item.slots?.length ?? 0, 'time', 'times')} to ${who}`;
        break;
      case 'invite:accept':
        phrase = `accept ${plural(n(bucket), 'invite', 'invites')}`;
        break;
      case 'invite:tentative':
        phrase = `answer maybe to ${plural(n(bucket), 'invite', 'invites')}`;
        break;
      case 'invite:decline':
        phrase = `decline ${plural(n(bucket), 'invite', 'invites')}`;
        break;
      case 'bill:pay_now':
        phrase = `pay ${amount} now`;
        break;
      case 'bill:schedule':
        phrase = `schedule ${amount} on ${String(decision.details['due'])}`;
        break;
      case 'bill:dispute':
        phrase = `question the ${String(decision.details['payee'])} bill`;
        break;
      case 'shared_expense:pay':
        phrase = `send ${who} ${amount}`;
        break;
      case 'shared_expense:ask':
        phrase = `ask ${who} for details`;
        break;
      case 'shared_expense:decline':
        phrase = `decline ${who}'s request`;
        break;
      case 'cleanup:unsubscribe':
        phrase = `unsubscribe from ${n(bucket)}`;
        break;
      case 'cleanup:archive_all':
        phrase = `archive all from ${plural(n(bucket), 'sender', 'senders')}`;
        break;
      case 'cleanup:keep':
        phrase = `keep ${plural(n(bucket), 'newsletter', 'newsletters')}`;
        break;
      case 'security:report':
        phrase = `report ${plural(n(bucket), 'phishing email', 'phishing emails')}`;
        break;
      case 'security:not_phishing':
        phrase = `mark ${plural(n(bucket), 'email', 'emails')} safe`;
        break;
      case 'document:open':
        phrase = `open ${plural(n(bucket), 'document', 'documents')} to sign`;
        break;
      case 'document:remind':
        phrase = `remind you Monday about ${plural(n(bucket), 'document', 'documents')}`;
        break;
      case 'document:done':
        phrase = `archive ${plural(n(bucket), 'signed document', 'signed documents')}`;
        break;
    }
    // Per-item phrases (amounts, names) repeat; counted phrases appear once.
    const counted = !/^(offer|pay|schedule|question|send \w+ \$|ask|decline \w+'s)/.test(
      phrase ?? '',
    );
    const id = counted ? bucket.replace('scheduling:skip', 'reply:later') : `${bucket}:${item.key}`;
    if (phrase && !once.has(id)) {
      once.add(id);
      phrases.push(phrase);
    }
  }
  const sentence = joinList(phrases);
  return sentence
    ? `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
    : 'Nothing to apply.';
}
