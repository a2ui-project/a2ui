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

import {fallbackRecommendation} from '../decisions/fallback.js';
import {selectDecisions} from '../decisions/select.js';
import type {Decision, DecisionType} from '../decisions/types.js';
import {demoView} from '../testing/fixtures.js';
import {allComponents, validationErrors} from '../testing/validation.js';
import {createSurfaceMessages, jsonBytes, type A2uiComponent} from './a2ui.js';
import {composeCard, doneItem, type ItemState} from './card.js';
import type {Choice} from './events.js';
import {decisionsSummary} from './summary.js';

const view = demoView();
const decisions: Decision[] = selectDecisions(view).map(candidate => ({
  ...candidate,
  ...fallbackRecommendation(candidate, view.me.name),
  source: 'rules',
}));

function card(list = decisions, states = new Map<string, ItemState>()) {
  return composeCard({
    surfaceId: 'inbox_1',
    decisions: list,
    states,
    source: 'gemini',
    timeZone: view.timeZone,
  });
}

function byId(components: readonly A2uiComponent[]) {
  return new Map(components.map(entry => [entry.id, entry]));
}

const keyOf = (type: DecisionType) => decisions.find(decision => decision.type === type)!.key;

describe('composeCard', () => {
  it('builds a valid card with one tab per group and counts', () => {
    const view1 = card();
    expect(validationErrors(createSurfaceMessages(view1))).toEqual([]);
    const components = byId(view1.components);
    const tabs = components.get('tabs')!['tabs'] as Array<{title: unknown; child: string}>;
    expect(tabs.map(tab => tab.child)).toEqual([
      'group_reply',
      'group_calendar',
      'group_money',
      'group_cleanup',
      'group_review',
    ]);
    expect(view1.dataModel['tabs']).toEqual({
      reply: 'Reply · 3',
      calendar: 'Calendar · 2',
      money: 'Money · 2',
      cleanup: 'Clean up · 3',
      review: 'Review · 2',
    });
    expect(view1.dataModel['header']).toEqual({
      title: '**12 emails need you**',
      subtitle: 'My picks are pre-selected · about 3 min',
    });
    expect(view1.dataModel['apply']).toEqual({label: 'Apply 12 decisions', count: 12});
    expect(view1.sendDataModel).toBe(true);
  });

  it('pre-selects each recommendation and marks it with a star', () => {
    const view1 = card();
    const components = byId(view1.components);
    const c = view1.dataModel['c'] as Record<string, {choice: string[]}>;
    for (const decision of decisions) {
      expect(c[decision.key]!.choice).toEqual([decision.recommended]);
      const picker = components.get(`${decision.key}_choice`)!;
      const labels = (picker['options'] as Array<{label: string; value: string}>).filter(option =>
        option.label.startsWith('★'),
      );
      expect(labels.map(option => option.value)).toEqual([decision.recommended]);
    }
    const d = view1.dataModel['d'] as Record<string, Record<string, string>>;
    expect(d[keyOf('invite')]!['why']).toMatch(/^★ My pick: Accept\. /);
  });

  it('binds the reason, "what happens" and the note label to the choice', () => {
    const view1 = card();
    const components = byId(view1.components);
    const d = view1.dataModel['d'] as Record<string, Record<string, unknown>>;
    expect(d['d05']!['why']).toBe(
      '★ My pick: Decline. Overlaps your dentist appointment; suggest Thursday.',
    );
    expect(d['d05']!['what']).toEqual({
      accept: "Added to your calendar; Priya sees you're going.",
      tentative: 'Stays on your calendar as maybe; Priya sees a tentative reply.',
      decline: 'Priya gets your decline with your note.',
    });
    const choice = {'@path': '/c/d05/choice'};
    // Other options' lines hold only server labels; the model-written reason stays in the data model.
    expect(components.get('d05_why')!['text']).toEqual({
      '@call': 'byChoice',
      args: {
        texts: {
          accept: 'Your choice: Accept · ★ My pick was Decline',
          tentative: 'Your choice: Maybe · ★ My pick was Decline',
        },
        choice,
        fallback: {'@path': '/d/d05/why'},
      },
    });
    expect(components.get('d05_what')!['text']).toEqual({
      '@call': 'byChoice',
      args: {texts: {'@path': '/d/d05/what'}, choice, prefix: 'What happens: '},
    });
    expect(components.get('d05_note')!['label']).toMatchObject({
      '@call': 'byChoice',
      args: {texts: {decline: 'Note to the organizer (sent with your decline)'}, choice},
    });
  });

  it('shows a small card when a group or the whole inbox has nothing left', () => {
    const empty = composeCard({
      surfaceId: 'inbox_9',
      decisions: [],
      states: new Map(),
      source: 'gemini',
      timeZone: view.timeZone,
      focus: 'money',
      appliedEarlier: 2,
      scheduled: ['$84.20 to Northwest Power & Light on Dec 1'],
    });
    expect(validationErrors(createSurfaceMessages(empty))).toEqual([]);
    expect(byId(empty.components).get('main')!['children']).toEqual(['header', 'empty_note']);
    expect(byId(empty.components).has('tabs')).toBe(false);
    expect(empty.dataModel['header']).toEqual({
      title: '**Nothing left in Money**',
      subtitle: '2 decisions applied earlier · demo mailbox: nothing is sent',
    });
    const whole = composeCard({
      surfaceId: 'inbox_9',
      decisions: [],
      states: new Map(),
      source: 'rules',
      timeZone: view.timeZone,
    });
    expect(whole.dataModel['header']).toMatchObject({title: '**Nothing needs you right now**'});
    expect(validationErrors(createSurfaceMessages(whole))).toEqual([]);
  });

  it('gives each decision type its own controls', () => {
    const components = byId(card().components);
    const reply = keyOf('reply');
    expect(components.get(`${reply}_draft`)).toMatchObject({
      component: 'TextField',
      variant: 'longText',
    });
    expect(components.get(`${reply}_tone`)).toMatchObject({
      component: 'ChoicePicker',
      displayStyle: 'chips',
    });
    expect(components.get(`${reply}_rewrite`)!['action']).toMatchObject({
      event: {name: 'regenerate_draft'},
    });
    expect(components.get(`${reply}_ask`)!['action']).toMatchObject({
      event: {name: 'rewrite_reply'},
    });
    const scheduling = keyOf('scheduling');
    expect(components.get(scheduling)!['children']).toContain(`${scheduling}_slots`);
    expect(components.get(`${scheduling}_slots`)).toMatchObject({
      variant: 'multipleSelection',
      displayStyle: 'chips',
    });
    expect(components.get(`${keyOf('invite')}_note`)).toMatchObject({component: 'TextField'});
    expect(components.get(`${keyOf('security')}_d_flags`)).toMatchObject({
      text: {'@path': `/d/${keyOf('security')}/flags`},
    });
    for (const type of ['bill', 'shared_expense', 'cleanup', 'document'] as const) {
      const key = keyOf(type);
      expect(components.get(`${key}_modal`)).toMatchObject({
        component: 'Modal',
        trigger: `${key}_open`,
        content: `${key}_details`,
      });
      expect(components.has(`${key}_draft`)).toBe(false);
    }
    const security = decisions.find(decision => decision.type === 'security')!;
    expect(security.options.map(option => option.label).join(' ')).not.toMatch(/pay|open|link/i);
  });

  it('lays out a single group without tabs', () => {
    const money = decisions.filter(decision => decision.group === 'money');
    const view1 = card(money);
    const components = byId(view1.components);
    expect(components.has('tabs')).toBe(false);
    expect(components.get('main')!['children']).toEqual(['header', 'group_only', 'footer']);
    expect(components.get('group_only')!['children']).toEqual([
      money[0]!.key,
      `${money[1]!.key}_sep`,
      money[1]!.key,
    ]);
    expect(validationErrors(createSurfaceMessages(view1))).toEqual([]);
  });

  it('renders done items with Undo, and no Apply once everything is done', () => {
    const states = new Map<string, ItemState>(
      decisions.map(decision => [decision.key, {status: 'done', result: '✓ Done'}]),
    );
    const view1 = card(decisions, states);
    const components = byId(view1.components);
    expect(components.get('d01')!['children']).toEqual(['d01_done']);
    expect(components.get('footer')!['children']).toEqual(['footer_note']);
    // "All done" lists every applied item across groups, each with Undo.
    expect(components.get('main')!['children']).toEqual(['header', 'applied_panel']);
    expect(components.get('applied_undo')!['action']).toEqual({
      event: {name: 'undo', context: {key: {'@path': 'key'}}},
    });
    const applied = view1.dataModel['applied'] as Array<{key: string; text: string}>;
    expect(applied).toHaveLength(12);
    expect(applied[0]).toEqual({key: 'd01', text: "✓ Done · Grandma's birthday on Saturday"});
    expect(jsonBytes(view1.dataModel)).toBeLessThan(15 * 1024);
    expect(view1.dataModel['header']).toMatchObject({title: '**All done**'});
    expect((view1.dataModel['tabs'] as Record<string, string>)['reply']).toBe('Reply ✓');
    expect(validationErrors(createSurfaceMessages(view1))).toEqual([]);
    expect(doneItem(decisions[0]!).map(entry => entry.id)).toContain('d01_undo');
  });

  it('keeps email text in the data model only, and the data model small enough for model context', () => {
    const view1 = card();
    const props = JSON.stringify(view1.components);
    for (const decision of decisions) {
      expect(props).not.toContain(decision.subject);
      expect(props).not.toContain(decision.excerpt.slice(0, 30));
    }
    expect(jsonBytes(view1.dataModel)).toBeLessThan(14 * 1024);
    // Apply's checks nest at most 4 calls deep (or > not > regex > formatString).
    const depth = (value: unknown): number =>
      value && typeof value === 'object'
        ? Math.max(0, ...Object.values(value).map(depth)) + ('@call' in value ? 1 : 0)
        : 0;
    expect(Math.max(...allComponents(createSurfaceMessages(view1)).map(depth))).toBeLessThanOrEqual(
      5,
    );
  });

  it('uses only identifier-safe, unique component ids', () => {
    const ids = card().components.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
  });
});

describe('shared data model size', () => {
  it('stays at most 12 KiB with long drafts, and shrinks as decisions are applied', () => {
    const longDraft = `Hi there,\n\n${'A long and careful reply. '.repeat(13)}\n\nMaya`;
    expect(longDraft.length).toBeGreaterThan(340);
    const pending = card();
    const c = pending.dataModel['c'] as Record<string, Choice>;
    for (const choice of Object.values(c)) {
      if (choice.draft !== undefined) choice.draft = longDraft;
      if (choice.note !== undefined) choice.note = longDraft.slice(0, 200);
    }
    const reviewLines = decisions.map(d => ({
      text: `${d.options[0]!.label} · ${d.subject.slice(0, 44)} → ${d.consequence}`,
    }));
    const worstPending = {
      ...pending.dataModel,
      review: {
        title: 'x',
        summary: 'y'.repeat(300),
        lines: reviewLines,
        planKey: 'k'.repeat(16),
        confirmLabel: 'z',
      },
    };
    expect(jsonBytes(worstPending)).toBeLessThanOrEqual(12 * 1024);

    const states = new Map<string, ItemState>(
      decisions.map(decision => [
        decision.key,
        {status: 'done', result: '✓ Offered Tue 10:00 AM, Tue 2:00 PM and Wed 3:00 PM to Jordan'},
      ]),
    );
    const applied = card(decisions, states);
    for (const choice of Object.values(applied.dataModel['c'] as Record<string, Choice>)) {
      if (choice.draft !== undefined) choice.draft = longDraft;
    }
    expect(jsonBytes(applied.dataModel)).toBeLessThanOrEqual(12 * 1024);
    // Applied items keep only what their done row shows: no email excerpt.
    const d = applied.dataModel['d'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(d['d05']!)).toEqual(['title', 'from', 'result']);
  });
});

describe('decisionsSummary', () => {
  it('lists each decision with its pick, reason and other choices, and the left-out count', () => {
    const text = decisionsSummary(decisions, {source: 'gemini', leftOut: 15});
    expect(text).toMatch(/^The card shows 12 emails that need the person/);
    expect(text).toContain(
      '- [d05] "Invitation: Q1 planning offsite @ Fri Dec 4, 1pm - 5pm" from Priya Shah (coworker): my pick "Decline". Overlaps your dentist appointment; suggest Thursday.',
    );
    expect(text).toContain('Other choices: Accept, Maybe.');
    expect(text).toContain('Left out: 15 other inbox emails that need nothing');
    expect(text).toMatch(/untrusted/);
    expect(decisionsSummary([], {source: 'rules', leftOut: 3, focus: 'money'})).toMatch(
      /no email in Money needs the person/,
    );
  });
});
