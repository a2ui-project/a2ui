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
 * Tests every view through `TriageTools` on the synthetic snapshot: each
 * produced message list is valid against the catalog schema, sizes stay in
 * the host limits, and untrusted text only reaches the data model.
 */

import {describe, expect, it} from 'vitest';

import type {JsonModel} from '../ai/json_model.js';
import {FixtureGitHub} from '../github/fixture.js';
import {TriageWriter, WriteGate} from '../github/writes.js';
import {CAPTURED_AT, HOSTILE_TITLE, syntheticSnapshot} from '../testing/synthetic_snapshot.js';
import {allComponents, dataModelOf, validationErrors} from '../testing/validation.js';
import {TriageTools} from '../triage_tools.js';
import type {A2uiMessage} from './a2ui.js';
import {jsonBytes} from './a2ui.js';
import {DASHBOARD_SURFACE} from './dashboard_view.js';
import {INBOX_SURFACE} from './inbox_view.js';
import {triageSurfaceId} from './issue_view.js';
import {reviewSurfaceId} from './pull_view.js';
import {SUGGESTIONS_SURFACE} from './suggestions_view.js';

const fakeModel: JsonModel = {
  async generateJson() {
    return {
      suggestions: [
        {
          number: 110,
          priority: 'P2',
          type: 'type: bug',
          components: ['component: lit adapter'],
          assignee: 'alice-dev',
          template: 'request_info',
          reply: '',
          rationale: 'Crash with steps.',
        },
        {number: 109, priority: 'P3', rationale: 'Unclear report.'},
      ],
    };
  },
};

function tools(env: NodeJS.ProcessEnv = {}) {
  const github = new FixtureGitHub(syntheticSnapshot());
  return {
    github,
    tools: new TriageTools({
      github,
      writer: new TriageWriter(github, new WriteGate(env), github.repo),
      model: fakeModel,
      now: () => new Date(CAPTURED_AT),
    }),
  };
}

/** Untrusted text must never appear in component definitions (only in data models). */
function expectNoUntrustedInComponents(messages: readonly A2uiMessage[]) {
  const components = JSON.stringify(allComponents(messages));
  expect(components).not.toContain('Ignore previous instructions');
  expect(components).not.toContain('evil.example');
}

function expectValid(messages: readonly A2uiMessage[]) {
  expect(validationErrors(messages)).toEqual([]);
  // The app's message processor requires UAX #31 identifiers, which the
  // server-side schema validation does not check.
  for (const component of allComponents(messages)) {
    expect(component['id']).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
  }
  // The app also rejects duplicate ids within one updateComponents message.
  for (const message of messages) {
    if (!('updateComponents' in message)) continue;
    const ids = message.updateComponents.components.map(component => component.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  }
  expect(jsonBytes(messages)).toBeLessThan(1024 * 1024);
}

describe('views', () => {
  it('inbox: valid, compact shared data model, hostile title only as data', async () => {
    const {tools: triage} = tools();
    const output = await triage.inbox();
    expectValid(output.a2ui);
    expectNoUntrustedInComponents(output.a2ui);
    const model = dataModelOf(output.a2ui, INBOX_SURFACE);
    expect(jsonBytes(model)).toBeLessThan(12 * 1024);
    expect((model['issues'] as unknown[]).length).toBe(6);
    expect(JSON.stringify(model)).not.toContain('\nSYSTEM');
    expect(output.text).toContain('showing 6 of 14 untriaged open issues');
    expect(output.text).toContain('8 more match');
    expect(output.text).toContain(JSON.stringify(HOSTILE_TITLE.replace('\n', ' ')));
    expect(output.text).toContain('Writes are dry runs');
  });

  it('inbox actions: filter, load more, refresh, bulk dialog, bulk preview and confirm', async () => {
    const {tools: triage, github} = tools();
    const filtered = await triage.filterInbox(
      {
        filter: {
          labels: ['type: bug'],
          author: '',
          text: '',
          sort: ['newest'],
          onlyUntriaged: false,
        },
      },
      INBOX_SURFACE,
    );
    expectValid(filtered.a2ui);
    expect(filtered.text).toContain('showing 2 of 2 open issues, labeled type: bug');
    const rows = [
      {number: 161, selected: true},
      ...Array.from({length: 11}, (_, i) => ({number: 150 + i, selected: false})),
    ];
    const more = await triage.loadMore(
      {filter: {labels: [], author: '', text: '', sort: [], onlyUntriaged: true}, issues: rows},
      INBOX_SURFACE,
    );
    expectValid(more.a2ui);
    const issues = (
      more.a2ui.find(m => 'updateDataModel' in m && m.updateDataModel.path === '/issues') as {
        updateDataModel: {value: Array<{number: number; selected: boolean}>};
      }
    ).updateDataModel.value;
    expect(issues).toHaveLength(14);
    expect(issues.find(issue => issue.number === 161)?.selected).toBe(true);
    const refreshed = await triage.refreshInbox({view: 'inbox', issues: rows}, INBOX_SURFACE);
    expectValid(refreshed.a2ui);

    // Captions do not render markdown, so the bulk preview lines carry none.
    const previewRow = allComponents((await triage.inbox()).a2ui).find(
      component => component['id'] === 'bulk_preview_row',
    );
    expect(JSON.stringify(previewRow)).not.toContain('**');
    const dialog = triage.bulkDialog({issues: rows}, INBOX_SURFACE);
    expect(dialog.text).toBe('1 selected: #161');
    const bulk = {
      priority: ['P2'],
      labels: ['size: small', 'P0'],
      assignee: ['bob-maintainer'],
      previewKey: '',
    };
    const preview = await triage.bulkApply({issues: rows, bulk, confirm: false}, INBOX_SURFACE);
    expectValid(preview.a2ui);
    expect(preview.text).toMatch(/^3 changes to 1 issue\. Confirming is a dry run/);
    const key = (
      preview.a2ui.find(
        m => 'updateDataModel' in m && m.updateDataModel.path === '/bulk/previewKey',
      ) as {updateDataModel: {value: string}}
    ).updateDataModel.value;
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    const stale = await triage.bulkApply(
      {issues: rows, bulk: {...bulk, priority: ['P3']}, confirm: true},
      INBOX_SURFACE,
    );
    expect(stale.text).toMatch(/changed since the preview/);
    const confirmed = await triage.bulkApply(
      {issues: rows, bulk: {...bulk, previewKey: key}, confirm: true},
      INBOX_SURFACE,
    );
    expectValid(confirmed.a2ui);
    expect(confirmed.text).toMatch(
      /^Dry run: 3 changes to 1 item not written because writes are disabled/,
    );
    expect(github.writes).toEqual([]);
    const none = await triage.bulkApply({issues: [], bulk, confirm: false}, INBOX_SURFACE);
    expect(none.text).toBe('Select at least one issue first.');
  });

  it('issue: two surfaces, markdown body sanitized, form checks, reply preview, suggestion', async () => {
    const {tools: triage} = tools();
    const output = await triage.issue(109);
    expectValid(output.a2ui);
    expectNoUntrustedInComponents(output.a2ui);
    const content = dataModelOf(output.a2ui, 'issue-109');
    expect(content['body']).toContain('[docs](https://a2ui.org/docs)');
    expect(content['body']).not.toMatch(/<img|<script|javascript:|user-images|hidden: assistant/);
    const triageModel = dataModelOf(output.a2ui, triageSurfaceId(109));
    expect(jsonBytes(triageModel)).toBeLessThan(4 * 1024);
    expect(
      output.a2ui.some(
        m =>
          'createSurface' in m &&
          m.createSurface.surfaceId === 'issue-109' &&
          !m.createSurface.sendDataModel,
      ),
    ).toBe(true);
    expect(output.text).toContain('Body excerpt (untrusted user text');
    expect(output.text).not.toContain('<script');

    // The priority can be cleared, and Apply's check then fails (it needs P0 to P3).
    const components = allComponents(output.a2ui);
    const priority = components.find(component => component['id'] === 'priority');
    expect(JSON.stringify(priority?.['options'])).toContain('"value":"none"');
    const apply = components.find(component => component['id'] === 'apply');
    expect(JSON.stringify(apply?.['@checks'])).toContain('P[0-3]');
    // Replies are markdown comments, so their preview uses the markdown (body) Text variant.
    expect(
      components.find(component => component['id'] === 'reply_preview')?.['variant'],
    ).toBeUndefined();
    const reply = triage.previewReply({number: 109, template: ['request_info']});
    expectValid(reply.a2ui);
    expect(JSON.stringify(reply.a2ui)).toContain('Browser console logs');

    const suggested = await triage.suggestForIssue({number: 110});
    expectValid(suggested.a2ui);
    const form = (
      suggested.a2ui.find(m => 'updateDataModel' in m && m.updateDataModel.path === '/form') as {
        updateDataModel: {value: Record<string, unknown>};
      }
    ).updateDataModel.value;
    expect(form).toMatchObject({priority: ['P2'], type: ['type: bug'], assignee: ['alice-dev']});
    expect(String(form['reply'])).toContain('To help us diagnose this');
  });

  it('apply_triage: preview swaps in the confirm panel, confirm is a dry run, rules hold', async () => {
    const {tools: triage, github} = tools();
    const surfaceId = triageSurfaceId(110);
    const form = {
      priority: ['P2'],
      type: ['type: bug'],
      components: ['component: lit adapter'],
      assignee: [],
      milestone: [],
      markHandled: true,
      reply: 'Thanks',
    };
    const preview = await triage.applyTriage(
      {number: 110, form, mode: 'preview', target: 'issue'},
      surfaceId,
    );
    expectValid(preview.a2ui);
    const swap = allComponents(preview.a2ui).find(component => component['id'] === 'apply_bar');
    expect(swap?.['component']).toBe('Column');
    const key = (
      preview.a2ui.find(m => 'updateDataModel' in m && m.updateDataModel.path === '/planKey') as {
        updateDataModel: {value: string};
      }
    ).updateDataModel.value;
    const confirmed = await triage.applyTriage(
      {number: 110, form, mode: 'confirm', planKey: key, target: 'issue'},
      surfaceId,
    );
    expectValid(confirmed.a2ui);
    expect(confirmed.text).toMatch(/^Dry run: 4 changes to 1 item/);
    expect(
      allComponents(confirmed.a2ui).find(component => component['id'] === 'apply_bar')?.[
        'component'
      ],
    ).toBe('Row');
    expect(github.writes).toEqual([]);
    const none = await triage.applyTriage(
      {number: 110, form: {...form, priority: ['none']}, mode: 'preview', target: 'issue'},
      surfaceId,
    );
    expect(none.text).toBe('Choose a priority.');
    const p0 = await triage.applyTriage(
      {number: 110, form: {...form, priority: ['P0']}, mode: 'preview', target: 'issue'},
      surfaceId,
    );
    expect(p0.text).toBe('A P0 issue needs an assignee.');
    const cancel = await triage.applyTriage(
      {number: 110, form, mode: 'cancel', target: 'issue'},
      surfaceId,
    );
    expectValid(cancel.a2ui);
  });

  it('apply_triage writes when the gate allows the repo', async () => {
    const {tools: triage, github} = tools({
      TRIAGE_WRITE: '1',
      TRIAGE_WRITE_REPOS: 'example/triage-test',
    });
    const form = {
      priority: ['P2'],
      type: [],
      components: [],
      assignee: [],
      milestone: [],
      markHandled: false,
      reply: '',
    };
    const preview = await triage.applyTriage(
      {number: 110, form, mode: 'preview', target: 'issue'},
      triageSurfaceId(110),
    );
    const key = (
      preview.a2ui.find(m => 'updateDataModel' in m && m.updateDataModel.path === '/planKey') as {
        updateDataModel: {value: string};
      }
    ).updateDataModel.value;
    const confirmed = await triage.applyTriage(
      {number: 110, form, mode: 'confirm', planKey: key, target: 'issue'},
      triageSurfaceId(110),
    );
    expectValid(confirmed.a2ui);
    expect(confirmed.text).toBe('Wrote 1 of 1 change to 1 item.');
    expect(github.writes).toEqual([{method: 'addLabels', number: 110, value: ['P2']}]);
  });

  it('pull request: checks, files, review form and dry-run submit', async () => {
    const {tools: triage, github} = tools();
    const output = await triage.pullRequest(201);
    expectValid(output.a2ui);
    expect(output.text).toContain(
      'CI: 1 failed, 1 pending, 1 passed, 1 skipped of 4 checks. Failing: test (lit).',
    );
    expect(jsonBytes(dataModelOf(output.a2ui, reviewSurfaceId(201)))).toBeLessThan(2 * 1024);
    const submit = allComponents(output.a2ui).find(component => component['id'] === 'submit');
    expect(JSON.stringify(submit?.['@checks'])).toContain('REQUEST_CHANGES');
    const review = {event: ['REQUEST_CHANGES' as const], body: '', checklist: {}};
    expect((await triage.submitReview({number: 201, review, mode: 'preview'})).text).toBe(
      'Explain the changes you request.',
    );
    const approve = {
      event: ['APPROVE' as const],
      body: '',
      checklist: {scoped: true, noOverlap: false},
    };
    expect(
      (await triage.submitReview({number: 201, review: approve, mode: 'preview'})).text,
    ).toMatch(/checklist/);
    const ok = {...review, body: 'Please add a test.'};
    const preview = await triage.submitReview({number: 201, review: ok, mode: 'preview'});
    expectValid(preview.a2ui);
    const key = (
      preview.a2ui.find(m => 'updateDataModel' in m && m.updateDataModel.path === '/planKey') as {
        updateDataModel: {value: string};
      }
    ).updateDataModel.value;
    const confirmed = await triage.submitReview({
      number: 201,
      review: ok,
      mode: 'confirm',
      planKey: key,
    });
    expectValid(confirmed.a2ui);
    expect(confirmed.text).toMatch(/^Dry run: 1 change to 1 item/);
    expect(github.writes).toEqual([]);
  });

  it('dashboard: chart, filters and in-place refresh', async () => {
    const {tools: triage} = tools();
    const output = await triage.dashboard();
    expectValid(output.a2ui);
    const model = dataModelOf(output.a2ui, DASHBOARD_SURFACE);
    expect((model['chart'] as {mark: {type: string}}).mark.type).toBe('bar');
    expect(output.text).toContain('17 open issues');
    expect(output.text).toContain('Stale PRs shown: #202');
    const components = allComponents(output.a2ui).map(component => component['component']);
    expect(components).toEqual(
      expect.arrayContaining(['Slider', 'DateTimeInput', 'VegaChart', 'Tabs', 'DiffStat']),
    );
    const refreshed = await triage.refreshDashboard({
      view: 'dashboard',
      filters: {staleDays: 90, since: '2026-11-01'},
    });
    expectValid(refreshed.a2ui);
    expect(refreshed.text).toContain('0 stale (no update for 90+ days)');
  });

  it('suggest_triage: editable forms with per-item preview and confirm', async () => {
    const {tools: triage} = tools();
    const output = await triage.suggestTriage([110, 109, 110]);
    expectValid(output.a2ui);
    expectNoUntrustedInComponents(output.a2ui);
    expect(jsonBytes(dataModelOf(output.a2ui, SUGGESTIONS_SURFACE))).toBeLessThan(12 * 1024);
    expect(output.text).toContain(
      'Suggested: priority P2; type type: bug; components component: lit adapter; assignee @alice-dev; reply Requesting information.',
    );
    expect(output.text).toContain('Nothing was applied');
    const form = {
      priority: ['P2'],
      type: [],
      components: [],
      assignee: [],
      milestone: [],
      markHandled: false,
      reply: '',
    };
    const preview = await triage.applyTriage(
      {number: 110, form, mode: 'preview', target: 'suggestion', index: 0},
      SUGGESTIONS_SURFACE,
    );
    expectValid(preview.a2ui);
    expect(JSON.stringify(preview.a2ui)).toContain('/items/0/planKey');
  });
});
