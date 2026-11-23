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
 * The demo mailbox in memory: applying a decision changes it the way Gmail
 * and Calendar would (labels, a sent message, an RSVP) without sending
 * anything, and every change can be undone.
 */

import type {PlanItem} from '../decisions/plan.js';
import type {Decision} from '../decisions/types.js';
import {formatMoney, joinList} from '../format.js';
import {firstName, MailboxView} from './mailbox.js';
import type {Mailbox, Message, Thread} from './types.js';

/** Label the demo puts on threads the person decided on, so they leave the card. */
export const DECIDED_LABEL = 'Label_decided';

/** What applying one decision did, and how to take it back. */
export interface Applied {
  /** Short past-tense line for the done row, such as `✓ Declined · Priya gets your note`. */
  readonly result: string;
  readonly undo: () => void;
}

/** A mutable copy of a mailbox. */
export class MailboxStore {
  private mailbox: Mailbox;
  /** Messages the demo would have sent. Nothing leaves the process. */
  readonly outbox: Array<{to: string; subject: string; body: string}> = [];
  /** Payments the demo scheduled, such as `$84.20 to Northwest Power & Light on Dec 1`. */
  readonly scheduled: string[] = [];
  /** What was applied this session, by thread, for summaries across cards. */
  readonly applied = new Map<string, {subject: string; result: string}>();

  constructor(initial: Mailbox) {
    this.mailbox = structuredClone(initial);
  }

  /** A read-only view of the current state. */
  view(): MailboxView {
    return new MailboxView(this.mailbox);
  }

  /** Applies one planned action to the mailbox. */
  apply(decision: Decision, item: PlanItem): Applied {
    const thread = this.mailbox.threads.find(entry => entry.id === decision.threadId);
    if (!thread) throw new Error(`Thread ${decision.threadId} is no longer in the mailbox.`);
    const before = structuredClone(thread);
    const eventId = thread.messages.at(-1)?.invite?.eventId;
    const event = eventId ? this.mailbox.calendar.find(entry => entry.id === eventId) : undefined;
    const eventBefore = event ? structuredClone(event) : undefined;
    const outboxBefore = new Set(this.outbox);
    const scheduledBefore = new Set(this.scheduled);
    const result = this.mutate(thread, decision, item);
    // Exactly what this decision added, so undoing it leaves later decisions' entries alone.
    const sent = this.outbox.filter(entry => !outboxBefore.has(entry));
    const scheduled = this.scheduled.slice(scheduledBefore.size);
    addLabel(thread, DECIDED_LABEL);
    this.applied.set(thread.id, {subject: decision.subject, result});
    return {
      result,
      undo: () => {
        Object.assign(thread, structuredClone(before));
        if (event && eventBefore) Object.assign(event, eventBefore);
        for (const entry of sent) this.outbox.splice(this.outbox.indexOf(entry), 1);
        for (const entry of scheduled) this.scheduled.splice(this.scheduled.indexOf(entry), 1);
        this.applied.delete(thread.id);
      },
    };
  }

  private send(thread: Thread, to: string, body: string): void {
    const last = thread.messages.at(-1)!;
    const subject = last.subject.startsWith('Re: ') ? last.subject : `Re: ${last.subject}`;
    this.outbox.push({to, subject, body});
    const message: Message = {
      id: `${thread.id}m${thread.messages.length + 1}`,
      threadId: thread.id,
      from: this.mailbox.me,
      to: [last.from],
      date: this.mailbox.capturedAt,
      subject,
      snippet: body.slice(0, 140),
      body,
      headers: {},
      attachments: [],
    };
    thread.messages.push(message);
  }

  private mutate(thread: Thread, decision: Decision, item: PlanItem): string {
    const who = String(decision.details['person'] ?? firstName(decision.sender.name));
    const amount = formatMoney(Number(decision.details['amount'] ?? 0));
    switch (`${decision.type}:${item.choice}`) {
      case 'reply:send':
        this.send(thread, decision.sender.email, item.draft ?? '');
        return `✓ Reply sent to ${who}`;
      case 'reply:later':
      case 'scheduling:skip':
        removeLabel(thread, 'INBOX');
        addLabel(thread, 'SNOOZED');
        return '✓ Snoozed until tomorrow, 9 AM';
      case 'reply:skip':
        removeLabel(thread, 'INBOX');
        return '✓ Archived without a reply';
      case 'scheduling:offer': {
        this.send(thread, decision.sender.email, item.draft ?? '');
        const labels = (decision.slots ?? [])
          .filter(slot => item.slots?.includes(slot.value))
          .map(slot => slot.label);
        return `✓ Offered ${joinList(labels)} to ${who}`;
      }
      case 'invite:accept':
      case 'invite:tentative':
      case 'invite:decline': {
        const status =
          item.choice === 'accept'
            ? 'accepted'
            : item.choice === 'tentative'
              ? 'tentative'
              : 'declined';
        const invite = thread.messages.at(-1)?.invite;
        if (invite) invite.responseStatus = status;
        const event = this.mailbox.calendar.find(entry => entry.id === invite?.eventId);
        if (event) event.responseStatus = status;
        removeLabel(thread, 'INBOX');
        if (item.note) {
          this.outbox.push({
            to: decision.sender.email,
            subject: `Re: ${decision.subject}`,
            body: item.note,
          });
        }
        const note = item.note ? ` · ${who} gets your note` : '';
        if (item.choice === 'decline') return `✓ Declined${note}`;
        return item.choice === 'accept'
          ? `✓ Accepted · on your calendar${note}`
          : `✓ Answered maybe${note}`;
      }
      case 'bill:pay_now':
        removeLabel(thread, 'INBOX');
        return `✓ Paid ${amount}`;
      case 'bill:schedule':
        removeLabel(thread, 'INBOX');
        this.scheduled.push(
          `${amount} to ${String(decision.details['payee'])} on ${String(decision.details['due'])}`,
        );
        return `✓ ${amount} scheduled for ${String(decision.details['due'])}`;
      case 'bill:dispute':
        this.outbox.push({
          to: decision.sender.email,
          subject: `Question about ${decision.subject}`,
          body: 'Could you explain the higher amount?',
        });
        return `✓ Question sent to ${String(decision.details['payee'])}`;
      case 'shared_expense:pay':
        removeLabel(thread, 'INBOX');
        return `✓ Sent ${amount} to ${who}`;
      case 'shared_expense:ask':
        this.outbox.push({
          to: decision.sender.email,
          subject: 'What is this for?',
          body: 'Hi! What does this request cover?',
        });
        return `✓ Asked ${who} for details`;
      case 'shared_expense:decline':
        removeLabel(thread, 'INBOX');
        return `✓ Declined ${who}'s request`;
      case 'cleanup:unsubscribe':
        removeLabel(thread, 'INBOX');
        return '✓ Unsubscribed and archived';
      case 'cleanup:archive_all':
        removeLabel(thread, 'INBOX');
        return '✓ Archived · new ones skip the inbox';
      case 'cleanup:keep':
        return '✓ Kept';
      case 'security:report':
        removeLabel(thread, 'INBOX');
        addLabel(thread, 'SPAM');
        return '✓ Reported as phishing';
      case 'security:not_phishing':
        return '✓ Marked safe';
      case 'document:open':
        return '✓ Opened · sign from the link in the email';
      case 'document:remind':
        removeLabel(thread, 'INBOX');
        addLabel(thread, 'SNOOZED');
        return '✓ Reminder set for Monday, 9 AM';
      case 'document:done':
        removeLabel(thread, 'INBOX');
        return '✓ Archived as done';
      default:
        return '✓ Done';
    }
  }
}

function addLabel(thread: Thread, label: string): void {
  if (!thread.labels.includes(label)) thread.labels.push(label);
}

function removeLabel(thread: Thread, label: string): void {
  thread.labels = thread.labels.filter(entry => entry !== label);
}
