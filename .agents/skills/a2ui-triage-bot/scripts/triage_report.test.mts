/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Tests for triage_report.mts. Run from the repository root with:
// node --test .agents/skills/a2ui-triage-bot/scripts/triage_report.test.mts

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  describe as describeActions,
  groupOf,
  itemActions,
  itemsQuery,
  parseDate,
  renderHtml,
  renderText,
  searchTime,
  SKILL_URL,
  type ItemActions,
  type Period,
  type RawEvent,
  type RawItem,
  type Report,
} from './triage_report.mts';

const LOGIN = 'triager';
const PERIOD: Period = {
  since: new Date('2026-11-04T00:00:00Z'),
  until: new Date('2026-11-10T23:59:59Z'),
};
const IN = '2026-11-05T10:00:00Z';
const BEFORE = '2026-11-03T10:00:00Z';

const event = (type: string, overrides: Partial<RawEvent> = {}): RawEvent => ({
  __typename: type,
  createdAt: IN,
  actor: {login: LOGIN},
  ...overrides,
});

const labeled = (name: string, overrides: Partial<RawEvent> = {}) =>
  event('LabeledEvent', {label: {name}, ...overrides});
const unlabeled = (name: string, overrides: Partial<RawEvent> = {}) =>
  event('UnlabeledEvent', {label: {name}, ...overrides});

const rawItem = (overrides: Partial<RawItem> = {}): RawItem => ({
  __typename: 'Issue',
  id: 'I_1',
  number: 1,
  title: 'Crash on empty Row',
  url: 'https://github.com/a2ui-project/a2ui/issues/1',
  state: 'OPEN',
  comments: {nodes: []},
  timelineItems: {nodes: []},
  ...overrides,
});

const withEvents = (...events: RawEvent[]): RawItem => rawItem({timelineItems: {nodes: events}});

const actions = (overrides: Partial<ItemActions> = {}): ItemActions => ({
  id: 'I_1',
  number: 1,
  url: 'https://github.com/a2ui-project/a2ui/issues/1',
  title: 'Crash on empty Row',
  isPullRequest: false,
  addedLabels: [],
  removedLabels: [],
  assigned: [],
  unassigned: [],
  closed: null,
  reopened: false,
  commented: false,
  ...overrides,
});

describe('parseDate', () => {
  it('reads a day as its start or its end in the local time zone', () => {
    assert.deepEqual(parseDate('2026-11-04', false), new Date(2026, 10, 4));
    assert.deepEqual(parseDate('2026-11-04', true), new Date(2026, 10, 4, 23, 59, 59, 999));
  });

  it('reads an ISO time', () => {
    assert.deepEqual(parseDate('2026-11-04T08:00:00Z', true), new Date('2026-11-04T08:00:00Z'));
  });

  it('rejects other text', () => {
    assert.throws(() => parseDate('last week', false), /Not a date: last week/);
  });
});

describe('itemActions', () => {
  it('returns null when the person did nothing', () => {
    assert.equal(itemActions(rawItem(), LOGIN, PERIOD), null);
  });

  it('collects net label and assignee changes', () => {
    const item = withEvents(
      labeled('P1'),
      labeled('type: bug'),
      unlabeled('type: bug'),
      unlabeled('status: first-line-handled'),
      event('AssignedEvent', {assignee: {login: 'octocat'}}),
      event('UnassignedEvent', {assignee: {login: 'old-owner'}}),
    );
    const result = itemActions(item, LOGIN, PERIOD);
    assert.deepEqual(result?.addedLabels, ['P1']);
    assert.deepEqual(result?.removedLabels, ['status: first-line-handled']);
    assert.deepEqual(result?.assigned, ['octocat']);
    assert.deepEqual(result?.unassigned, ['old-owner']);
  });

  it('ignores events by other people, events outside the period, and status: needs-triage', () => {
    const item = withEvents(
      labeled('P1', {actor: {login: 'someone-else'}}),
      labeled('P2', {createdAt: BEFORE}),
      unlabeled('status: needs-triage'),
      event('ClosedEvent', {actor: null}),
    );
    assert.equal(itemActions(item, LOGIN, PERIOD), null);
  });

  it('reports the close reason and the duplicate', () => {
    const item = withEvents(
      event('ClosedEvent', {stateReason: 'DUPLICATE', closer: null, duplicateOf: {number: 7}}),
    );
    assert.deepEqual(itemActions(item, LOGIN, PERIOD)?.closed, {reason: 'DUPLICATE', duplicateOf: 7});
  });

  it('ignores closes by a commit or a PR, and the close of a merged PR', () => {
    const closedByPr = withEvents(
      event('ClosedEvent', {stateReason: 'COMPLETED', closer: {__typename: 'PullRequest'}}),
    );
    assert.equal(itemActions(closedByPr, LOGIN, PERIOD), null);
    const merged = rawItem({
      __typename: 'PullRequest',
      state: 'MERGED',
      timelineItems: {nodes: [event('ClosedEvent', {closer: null})]},
    });
    assert.equal(itemActions(merged, LOGIN, PERIOD), null);
  });

  it('keeps the last of a close and a reopen', () => {
    const reopened = itemActions(
      withEvents(event('ClosedEvent', {closer: null}), event('ReopenedEvent', {createdAt: '2026-11-06T00:00:00Z'})),
      LOGIN,
      PERIOD,
    );
    assert.equal(reopened?.closed, null);
    assert.equal(reopened?.reopened, true);
  });

  it('counts comments in the period, except triage bot comments', () => {
    const comment = (body: string, createdAt = IN) => ({author: {login: LOGIN}, body, createdAt});
    const triaged = (comments: RawItem['comments']['nodes']) =>
      itemActions(rawItem({comments: {nodes: comments}, timelineItems: {nodes: [labeled('P2')]}}), LOGIN, PERIOD);
    assert.equal(triaged([comment('Thanks for the report.')])?.commented, true);
    assert.equal(triaged([comment('Thanks.', BEFORE)])?.commented, false);
    for (const heading of ['Suggestion from triage bot', 'Response from triage bot', 'From triage bot']) {
      assert.equal(triaged([comment(`**${heading}:**\n\nText`)])?.commented, false, heading);
    }
  });

  it('counts an item with comments only', () => {
    const item = rawItem({comments: {nodes: [{author: {login: LOGIN}, body: 'LGTM', createdAt: IN}]}});
    assert.equal(itemActions(item, LOGIN, PERIOD)?.commented, true);
  });

  it('does not count an item with triage bot comments only', () => {
    const body = '**Suggestion from triage bot:**\n\nText';
    const item = rawItem({comments: {nodes: [{author: {login: LOGIN}, body, createdAt: IN}]}});
    assert.equal(itemActions(item, LOGIN, PERIOD), null);
  });
});

describe('groupOf', () => {
  it('puts closed items first, then by the label added', () => {
    assert.equal(groupOf(actions({closed: {reason: null, duplicateOf: null}, addedLabels: ['P1']})), 'Closed');
    assert.equal(groupOf(actions({addedLabels: ['status: assigned-for-triage', 'P3']})), 'Assigned P3');
    assert.equal(groupOf(actions({addedLabels: ['status: assigned-for-triage']})), 'Assigned for triage');
    assert.equal(groupOf(actions({addedLabels: ['status: needs-team-input']})), 'Needs team input');
    assert.equal(groupOf(actions({unassigned: ['octocat']})), 'Updated');
    assert.equal(groupOf(actions({reopened: true})), 'Updated');
    assert.equal(groupOf(actions({commented: true})), 'Commented');
  });
});

describe('describe', () => {
  it('says what the person did, in order', () => {
    assert.equal(
      describeActions(
        actions({
          closed: {reason: 'NOT_PLANNED', duplicateOf: null},
          addedLabels: ['P3'],
          removedLabels: ['P2'],
          assigned: ['a'],
          unassigned: ['b'],
          commented: true,
        }),
      ),
      'closed as not planned, added P3, removed P2, assigned a, unassigned b, commented',
    );
  });

  it('names the duplicate, and gives no reason for a PR', () => {
    assert.equal(describeActions(actions({closed: {reason: 'DUPLICATE', duplicateOf: 7}})), 'closed as duplicate of #7');
    assert.equal(
      describeActions(actions({isPullRequest: true, closed: {reason: 'COMPLETED', duplicateOf: null}})),
      'closed',
    );
  });
});

const REPORT: Report = {
  login: LOGIN,
  period: {since: new Date(2026, 10, 4), until: new Date(2026, 10, 10, 23, 59, 59)},
  stillNeedTriage: 4,
  items: [
    actions({
      id: 'PR_65',
      number: 4065,
      url: 'https://github.com/a2ui-project/a2ui/pull/4065',
      title: 'Add a Slider to the Lit renderer',
      isPullRequest: true,
      closed: {reason: null, duplicateOf: null},
      commented: true,
    }),
    actions({
      number: 4080,
      url: 'https://github.com/a2ui-project/a2ui/issues/4080',
      title: 'Fix typo in the quickstart',
      addedLabels: ['P3'],
    }),
    actions({
      number: 4082,
      url: 'https://github.com/a2ui-project/a2ui/issues/4082',
      title: 'Stream <partial> updates',
      addedLabels: ['status: needs-team-input'],
      commented: true,
    }),
    actions({
      number: 4090,
      url: 'https://github.com/a2ui-project/a2ui/issues/4090',
      title: 'Document the Express format',
      commented: true,
    }),
  ],
};

describe('renderText', () => {
  it('renders the summary, the groups and the footer', () => {
    assert.equal(
      renderText(REPORT),
      `Triage report for triager, 2026-11-04 to 2026-11-10

Triaged 4 items: 3 issues and 1 PR.
Sent 1 issue to the team.
4 items still need triage.

- Closed: 1 PR
  - https://github.com/a2ui-project/a2ui/pull/4065
    Add a Slider to the Lit renderer: closed, commented

- Assigned P3: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4080
    Fix typo in the quickstart: added P3

- Needs team input: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4082
    Stream <partial> updates: added status: needs-team-input, commented

- Commented: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4090
    Document the Express format: commented

Created by triage bot skill (${SKILL_URL})
`,
    );
  });

  it('renders a period without triage', () => {
    assert.equal(
      renderText({...REPORT, items: [], stillNeedTriage: 1}),
      `Triage report for triager, 2026-11-04 to 2026-11-10

Triaged no items.
1 item still needs triage.

Created by triage bot skill (${SKILL_URL})
`,
    );
  });
});

describe('renderHtml', () => {
  it('links the items and the skill, and escapes the text', () => {
    const html = renderHtml(REPORT);
    assert.match(
      html,
      /<a href="https:\/\/github.com\/a2ui-project\/a2ui\/issues\/4082">https:\/\/github.com\/a2ui-project\/a2ui\/issues\/4082<\/a><br>Stream &lt;partial&gt; updates/,
    );
    assert.ok(html.includes(`<p>Created by <a href="${SKILL_URL}">triage bot</a> skill</p>`));
  });
});

describe('itemsQuery', () => {
  it('reads each item under its own alias', () => {
    const query = itemsQuery([12, 345]);
    assert.match(query, /i12: issueOrPullRequest\(number: 12\) \{ \.\.\.item \}/);
    assert.match(query, /i345: issueOrPullRequest\(number: 345\) \{ \.\.\.item \}/);
    assert.match(query, /fragment item on IssueOrPullRequest/);
  });
});

describe('searchTime', () => {
  it('drops the milliseconds', () => {
    assert.equal(searchTime(new Date('2026-11-04T08:00:00.123Z')), '2026-11-04T08:00:00Z');
  });
});
