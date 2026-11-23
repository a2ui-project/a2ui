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
 * The synthetic mailbox, shaped like the Gmail and Calendar APIs so the
 * sample could read real data later: threads of messages with labels and
 * headers, schema.org-like markup Gmail extracts from bills and trips, and
 * calendar invites parsed from `text/calendar` attachments.
 */

import {z} from 'zod';

const PersonSchema = z.object({name: z.string(), email: z.string()});
export type Person = z.infer<typeof PersonSchema>;

const InviteSchema = z.object({
  eventId: z.string(),
  organizer: PersonSchema,
  start: z.string(),
  end: z.string(),
  location: z.string().optional(),
  responseStatus: z.enum(['needsAction', 'accepted', 'tentative', 'declined']),
});

const MarkupSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('Invoice'),
    provider: z.string(),
    amount: z.number(),
    currency: z.string(),
    period: z.string(),
    dueDate: z.string(),
    paymentStatus: z.enum(['PaymentDue', 'PaymentComplete']),
  }),
  z.object({
    type: z.literal('MoneyRequest'),
    requester: PersonSchema,
    amount: z.number(),
    currency: z.string(),
    total: z.number().optional(),
    note: z.string(),
    forDate: z.string().optional(),
  }),
  z.object({
    type: z.literal('SignatureRequest'),
    requester: z.string(),
    document: z.string(),
    dueDate: z.string(),
  }),
  z.object({
    type: z.literal('FlightReservation'),
    flight: z.string(),
    from: z.string(),
    to: z.string(),
    departs: z.string(),
    arrives: z.string(),
  }),
]);
export type Markup = z.infer<typeof MarkupSchema>;

const MessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  from: PersonSchema,
  to: z.array(PersonSchema),
  date: z.string(),
  subject: z.string(),
  snippet: z.string(),
  /** Markdown. */
  body: z.string(),
  headers: z.record(z.string()),
  attachments: z.array(z.object({filename: z.string(), mimeType: z.string(), size: z.number()})),
  markup: MarkupSchema.optional(),
  invite: InviteSchema.optional(),
});
export type Message = z.infer<typeof MessageSchema>;

const ThreadSchema = z.object({
  id: z.string(),
  /** Gmail label ids such as `INBOX`, `UNREAD` or `CATEGORY_PROMOTIONS`. */
  labels: z.array(z.string()),
  messages: z.array(MessageSchema).min(1),
});
export type Thread = z.infer<typeof ThreadSchema>;

const RelationshipSchema = z.enum(['family', 'manager', 'coworker', 'friend', 'vendor']);
export type Relationship = z.infer<typeof RelationshipSchema>;

const CalendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean().optional(),
  location: z.string().optional(),
  organizer: z.string().optional(),
  responseStatus: z.enum(['needsAction', 'accepted', 'tentative', 'declined']),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const MailboxSchema = z.object({
  /** The demo's clock: "now" for every relative date. */
  capturedAt: z.string(),
  timeZone: z.string(),
  me: PersonSchema,
  contacts: z.array(
    PersonSchema.extend({
      relationship: RelationshipSchema,
      /** What the person calls them, such as `Mom`. */
      nickname: z.string().optional(),
      note: z.string().optional(),
    }),
  ),
  payees: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      domains: z.array(z.string()),
      history: z.array(z.object({period: z.string(), amount: z.number()})),
    }),
  ),
  calendar: z.array(CalendarEventSchema),
  /** How many of a sender's recent messages the person opened. */
  engagement: z.array(
    z.object({
      sender: z.string(),
      received: z.number().int(),
      opened: z.number().int(),
      perWeek: z.number(),
    }),
  ),
  threads: z.array(ThreadSchema),
});
export type Mailbox = z.infer<typeof MailboxSchema>;
export type Contact = Mailbox['contacts'][number];
export type Payee = Mailbox['payees'][number];
export type Engagement = Mailbox['engagement'][number];
