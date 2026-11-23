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

/** Loads the synthetic mailbox and answers the questions the rules ask of it. */

import {readFileSync} from 'node:fs';

import {
  MailboxSchema,
  type CalendarEvent,
  type Contact,
  type Engagement,
  type Mailbox,
  type Message,
  type Payee,
  type Thread,
} from './types.js';

/** Reads and validates a mailbox JSON file. */
export function readMailbox(path: string): Mailbox {
  return MailboxSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** The domain of an email address, lowercased. */
export function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/** The first name of a display name, such as `Sam` for `Sam Rivera`. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Read-only queries over a mailbox. */
export class MailboxView {
  readonly now: Date;

  constructor(readonly mailbox: Mailbox) {
    this.now = new Date(mailbox.capturedAt);
  }

  get me() {
    return this.mailbox.me;
  }

  get timeZone() {
    return this.mailbox.timeZone;
  }

  /** Threads in the inbox, newest first. */
  inboxThreads(): Thread[] {
    return this.mailbox.threads
      .filter(thread => thread.labels.includes('INBOX'))
      .sort((a, b) => Date.parse(lastMessage(b).date) - Date.parse(lastMessage(a).date));
  }

  thread(id: string): Thread | undefined {
    return this.mailbox.threads.find(thread => thread.id === id);
  }

  contact(email: string): Contact | undefined {
    const lower = email.toLowerCase();
    return this.mailbox.contacts.find(contact => contact.email.toLowerCase() === lower);
  }

  payee(id: string): Payee | undefined {
    return this.mailbox.payees.find(payee => payee.id === id);
  }

  /** The payee whose name appears in a sender's display name, such as a bank. */
  payeeNamedIn(displayName: string): Payee | undefined {
    const lower = displayName.toLowerCase();
    return this.mailbox.payees.find(payee => lower.includes(payee.name.toLowerCase()));
  }

  engagement(sender: string): Engagement | undefined {
    return this.mailbox.engagement.find(entry => entry.sender === sender.toLowerCase());
  }

  event(id: string): CalendarEvent | undefined {
    return this.mailbox.calendar.find(event => event.id === id);
  }

  /** Accepted events that overlap `[start, end)`, other than `exceptId`. */
  conflicts(start: string, end: string, exceptId?: string): CalendarEvent[] {
    const from = Date.parse(start);
    const to = Date.parse(end);
    return this.mailbox.calendar.filter(
      event =>
        event.id !== exceptId &&
        !event.allDay &&
        (event.responseStatus === 'accepted' || event.responseStatus === 'tentative') &&
        Date.parse(event.start) < to &&
        Date.parse(event.end) > from,
    );
  }

  /** Accepted events on the same local day as `date`. */
  eventsOn(date: string): CalendarEvent[] {
    const day = localDay(date, this.timeZone);
    return this.mailbox.calendar.filter(
      event => event.responseStatus === 'accepted' && localDay(event.start, this.timeZone) === day,
    );
  }

  /** Messages, in any thread, from senders whose address is on `domain`. */
  messagesFromDomain(domain: string): Message[] {
    return this.mailbox.threads.flatMap(thread =>
      thread.messages.filter(message => domainOf(message.from.email) === domain),
    );
  }

  /** Every message with markup of `type`. */
  messagesWithMarkup(type: string): Message[] {
    return this.mailbox.threads.flatMap(thread =>
      thread.messages.filter(message => message.markup?.type === type),
    );
  }

  /**
   * One-hour slots in working hours (9:00 to 17:00) with no accepted event,
   * Monday to Friday of the week after `now`, at most `perDay` a day.
   */
  freeSlotsNextWeek(perDay = 2): Array<{start: string; end: string}> {
    const monday = nextMonday(this.now, this.timeZone);
    const slots: Array<{start: string; end: string}> = [];
    for (let day = 0; day < 5; day++) {
      let taken = 0;
      for (let hour = 9; hour < 17 && taken < perDay; hour++) {
        const start = new Date(monday.getTime() + (day * 24 + hour) * 3_600_000);
        const end = new Date(start.getTime() + 3_600_000);
        if (this.conflicts(start.toISOString(), end.toISOString()).length > 0) continue;
        slots.push({start: start.toISOString(), end: end.toISOString()});
        taken++;
      }
    }
    return slots;
  }
}

/** The last message of a thread. */
export function lastMessage(thread: Thread): Message {
  return thread.messages[thread.messages.length - 1]!;
}

/** `YYYY-MM-DD` of `date` in `timeZone`. */
export function localDay(date: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
}

/** Offset of `timeZone` from UTC at `date`, in minutes (such as -480 for PST). */
function offsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone, timeZoneName: 'longOffset'})
    .formatToParts(date)
    .find(part => part.type === 'timeZoneName')?.value;
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(parts ?? '');
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

/** Local midnight of the Monday after `now`, as an instant. */
function nextMonday(now: Date, timeZone: string): Date {
  const [year, month, day] = localDay(now, timeZone).split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const ahead = ((8 - weekday) % 7) + (weekday === 1 ? 7 : 0) || 7;
  const midnightUtc = Date.UTC(year, month - 1, day + ahead);
  return new Date(midnightUtc - offsetMinutes(new Date(midnightUtc), timeZone) * 60_000);
}
