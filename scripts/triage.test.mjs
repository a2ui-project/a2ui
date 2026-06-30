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

// Tests for scripts/triage.mjs. Run with `node --test scripts/`.

import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it, mock} from 'node:test';

import issueTriage, {flagReason, isBot, lastHumanContribution} from './triage.mjs';

const NOW = new Date('2026-06-30T00:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = n => new Date(NOW - n * DAY).toISOString();

// Minimal factories matching the shape the script reads from the GitHub API.
const issue = (overrides = {}) => ({
  number: 1,
  pull_request: undefined,
  labels: [],
  assignees: [],
  created_at: daysAgo(0),
  author_association: 'MEMBER',
  user: {login: 'maintainer', type: 'User'},
  comments: 0,
  ...overrides,
});

const pr = (overrides = {}) => issue({pull_request: {url: 'x'}, ...overrides});

const comment = (overrides = {}) => ({
  created_at: daysAgo(0),
  author_association: 'MEMBER',
  user: {login: 'maintainer', type: 'User'},
  ...overrides,
});

describe('isBot', () => {
  it('detects bots by account type and login suffix', () => {
    assert.equal(isBot({type: 'Bot', login: 'whatever'}), true);
    assert.equal(isBot({type: 'User', login: 'github-actions[bot]'}), true);
  });

  it('treats real users and missing users conservatively', () => {
    assert.equal(isBot({type: 'User', login: 'alice'}), false);
    assert.equal(isBot(null), true);
  });
});

describe('lastHumanContribution', () => {
  it('falls back to the opening post when there are no comments', () => {
    const item = issue({created_at: daysAgo(5), author_association: 'NONE'});
    const latest = lastHumanContribution(item, []);
    assert.equal(latest.createdAt, item.created_at);
    assert.equal(latest.association, 'NONE');
  });

  it('returns the newest non-bot comment', () => {
    const item = issue({created_at: daysAgo(10)});
    const comments = [
      comment({created_at: daysAgo(8), user: {login: 'a', type: 'User'}}),
      comment({created_at: daysAgo(2), user: {login: 'b', type: 'User'}}),
    ];
    assert.equal(lastHumanContribution(item, comments).createdAt, daysAgo(2));
  });

  it('ignores bot comments so they do not reset the clock', () => {
    const item = issue({created_at: daysAgo(10)});
    const comments = [
      comment({created_at: daysAgo(7), user: {login: 'human', type: 'User'}}),
      comment({created_at: daysAgo(1), user: {type: 'Bot', login: 'bot[bot]'}}),
    ];
    assert.equal(lastHumanContribution(item, comments).createdAt, daysAgo(7));
  });
});

describe('flagReason — issues', () => {
  it('flags an issue with no priority label', () => {
    assert.match(flagReason(issue(), [], NOW), /no priority label/);
  });

  it('does not flag issues parked on the user response', () => {
    const item = issue({labels: ['triage: waiting-for-user-response']});
    assert.equal(flagReason(item, [], NOW), null);
  });

  it('flags P0/P1 issues with no assignee', () => {
    assert.match(flagReason(issue({labels: ['P0']}), [], NOW), /no assignee/);
    assert.match(flagReason(issue({labels: ['P1']}), [], NOW), /no assignee/);
  });

  it('does not flag an assigned, fresh P0', () => {
    const item = issue({
      labels: ['P0'],
      assignees: [{login: 'dev'}],
      created_at: daysAgo(0),
    });
    assert.equal(flagReason(item, [], NOW), null);
  });

  it('flags a P0 stale beyond 1 day', () => {
    const item = issue({
      labels: ['P0'],
      assignees: [{login: 'dev'}],
      created_at: daysAgo(2),
    });
    assert.match(flagReason(item, [], NOW), /no human activity/);
  });

  it('flags a P1 stale beyond 30 days but not a fresher one', () => {
    const base = {labels: ['P1'], assignees: [{login: 'dev'}]};
    assert.match(
      flagReason(issue({...base, created_at: daysAgo(31)}), [], NOW),
      /no human activity/,
    );
    assert.equal(flagReason(issue({...base, created_at: daysAgo(10)}), [], NOW), null);
  });

  it('flags a P2 only after 90 days', () => {
    assert.match(
      flagReason(issue({labels: ['P2'], created_at: daysAgo(91)}), [], NOW),
      /no human activity/,
    );
    assert.equal(flagReason(issue({labels: ['P2'], created_at: daysAgo(45)}), [], NOW), null);
  });

  it('does not flag a prioritized P3/P4 issue', () => {
    assert.equal(flagReason(issue({labels: ['P3']}), [], NOW), null);
    assert.equal(flagReason(issue({labels: ['P4']}), [], NOW), null);
  });

  it('handles a missing assignees field without throwing', () => {
    const item = issue({labels: ['P0'], assignees: undefined});
    assert.match(flagReason(item, [], NOW), /no assignee/);
  });
});

describe('flagReason — PRs', () => {
  it('flags a PR stale beyond 1 day', () => {
    const item = pr({created_at: daysAgo(2)});
    assert.match(flagReason(item, [], NOW), /no human activity/);
  });

  it('does not flag a fresh PR', () => {
    assert.equal(flagReason(pr({created_at: daysAgo(0)}), [], NOW), null);
  });
});

describe('flagReason — external comment awaiting response', () => {
  it('flags when the latest reply is an unanswered external comment', () => {
    const item = issue({labels: ['P3'], comments: 1, created_at: daysAgo(5)});
    const comments = [
      comment({
        created_at: daysAgo(2),
        author_association: 'NONE',
        user: {login: 'reporter', type: 'User'},
      }),
    ];
    assert.match(flagReason(item, comments, NOW), /external contributor/);
  });

  it('does not flag when a maintainer replied last', () => {
    const item = issue({labels: ['P3'], comments: 2, created_at: daysAgo(5)});
    const comments = [
      comment({
        created_at: daysAgo(3),
        author_association: 'NONE',
        user: {login: 'reporter', type: 'User'},
      }),
      comment({
        created_at: daysAgo(2),
        author_association: 'MEMBER',
        user: {login: 'maintainer', type: 'User'},
      }),
    ];
    assert.equal(flagReason(item, comments, NOW), null);
  });

  it('does not flag a fresh external comment (< 1 day)', () => {
    const item = issue({labels: ['P3'], comments: 1, created_at: daysAgo(5)});
    const comments = [
      comment({
        created_at: daysAgo(0),
        author_association: 'NONE',
        user: {login: 'reporter', type: 'User'},
      }),
    ];
    assert.equal(flagReason(item, comments, NOW), null);
  });
});

describe('issueTriage reconciliation', () => {
  let github;
  let calls;

  const makeGithub = openItems => {
    calls = {addLabels: [], removeLabel: [], createComment: [], listComments: []};
    const rest = {
      issues: {
        listForRepo: 'listForRepo',
        listComments: mock.fn(async params => {
          calls.listComments.push(params.issue_number);
          const item = openItems.find(i => i.number === params.issue_number);
          return {data: item.__comments ?? []};
        }),
        addLabels: mock.fn(async params => calls.addLabels.push(params.issue_number)),
        removeLabel: mock.fn(async params => calls.removeLabel.push(params.issue_number)),
        createComment: mock.fn(async params =>
          calls.createComment.push({number: params.issue_number, body: params.body}),
        ),
      },
    };
    return {
      rest,
      paginate: mock.fn(async () => openItems),
    };
  };

  const context = {repo: {owner: 'a2ui-project', repo: 'a2ui'}};

  beforeEach(() => {
    mock.method(console, 'log', () => {});
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('adds the label with an explanatory comment when a rule matches', async () => {
    github = makeGithub([issue({number: 7})]);
    await issueTriage({github, context});

    assert.deepEqual(calls.addLabels, [7]);
    assert.equal(calls.removeLabel.length, 0);
    assert.equal(calls.createComment.length, 1);
    assert.equal(calls.createComment[0].number, 7);
    assert.match(calls.createComment[0].body, /Adding the `triage: flag` label/);
  });

  it('removes a stale label with an explanatory comment', async () => {
    const item = issue({
      number: 8,
      labels: ['P3', 'triage: flag'],
      assignees: [{login: 'dev'}],
    });
    github = makeGithub([item]);
    await issueTriage({github, context});

    assert.deepEqual(calls.removeLabel, [8]);
    assert.equal(calls.addLabels.length, 0);
    assert.match(calls.createComment[0].body, /Removing the `triage: flag` label/);
  });

  it('is a no-op when the desired and actual state already agree', async () => {
    const flagged = issue({number: 9, labels: ['triage: flag']}); // matches rule 1a
    const clean = issue({number: 10, labels: ['P3']}); // matches no rule
    github = makeGithub([flagged, clean]);
    await issueTriage({github, context});

    assert.equal(calls.addLabels.length, 0);
    assert.equal(calls.removeLabel.length, 0);
    assert.equal(calls.createComment.length, 0);
  });

  it('skips the comments API call for items with zero comments', async () => {
    github = makeGithub([issue({number: 11, comments: 0})]);
    await issueTriage({github, context});
    assert.equal(calls.listComments.length, 0);
  });

  it('fetches comments only for items that have them', async () => {
    const withComments = issue({number: 12, comments: 1});
    withComments.__comments = [
      comment({
        created_at: daysAgo(2),
        author_association: 'NONE',
        user: {login: 'reporter', type: 'User'},
      }),
    ];
    github = makeGithub([withComments, issue({number: 13, comments: 0})]);
    await issueTriage({github, context});
    assert.deepEqual(calls.listComments, [12]);
  });
});
