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

import {describe, expect, it} from 'vitest';

import {mailboxPath} from '../config.js';
import {formatWhen} from '../format.js';
import {domainOf, firstName, lastMessage, localDay, MailboxView, readMailbox} from './mailbox.js';

const view = new MailboxView(readMailbox(mailboxPath({})));

describe('the demo mailbox', () => {
  it('loads a week of Gmail-shaped threads, a calendar and contacts', () => {
    expect(view.mailbox.threads).toHaveLength(30);
    expect(view.inboxThreads()).toHaveLength(28);
    expect(view.me.name).toBe('Maya Chen');
    expect(view.contact('LINDA.CHEN@example.net')).toMatchObject({
      relationship: 'family',
      nickname: 'Mom',
    });
    expect(view.payeeNamedIn('Evergreen Bank Security')?.domains).toEqual([
      'evergreenbank.example',
    ]);
    expect(view.engagement('digest@dailyproductbrief.example')).toMatchObject({
      opened: 0,
      received: 12,
    });
    expect(lastMessage(view.thread('t21')!).from.email).toBe('maya.chen@example.com');
  });

  it('finds calendar conflicts and free slots next week', () => {
    const offsite = view.event('e_offsite')!;
    expect(
      view.conflicts(offsite.start, offsite.end, offsite.id).map(event => event.title),
    ).toEqual(['Dentist (Dr. Patel)']);
    expect(view.freeSlotsNextWeek(2).map(slot => formatWhen(slot.start, view.timeZone))).toEqual([
      'Tue Dec 1, 10:00 AM',
      'Tue Dec 1, 2:00 PM',
      'Wed Dec 2, 3:00 PM',
      'Thu Dec 3, 12:00 PM',
      'Thu Dec 3, 1:00 PM',
      'Fri Dec 4, 9:00 AM',
      'Fri Dec 4, 10:00 AM',
    ]);
    expect(view.eventsOn('2026-11-18T12:00:00Z').map(event => event.title)).toEqual([
      'Dinner with Alex at Lupo',
    ]);
  });

  it('has small helpers for addresses, names and days', () => {
    expect(domainOf('Security@Evergreen-Bank-Secure.example.net')).toBe(
      'evergreen-bank-secure.example.net',
    );
    expect(firstName('Sam Rivera')).toBe('Sam');
    expect(localDay('2026-11-25T07:30:00Z', 'America/Los_Angeles')).toBe('2026-11-24');
  });
});
