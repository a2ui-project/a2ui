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

import {lastMessage, MailboxView} from '../mail/mailbox.js';
import {MailboxStore} from '../mail/store.js';
import {demoMailbox, demoView} from '../testing/fixtures.js';
import {consequenceOf, fallbackRecommendation} from './fallback.js';
import {buildPlan} from './plan.js';
import {sanitizeEmailMarkdown} from './sanitize.js';
import {phishingFlags, selectDecisions} from './select.js';
import type {Decision} from './types.js';

function decisions(view = demoView()): Decision[] {
  return selectDecisions(view).map(candidate => ({
    ...candidate,
    ...fallbackRecommendation(candidate, view.me.name),
    source: 'rules',
  }));
}

describe('selectDecisions', () => {
  it('finds the 12 emails that need the person, grouped in tab order', () => {
    const found = selectDecisions(demoView());
    expect(found.map(d => [d.key, d.threadId, d.type])).toEqual([
      ['d01', 't02', 'reply'],
      ['d02', 't01', 'reply'],
      ['d03', 't03', 'scheduling'],
      ['d04', 't05', 'invite'],
      ['d05', 't04', 'invite'],
      ['d06', 't06', 'bill'],
      ['d07', 't07', 'shared_expense'],
      ['d08', 't08', 'cleanup'],
      ['d09', 't09', 'cleanup'],
      ['d10', 't10', 'cleanup'],
      ['d11', 't11', 'security'],
      ['d12', 't12', 'document'],
    ]);
    expect(new Set(found.map(d => d.group))).toEqual(
      new Set(['reply', 'calendar', 'money', 'cleanup', 'review']),
    );
  });

  it('leaves out noise: receipts, confirmations, read newsletters, answered and archived threads', () => {
    const picked = new Set(selectDecisions(demoView()).map(d => d.threadId));
    for (let n = 13; n <= 30; n++) expect(picked.has(`t${n}`)).toBe(false);
  });

  it('collects the evidence each type shows', () => {
    const byType = Object.fromEntries(selectDecisions(demoView()).map(d => [d.threadId, d]));
    expect(byType['t04']!.facts[0]).toBe('Overlaps Dentist (Dr. Patel), Fri Dec 4, 2:00 PM');
    expect(byType['t04']!.details['alternative']).toBe('Thursday Dec 3 at 1:00 PM');
    expect(byType['t05']!.facts[0]).toMatch(/you're free/);
    expect(byType['t06']!.facts[0]).toBe('$84.20 due Dec 1 · 12% more than October ($75.18)');
    expect(byType['t07']!.facts[0]).toMatch(/matches "Dinner with Alex at Lupo" on Wed Nov 18/);
    expect(byType['t08']!.facts[0]).toMatch(/^Opened 0 of the last 12/);
    expect(byType['t02']!.related?.[0]).toMatch(/lands Fri Dec 4, 8:55 PM/);
    expect(byType['t02']!.facts).toEqual(['Your flight lands Fri Dec 4, 8:55 PM (NS 1424)']);
    expect(byType['t02']!.details['person']).toBe('Mom');
    expect(byType['t03']!.slots?.map(slot => slot.label)).toEqual([
      'Tue 10:00 AM',
      'Tue 2:00 PM',
      'Wed 3:00 PM',
      'Thu 12:00 PM',
      'Thu 1:00 PM',
      'Fri 9:00 AM',
    ]);
  });

  it('flags the phishing email and never offers paying or opening links on it', () => {
    const view = demoView();
    const phishing = selectDecisions(view).find(d => d.type === 'security')!;
    expect(phishing.redFlags).toEqual([
      "Sender evergreen-bank-secure.example.net isn't Evergreen Bank (evergreenbank.example)",
      'Replies go to a different address',
      'Failed sender checks',
      'Pressure to act fast',
      'Asks you to sign in through a link',
    ]);
    expect(phishing.options.map(option => option.value)).toEqual(['report', 'not_phishing']);
    expect(phishing.excerpt).not.toMatch(/\]\(|https?:/);
    const statement = lastMessage(view.thread('t17')!);
    expect(phishingFlags(view, statement)).toEqual([]);
  });

  it('drops decided threads', () => {
    const store = new MailboxStore(demoMailbox());
    const [first] = decisions(store.view());
    store.apply(first!, buildPlan([first!], {}).items[0]!);
    expect(selectDecisions(store.view()).map(d => d.threadId)).not.toContain(first!.threadId);
  });
});

describe('fallbackRecommendation', () => {
  it('gives every type a valid pick with a reason and a consequence', () => {
    const picks = Object.fromEntries(decisions().map(d => [d.threadId, d]));
    expect(picks['t02']!.recommended).toBe('send');
    expect(picks['t02']!.draft).toBe(
      'Hi Mom,\n\nYes! I land at 8:55 PM on Friday. See you soon!\n\nMaya',
    );
    expect(picks['t03']!.recommended).toBe('offer');
    expect(picks['t03']!.reason).toBe("You're free Tue 10:00 AM and Wed 3:00 PM.");
    expect(picks['t04']).toMatchObject({
      recommended: 'decline',
      reason: 'Overlaps your dentist appointment; suggest Thursday.',
    });
    expect(picks['t04']!.note).toBe(
      'Sorry, I have a conflict then. Could we do Thursday Dec 3 at 1:00 PM instead?',
    );
    expect(picks['t05']!.recommended).toBe('accept');
    expect(picks['t06']!.recommended).toBe('schedule');
    expect(picks['t06']!.reason).toMatch(/12% higher than October/);
    expect(picks['t07']!.recommended).toBe('pay');
    expect(picks['t08']!.recommended).toBe('unsubscribe');
    expect(picks['t09']!.recommended).toBe('archive_all');
    expect(picks['t10']!.recommended).toBe('keep');
    expect(picks['t11']!.recommended).toBe('report');
    expect(picks['t12']!.recommended).toBe('remind');
    for (const decision of decisions()) {
      expect(decision.options.map(option => option.value)).toContain(decision.recommended);
      expect(decision.reason.length).toBeGreaterThan(5);
      expect(decision.consequence).toBe(consequenceOf(decision, decision.recommended));
    }
  });
});

describe('buildPlan', () => {
  it('summarizes the recommended choices in one sentence', () => {
    const plan = buildPlan(decisions(), {});
    expect(plan.summary).toBe(
      'Send 2 replies, offer 2 times to Jordan, accept 1 invite, decline 1 invite, schedule $84.20 on Dec 1, send Alex $42.50, unsubscribe from 1, archive all from 1 sender, keep 1 newsletter, report 1 phishing email and remind you Monday about 1 document.',
    );
    expect(plan.changed).toBe(0);
    expect(plan.items).toHaveLength(12);
  });

  it("uses the person's choices, edited drafts and times, and counts overrides", () => {
    const all = decisions();
    const plan = buildPlan(all, {
      d02: {choice: ['skip']},
      d03: {choice: ['offer'], slots: [all[2]!.slots![5]!.value, 'not-a-slot'], draft: 'Friday?'},
      d05: {choice: ['accept'], note: ''},
      d06: {choice: ['bogus']},
    });
    expect(plan.changed).toBe(2);
    expect(plan.items.find(item => item.key === 'd03')).toMatchObject({
      slots: [all[2]!.slots![5]!.value],
      draft: 'Friday?',
    });
    expect(plan.items.find(item => item.key === 'd06')!.choice).toBe('schedule');
    expect(plan.summary).toMatch(
      /^Send 1 reply, archive 1 without replying, offer 1 time to Jordan, accept 2 invites/,
    );
    expect(buildPlan(all, {d02: {choice: ['send'], draft: 'Edited'}}).key).not.toBe(
      buildPlan(all, {}).key,
    );
  });
});

describe('invite notes', () => {
  it("send the agent's decline note only with a decline, unless the person edited it", () => {
    const all = decisions();
    const invite = all.find(d => d.threadId === 't04')!;
    const note = (choice: Record<string, unknown>) =>
      buildPlan([invite], {[invite.key]: choice as never}).items[0]!.note;
    expect(note({choice: ['decline'], note: invite.note})).toBe(invite.note);
    expect(note({choice: ['accept'], note: invite.note})).toBe('');
    expect(note({choice: ['accept'], note: 'See you there!'})).toBe('See you there!');
  });
});

describe('MailboxStore', () => {
  it('applies a decision without sending anything real and undoes it', () => {
    const store = new MailboxStore(demoMailbox());
    const all = decisions(store.view());
    const invite = all.find(d => d.threadId === 't04')!;
    const applied = store.apply(invite, buildPlan([invite], {}).items[0]!);
    expect(applied.result).toBe('✓ Declined · Priya gets your note');
    expect(store.view().event('e_offsite')!.responseStatus).toBe('declined');
    expect(store.outbox).toHaveLength(1);
    applied.undo();
    expect(store.view().event('e_offsite')!.responseStatus).toBe('needsAction');
    expect(store.outbox).toHaveLength(0);
    expect(selectDecisions(store.view()).map(d => d.threadId)).toContain('t04');
  });

  it('undoes one decision without touching what later decisions sent or scheduled', () => {
    const store = new MailboxStore(demoMailbox());
    const all = decisions(store.view());
    const invite = all.find(d => d.threadId === 't04')!;
    const bill = all.find(d => d.threadId === 't06')!;
    const undoInvite = store.apply(invite, buildPlan([invite], {}).items[0]!).undo;
    store.apply(bill, buildPlan([bill], {}).items[0]!);
    undoInvite();
    expect(store.scheduled).toEqual(['$84.20 to Northwest Power & Light on Dec 1']);
    expect(store.outbox).toHaveLength(0);
    expect([...store.applied.keys()]).toEqual(['t06']);
  });

  it('never changes the fixture it was created from', () => {
    const mailbox = demoMailbox();
    const store = new MailboxStore(mailbox);
    const reply = decisions(store.view())[0]!;
    store.apply(reply, buildPlan([reply], {}).items[0]!);
    expect(new MailboxView(mailbox).thread(reply.threadId)!.messages).toHaveLength(1);
  });
});

describe('sanitizeEmailMarkdown', () => {
  it('removes links, images and HTML, and cuts long text', () => {
    expect(
      sanitizeEmailMarkdown(
        '[Verify](https://evil.example/x) and https://a.example/b ![p](https://t.example/p.gif) <b>x</b>',
      ),
    ).toBe('Verify (link to `evil.example`) and `a.example` (image removed) &lt;b>x&lt;/b>');
    expect(sanitizeEmailMarkdown('word '.repeat(300), 50)).toMatch(/^(word ){8,}word…$/);
  });
});
