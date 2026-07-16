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

import issueTriage, {
  ASSIGNEE_REQUIRED_PRIORITIES,
  FLAG_LABEL,
  flagReason,
  isBot,
  lastHumanContribution,
  PRIORITY_LABELS,
  STALE_DAYS,
  WAITING_LABEL,
} from './triage.mjs';

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

// PRs default to an external contributor, the case the automation watches.
const pr = (overrides = {}) =>
  issue({
    pull_request: {url: 'x'},
    author_association: 'CONTRIBUTOR',
    user: {login: 'contributor', type: 'User'},
    ...overrides,
  });

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
    const item = issue({labels: [WAITING_LABEL]});
    assert.equal(flagReason(item, [], NOW), null);
  });

  // Drive the assignee rule off ASSIGNEE_REQUIRED_PRIORITIES rather than
  // hardcoding P0/P1, so the test tracks the config constant.
  it('flags every assignee-required priority with no assignee', () => {
    for (const priority of ASSIGNEE_REQUIRED_PRIORITIES) {
      assert.match(flagReason(issue({labels: [priority]}), [], NOW), /no assignee/, priority);
    }
  });

  it('handles a missing assignees field without throwing', () => {
    const [priority] = ASSIGNEE_REQUIRED_PRIORITIES;
    const item = issue({labels: [priority], assignees: undefined});
    assert.match(flagReason(item, [], NOW), /no assignee/);
  });

  // Drive the staleness rule off STALE_DAYS so the thresholds live in one place.
  // An assignee is attached so the assignee rule can never mask the staleness one.
  for (const [priority, threshold] of Object.entries(STALE_DAYS)) {
    const base = {labels: [priority], assignees: [{login: 'dev'}]};

    it(`does not flag a fresh ${priority} (within ${threshold} day(s))`, () => {
      const item = issue({...base, created_at: daysAgo(threshold)});
      assert.equal(flagReason(item, [], NOW), null);
    });

    it(`flags a ${priority} stale beyond ${threshold} day(s)`, () => {
      const item = issue({...base, created_at: daysAgo(threshold + 1)});
      assert.match(flagReason(item, [], NOW), /no human activity/);
    });
  }
});

// PRIORITY_LABELS is the single source of truth for which labels count as a
// priority. These tests pin that contract so a rename or reorder can't silently
// break triage.
describe('flagReason — PRIORITY_LABELS contract', () => {
  it('treats every PRIORITY_LABELS entry as a real priority (never "no priority")', () => {
    for (const priority of PRIORITY_LABELS) {
      // Assigned and fresh, so the only rule that could fire is 1a.
      const item = issue({labels: [priority], assignees: [{login: 'dev'}]});
      const reason = flagReason(item, [], NOW);
      if (reason !== null) {
        assert.doesNotMatch(reason, /no priority label/, priority);
      }
    }
  });

  it('flags an issue whose label is not in PRIORITY_LABELS as unprioritized', () => {
    const notAPriority = 'area: rendering';
    assert.ok(!PRIORITY_LABELS.includes(notAPriority));
    assert.match(flagReason(issue({labels: [notAPriority]}), [], NOW), /no priority label/);
  });

  it('never flags a priority that has no staleness threshold (when assigned)', () => {
    const unThresholded = PRIORITY_LABELS.filter(p => STALE_DAYS[p] === undefined);
    assert.ok(unThresholded.length > 0, 'expected at least one priority without a threshold');
    for (const priority of unThresholded) {
      const item = issue({
        labels: [priority],
        assignees: [{login: 'dev'}],
        created_at: daysAgo(9999),
      });
      assert.equal(flagReason(item, [], NOW), null, priority);
    }
  });

  it('keeps config constants consistent with PRIORITY_LABELS', () => {
    for (const priority of Object.keys(STALE_DAYS)) {
      assert.ok(PRIORITY_LABELS.includes(priority), `STALE_DAYS key ${priority} not a priority`);
    }
    for (const priority of ASSIGNEE_REQUIRED_PRIORITIES) {
      assert.ok(
        PRIORITY_LABELS.includes(priority),
        `ASSIGNEE_REQUIRED_PRIORITIES entry ${priority} not a priority`,
      );
    }
  });
});

describe('flagReason — PRs', () => {
  // An external author's comment 2 days ago, with no maintainer reply since.
  const externalComment = age =>
    comment({
      created_at: daysAgo(age),
      author_association: 'CONTRIBUTOR',
      user: {login: 'contributor', type: 'User'},
    });
  const memberComment = age =>
    comment({
      created_at: daysAgo(age),
      author_association: 'MEMBER',
      user: {login: 'maintainer', type: 'User'},
    });

  it('flags a stale external PR with no maintainer response', () => {
    const item = pr({created_at: daysAgo(5), comments: 1});
    assert.match(flagReason(item, [externalComment(2)], NOW), /no maintainer/);
  });

  it('flags a fresh external PR that has never been answered', () => {
    // No comments: the opening post itself is the unanswered external word.
    const item = pr({created_at: daysAgo(2)});
    assert.match(flagReason(item, [], NOW), /no maintainer/);
  });

  it('does not flag a fresh external PR (< 1 day old)', () => {
    assert.equal(flagReason(pr({created_at: daysAgo(0)}), [], NOW), null);
  });

  it('does not flag when a maintainer commented after the author', () => {
    const item = pr({created_at: daysAgo(5), comments: 2});
    const comments = [externalComment(3), memberComment(2)];
    assert.equal(flagReason(item, comments, NOW), null);
  });

  it('never flags a maintainer-authored PR, even when stale', () => {
    for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
      const item = pr({created_at: daysAgo(30), author_association: association});
      assert.equal(flagReason(item, [], NOW), null, association);
    }
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
    calls = {addLabels: [], removeLabel: [], listComments: [], get: []};
    const rest = {
      issues: {
        listForRepo: 'listForRepo',
        listComments: mock.fn(async params => {
          calls.listComments.push(params.issue_number);
          const item = openItems.find(i => i.number === params.issue_number);
          return {data: item.__comments ?? []};
        }),
        // Live re-read used to guard against concurrent double-labeling.
        // `__fresh` lets a test simulate another run having changed the label.
        get: mock.fn(async params => {
          calls.get.push(params.issue_number);
          const item = openItems.find(i => i.number === params.issue_number);
          return {data: item.__fresh ?? item};
        }),
        addLabels: mock.fn(async params => calls.addLabels.push(params.issue_number)),
        removeLabel: mock.fn(async params => calls.removeLabel.push(params.issue_number)),
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

  it('adds the label when a rule matches', async () => {
    github = makeGithub([issue({number: 7})]);
    await issueTriage({github, context});

    assert.deepEqual(calls.addLabels, [7]);
    assert.equal(calls.removeLabel.length, 0);
  });

  it('removes the label when an item no longer matches any rule', async () => {
    const item = issue({
      number: 8,
      labels: ['P3', FLAG_LABEL],
      assignees: [{login: 'dev'}],
    });
    github = makeGithub([item]);
    await issueTriage({github, context});

    assert.deepEqual(calls.removeLabel, [8]);
    assert.equal(calls.addLabels.length, 0);
  });

  it('is a no-op when the desired and actual state already agree', async () => {
    const flagged = issue({number: 9, labels: [FLAG_LABEL]}); // matches rule 1a
    const clean = issue({number: 10, labels: ['P3']}); // matches no rule
    github = makeGithub([flagged, clean]);
    await issueTriage({github, context});

    assert.equal(calls.get.length, 0); // no live re-read when state already agrees
    assert.equal(calls.addLabels.length, 0);
    assert.equal(calls.removeLabel.length, 0);
  });

  it('does not add the label twice when a concurrent run already added it', async () => {
    // Snapshot shows no label, but a live re-read finds another run beat us.
    const item = issue({number: 14});
    item.__fresh = issue({number: 14, labels: [FLAG_LABEL]});
    github = makeGithub([item]);
    await issueTriage({github, context});

    assert.deepEqual(calls.get, [14]); // we re-checked before mutating
    assert.equal(calls.addLabels.length, 0); // ...and backed off
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
