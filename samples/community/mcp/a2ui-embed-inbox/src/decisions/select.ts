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
 * Deterministic selection of the emails that need the person, and the
 * evidence each decision shows. Rules over labels, senders, headers and
 * markup keep the demo stable; the model only recommends and drafts.
 */

import {formatDay, formatMoney, formatMonth, formatWhen, plural} from '../format.js';
import {domainOf, firstName, lastMessage, MailboxView} from '../mail/mailbox.js';
import {DECIDED_LABEL} from '../mail/store.js';
import type {Markup, Message, Thread} from '../mail/types.js';
import {sanitizeEmailMarkdown} from './sanitize.js';
import {
  GROUPS,
  groupOf,
  type ChoiceOption,
  type DecisionCandidate,
  type DecisionType,
} from './types.js';

/** Senders whose questions need a reply. */
const PEOPLE = new Set(['family', 'manager', 'coworker', 'friend']);

/** A sender opened at most this share of their recent messages: worth cleaning up. */
const CLEANUP_OPEN_RATE = 0.4;

const AVAILABILITY = /\b(free|available|availability|coffee|catch up|meet|next week)\b/i;

const URGENCY = /\b(within 24 hours|immediately|suspend|suspension|urgent|final notice)\b/i;

type Draft = Omit<DecisionCandidate, 'key' | 'group' | 'excerpt'>;

/** Finds every inbox email that needs a decision, in tab order. */
export function selectDecisions(view: MailboxView): DecisionCandidate[] {
  const found: Array<{draft: Draft; message: Message}> = [];
  for (const thread of view.inboxThreads()) {
    if (thread.labels.includes(DECIDED_LABEL)) continue;
    const message = lastMessage(thread);
    if (message.from.email.toLowerCase() === view.me.email.toLowerCase()) continue;
    const draft = classify(view, thread, message);
    if (draft) found.push({draft, message});
  }
  const order = (type: DecisionType) =>
    GROUPS.findIndex(group => (group.types as readonly DecisionType[]).includes(type)) * 10 +
    GROUPS.flatMap(group => group.types as readonly DecisionType[]).indexOf(type);
  found.sort(
    (a, b) =>
      order(a.draft.type) - order(b.draft.type) ||
      Date.parse(b.message.date) - Date.parse(a.message.date),
  );
  return found.map(({draft, message}, index) => ({
    ...draft,
    key: `d${String(index + 1).padStart(2, '0')}`,
    group: groupOf(draft.type),
    excerpt: sanitizeEmailMarkdown(message.body),
  }));
}

function classify(view: MailboxView, thread: Thread, message: Message): Draft | undefined {
  const base = {
    threadId: thread.id,
    subject: message.subject,
    sender: message.from,
    relationship: view.contact(message.from.email)?.relationship,
    received: message.date,
  };
  const redFlags = phishingFlags(view, message);
  if (redFlags.length >= 2) {
    return {
      ...base,
      type: 'security',
      options: [
        {value: 'report', label: 'Report phishing'},
        {value: 'not_phishing', label: "It's safe"},
      ],
      facts: [redFlags[0]!],
      redFlags,
      details: {flags: redFlags.length},
    };
  }
  if (
    message.invite?.responseStatus === 'needsAction' &&
    Date.parse(message.invite.end) > view.now.getTime()
  ) {
    return invite(view, base, message.invite);
  }
  const markup = message.markup;
  if (markup?.type === 'Invoice' && markup.paymentStatus === 'PaymentDue') {
    return bill(view, base, markup);
  }
  if (
    markup?.type === 'MoneyRequest' &&
    PEOPLE.has(view.contact(markup.requester.email)?.relationship ?? '')
  ) {
    return sharedExpense(view, base, markup);
  }
  if (markup?.type === 'SignatureRequest') {
    return document(view, base, markup);
  }
  const engagement = view.engagement(message.from.email);
  if (
    message.headers['List-Unsubscribe'] &&
    engagement &&
    engagement.received >= 6 &&
    engagement.opened / engagement.received <= CLEANUP_OPEN_RATE
  ) {
    return cleanup(view, base, message, engagement);
  }
  if (base.relationship && PEOPLE.has(base.relationship) && message.body.includes('?')) {
    return AVAILABILITY.test(`${message.subject} ${message.body}`)
      ? scheduling(view, base)
      : reply(view, base, message);
  }
  return undefined;
}

/** Signs that a message impersonates a known sender. */
export function phishingFlags(view: MailboxView, message: Message): string[] {
  const flags: string[] = [];
  const domain = domainOf(message.from.email);
  const brand = view.payeeNamedIn(message.from.name);
  if (brand && !brand.domains.includes(domain)) {
    flags.push(`Sender ${domain} isn't ${brand.name} (${brand.domains[0] ?? 'unknown'})`);
  }
  const replyTo = message.headers['Reply-To'];
  if (replyTo && domainOf(replyTo) !== domain) flags.push('Replies go to a different address');
  if (/(spf|dmarc)=fail/i.test(message.headers['Authentication-Results'] ?? '')) {
    flags.push('Failed sender checks');
  }
  if (URGENCY.test(message.body)) flags.push('Pressure to act fast');
  if (
    /\]\(https?:\/\//.test(message.body) &&
    /verify|sign in|log in|password/i.test(message.body)
  ) {
    flags.push('Asks you to sign in through a link');
  }
  return flags;
}

type Base = Pick<Draft, 'threadId' | 'subject' | 'sender' | 'relationship' | 'received'>;

function invite(view: MailboxView, base: Base, invite: NonNullable<Message['invite']>): Draft {
  const conflicts = view.conflicts(invite.start, invite.end, invite.eventId);
  const when = formatWhen(invite.start, view.timeZone);
  const facts = [
    conflicts.length > 0
      ? `Overlaps ${conflicts[0]!.title}, ${formatWhen(conflicts[0]!.start, view.timeZone)}`
      : `${when}: you're free`,
  ];
  const alternative = conflicts.length > 0 ? alternativeDay(view, invite.start, invite.end) : '';
  return {
    ...base,
    sender: invite.organizer,
    type: 'invite',
    options: [
      {value: 'accept', label: 'Accept'},
      {value: 'tentative', label: 'Maybe'},
      {value: 'decline', label: 'Decline'},
    ],
    facts,
    details: {
      when,
      conflict: conflicts[0]?.title ?? '',
      alternative,
      organizer: firstName(invite.organizer.name),
    },
  };
}

/** Another weekday of the same week with the same hours free, such as `Thursday Dec 3 at 1:00 PM`. */
function alternativeDay(view: MailboxView, start: string, end: string): string {
  const length = Date.parse(end) - Date.parse(start);
  for (const shift of [-1, 1, -2, 2, -3, 3]) {
    const from = new Date(Date.parse(start) + shift * 86_400_000);
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: view.timeZone,
      weekday: 'long',
    }).format(from);
    if (weekday === 'Saturday' || weekday === 'Sunday' || from.getTime() < view.now.getTime())
      continue;
    const to = new Date(from.getTime() + length);
    if (view.conflicts(from.toISOString(), to.toISOString()).length === 0) {
      return `${weekday} ${formatWhen(from, view.timeZone).replace(/^\w+ /, '').replace(', ', ' at ')}`;
    }
  }
  return '';
}

function bill(view: MailboxView, base: Base, invoice: Extract<Markup, {type: 'Invoice'}>): Draft {
  const payee = view.payee(invoice.provider);
  const previous = payee?.history
    .filter(entry => entry.period < invoice.period)
    .sort((a, b) => b.period.localeCompare(a.period))[0];
  const change = previous
    ? Math.round(((invoice.amount - previous.amount) / previous.amount) * 100)
    : 0;
  const due = formatDay(invoice.dueDate);
  const facts = [
    `${formatMoney(invoice.amount, invoice.currency)} due ${due}` +
      (previous
        ? ` · ${change === 0 ? 'same as' : `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than`} ${formatMonth(previous.period)} (${formatMoney(previous.amount, invoice.currency)})`
        : ''),
  ];
  return {
    ...base,
    type: 'bill',
    options: [
      {value: 'pay_now', label: 'Pay now'},
      {value: 'schedule', label: `Pay on ${due}`},
      {value: 'dispute', label: 'Question it'},
    ],
    facts,
    details: {
      payee: payee?.name ?? base.sender.name,
      amount: invoice.amount,
      currency: invoice.currency,
      dueDate: invoice.dueDate,
      due,
      change,
      previousMonth: previous ? formatMonth(previous.period) : '',
      previousAmount: previous?.amount ?? 0,
      daysLeft: Math.ceil(
        (Date.parse(`${invoice.dueDate}T00:00:00Z`) - view.now.getTime()) / 86_400_000,
      ),
    },
  };
}

function sharedExpense(
  view: MailboxView,
  base: Base,
  request: Extract<Markup, {type: 'MoneyRequest'}>,
): Draft {
  const amount = formatMoney(request.amount, request.currency);
  const match = request.forDate
    ? view
        .eventsOn(`${request.forDate}T12:00:00Z`)
        .find(event =>
          event.title.toLowerCase().includes(firstName(request.requester.name).toLowerCase()),
        )
    : undefined;
  const split =
    request.total !== undefined
      ? `half of ${formatMoney(request.total, request.currency)}`
      : 'no split shown';
  return {
    ...base,
    sender: request.requester,
    relationship: view.contact(request.requester.email)?.relationship,
    type: 'shared_expense',
    options: [
      {value: 'pay', label: `Pay ${amount}`},
      {value: 'ask', label: 'Ask for details'},
      {value: 'decline', label: 'Decline'},
    ],
    facts: [
      `${amount} · ${split}` +
        (match
          ? ` · matches "${match.title}" on ${formatWhen(match.start, view.timeZone, false)}`
          : ''),
    ],
    details: {
      amount: request.amount,
      currency: request.currency,
      total: request.total ?? 0,
      matched: match ? `${match.title} on ${formatWhen(match.start, view.timeZone, false)}` : '',
      requester: firstName(request.requester.name),
    },
  };
}

function document(
  view: MailboxView,
  base: Base,
  request: Extract<Markup, {type: 'SignatureRequest'}>,
): Draft {
  const daysLeft = Math.ceil(
    (Date.parse(`${request.dueDate}T00:00:00Z`) - view.now.getTime()) / 86_400_000,
  );
  return {
    ...base,
    type: 'document',
    options: [
      {value: 'open', label: 'Open to sign'},
      {value: 'remind', label: 'Remind me Monday'},
      {value: 'done', label: 'Already done'},
    ],
    facts: [`${request.document} from ${request.requester} · due ${formatDay(request.dueDate)}`],
    details: {
      document: request.document,
      requester: request.requester,
      due: formatDay(request.dueDate),
      daysLeft,
    },
  };
}

function cleanup(
  view: MailboxView,
  base: Base,
  message: Message,
  engagement: NonNullable<ReturnType<MailboxView['engagement']>>,
): Draft {
  const domain = domainOf(message.from.email);
  const orders = view
    .messagesFromDomain(domain)
    .filter(other => other.from.email !== message.from.email);
  const word = firstName(message.from.name).toLowerCase();
  const onCalendar = view.mailbox.calendar.find(
    event =>
      Date.parse(event.start) > view.now.getTime() &&
      message.from.name
        .toLowerCase()
        .split(/\s+/)
        .some(part => part.length > 4 && event.title.toLowerCase().includes(part)),
  );
  const facts = [
    `Opened ${engagement.opened} of the last ${engagement.received} · about ${plural(engagement.perWeek, 'email', 'emails')} a week`,
  ];
  if (onCalendar) facts.push(`"${onCalendar.title}" is on your calendar`);
  else if (orders.length > 0) facts.push(`You also get order emails from ${domain}`);
  return {
    ...base,
    type: 'cleanup',
    options: [
      {value: 'unsubscribe', label: 'Unsubscribe'},
      {value: 'archive_all', label: 'Archive all from them'},
      {value: 'keep', label: 'Keep'},
    ],
    facts,
    details: {
      opened: engagement.opened,
      received: engagement.received,
      perWeek: engagement.perWeek,
      hasOrders: orders.length > 0,
      onCalendar: onCalendar?.title ?? '',
      word,
    },
  };
}

function scheduling(view: MailboxView, base: Base): Draft {
  const slots: ChoiceOption[] = view
    .freeSlotsNextWeek(2)
    .slice(0, 6)
    .map(slot => ({
      value: slot.start,
      label: formatWhen(slot.start, view.timeZone).replace(/^(\w+) \w+ \d+,/, '$1'),
    }));
  return {
    ...base,
    type: 'scheduling',
    options: [
      {value: 'offer', label: 'Offer these times'},
      {value: 'skip', label: 'Not now'},
    ],
    facts: [`${plural(slots.length, 'free slot', 'free slots')} next week on your calendar`],
    slots,
    details: {person: greetingName(view, base)},
  };
}

/** What the person calls a sender: a nickname such as `Mom`, else the first name. */
function greetingName(view: MailboxView, base: Base): string {
  return view.contact(base.sender.email)?.nickname ?? firstName(base.sender.name);
}

function reply(view: MailboxView, base: Base, message: Message): Draft {
  const related: string[] = [];
  const facts: string[] = [];
  if (/\b(land|landing|arrive|arrival|flight|flying)\b/i.test(message.body)) {
    for (const flight of view.messagesWithMarkup('FlightReservation')) {
      const markup = flight.markup as Extract<Markup, {type: 'FlightReservation'}>;
      if (Date.parse(markup.arrives) < view.now.getTime()) continue;
      related.push(
        `Flight ${markup.flight} ${markup.from} to ${markup.to} lands ${formatWhen(markup.arrives, view.timeZone)} (from "${flight.subject}")`,
      );
      facts.push(
        `Your flight lands ${formatWhen(markup.arrives, view.timeZone)} (${markup.flight})`,
      );
    }
  }
  return {
    ...base,
    type: 'reply',
    options: [
      {value: 'send', label: 'Send reply'},
      {value: 'later', label: 'Remind me tomorrow'},
      {value: 'skip', label: 'No reply needed'},
    ],
    facts: facts.slice(0, 1),
    related,
    details: {person: greetingName(view, base)},
  };
}
