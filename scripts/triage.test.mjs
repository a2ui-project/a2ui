/*
 * Copyright 2024 Google LLC
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
import {readFileSync} from 'node:fs';
import {afterEach, beforeEach, describe, it, mock} from 'node:test';

import issueTriage, {
  ASSIGNED_FOR_TRIAGE_LABEL,
  ASSIGNEE_REQUIRED_PRIORITIES,
  externalHasResponded,
  FLAG_LABEL,
  flagReason,
  isBot,
  lastHumanContribution,
  PRIORITY_LABELS,
  STALE_DAYS,
  TRIAGE_ASSIGNMENT_DAYS,
  WAITING_LABEL,
} from './triage.mjs';

const NOW = new Date('2026-06-30T00:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = n => new Date(NOW - n * DAY).toISOString();

// Minimal factories matching the shape the script reads from the GitHub API.
const issue = (overrides = {}) => ({
  number: 1,
  state: 'open',
  pull_request: undefined,
  labels: [],
  assignees: [],
  created_at: daysAgo(0),
  author_association: 'MEMBER',
  user: {login: 'maintainer', type: 'User'},
  comments: 0,
  ...overrides,
});

// An issue opened by an external contributor. Issues default to the team.
const externalIssue = (overrides = {}) =>
  issue({author_association: 'NONE', user: {login: 'reporter', type: 'User'}, ...overrides});

// PRs default to an external contributor, the case the automation watches.
const pr = (overrides = {}) =>
  issue({
    pull_request: {url: 'x'},
    author_association: 'CONTRIBUTOR',
    user: {login: 'contributor', type: 'User'},
    ...overrides,
  });

// Raw comment payload, in the shape the GitHub endpoints return it.
const comment = (overrides = {}) => ({
  created_at: daysAgo(0),
  author_association: 'MEMBER',
  user: {login: 'maintainer', type: 'User'},
  ...overrides,
});

const RAW_COMMENT_KEYS = Object.keys(comment());

// The normalized event `fetchContributions` produces, which `flagReason` and
// friends consume directly. Overrides use the raw key names, as for `comment`;
// a normalized one (`createdAt`) would otherwise be dropped on the floor and
// leave the test silently asserting against a default.
const event = (overrides = {}) => {
  const unknown = Object.keys(overrides).filter(key => !RAW_COMMENT_KEYS.includes(key));
  assert.deepEqual(unknown, [], `event() takes raw comment keys, got: ${unknown.join(', ')}`);

  const {created_at: createdAt, author_association: association, user} = comment(overrides);
  return {createdAt, association, user};
};

// Regression: PR review events checked out the PR's merge commit, whose older
// copy of the rules kept re-adding labels that the current rules removed.
describe('triage workflow', () => {
  it('runs the script from main, whatever the triggering event', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/triage.yml', import.meta.url),
      'utf8',
    );
    const checkout = workflow.match(
      /uses: actions\/checkout@.*\n\s+with:\n((?:\s+\w[\w-]*:.*\n)+)/,
    );
    assert.ok(checkout, 'checkout step with a `with:` block not found');
    assert.match(checkout[1], /^\s+ref: main$/m);
  });
});

describe('isBot', () => {
  it('detects bots by account type and login suffix', () => {
    assert.equal(isBot({type: 'Bot', login: 'whatever'}), true);
    assert.equal(isBot({type: 'User', login: 'github-actions[bot]'}), true);
  });

  it('treats real users and deleted accounts as human', () => {
    assert.equal(isBot({type: 'User', login: 'alice'}), false);
    assert.equal(isBot(null), false);
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
      event({created_at: daysAgo(8), user: {login: 'a', type: 'User'}}),
      event({created_at: daysAgo(2), user: {login: 'b', type: 'User'}}),
    ];
    assert.equal(lastHumanContribution(item, comments).createdAt, daysAgo(2));
  });

  it('ignores bot comments so they do not reset the clock', () => {
    const item = issue({created_at: daysAgo(10)});
    const comments = [
      event({created_at: daysAgo(7), user: {login: 'human', type: 'User'}}),
      event({created_at: daysAgo(1), user: {type: 'Bot', login: 'bot[bot]'}}),
    ];
    assert.equal(lastHumanContribution(item, comments).createdAt, daysAgo(7));
  });
});

describe('externalHasResponded', () => {
  // The label went on 3 days ago, so only contributions newer than that answer it.
  const LABELED_AT = daysAgo(3);
  const externalReply = (age, login = 'reporter') =>
    event({created_at: daysAgo(age), author_association: 'NONE', user: {login, type: 'User'}});

  // Regression: the opening post is not a contribution and always predates the
  // label — an item with no replies is the one still waiting, not one answered.
  it('does not count the opening post as a response', () => {
    assert.equal(externalHasResponded([], LABELED_AT), false);
  });

  it('is true when an external contributor replied after the label was added', () => {
    assert.equal(externalHasResponded([externalReply(1)], LABELED_AT), true);
  });

  it('is false when the only external reply predates the label', () => {
    assert.equal(externalHasResponded([externalReply(5)], LABELED_AT), false);
  });

  // Ties resolve toward clearing: an item is better off back on the triage queue
  // than parked and invisible on the strength of a same-second timestamp.
  it('counts a reply stamped at the moment of labeling', () => {
    assert.equal(externalHasResponded([externalReply(3)], LABELED_AT), true);
  });

  // What the label waits for is a word from outside the team, whoever it is
  // from; the item's author has no special standing.
  it('counts any external contributor, not just the item author', () => {
    assert.equal(externalHasResponded([externalReply(1, 'passer-by')], LABELED_AT), true);
  });

  it('ignores maintainer replies, whatever their association', () => {
    for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
      const reply = event({
        created_at: daysAgo(1),
        author_association: association,
        user: {login: 'maintainer', type: 'User'},
      });
      assert.equal(externalHasResponded([reply], LABELED_AT), false, association);
    }
  });

  // Bots count as external everywhere else, but cannot answer a question.
  it('ignores bot replies', () => {
    const reply = event({
      created_at: daysAgo(1),
      author_association: 'NONE',
      user: {login: 'stale-bot[bot]', type: 'Bot'},
    });
    assert.equal(externalHasResponded([reply], LABELED_AT), false);
  });

  it('still counts an external reply when a maintainer replied after it', () => {
    const maintainerReply = event({created_at: daysAgo(0)}); // MEMBER by default
    assert.equal(externalHasResponded([externalReply(1), maintainerReply], LABELED_AT), true);
  });

  it('is false when the labeling time is unknown, so the label survives', () => {
    assert.equal(externalHasResponded([externalReply(1)], null), false);
  });
});

describe('flagReason — issues', () => {
  it('flags an external issue with no priority label', () => {
    assert.match(flagReason(externalIssue(), [], NOW), /no priority label/);
  });

  // The team manages its own issues.
  it("does not flag a team member's issue with no priority label", () => {
    assert.equal(flagReason(issue(), [], NOW), null);
  });

  it('does not flag issues parked on the user response', () => {
    const item = externalIssue({labels: [WAITING_LABEL]});
    assert.equal(flagReason(item, [], NOW), null);
  });

  // Only P0 and P1 have a staleness threshold, and a priority settles the
  // missing-priority check, so nothing else can flag an assigned P2–P4.
  it('does not flag an assigned issue below P1, whatever else is wrong with it', () => {
    for (const priority of ['P2', 'P3', 'P4']) {
      const item = externalIssue({
        labels: [priority],
        assignees: [{login: 'dev'}],
        created_at: daysAgo(9999), // ancient, external last word
      });
      assert.equal(flagReason(item, [], NOW), null, priority);
    }
  });

  // The same check applies whether or not someone is assigned.
  for (const [name, assignees] of [
    ['assigned', [{login: 'dev'}]],
    ['unassigned', []],
  ]) {
    describe(`${name} with no priority`, () => {
      const externalComment = event({
        author_association: 'NONE',
        user: {login: 'reporter', type: 'User'},
      });

      it('flags an issue opened by an external contributor', () => {
        assert.match(flagReason(externalIssue({assignees}), [], NOW), /no priority label/);
      });

      it("flags a team member's issue with an external comment", () => {
        const item = issue({assignees, comments: 1});
        assert.match(flagReason(item, [externalComment], NOW), /no priority label/);
      });

      // The flag is about missing priority, not an unanswered comment, so a
      // team reply after the external comment does not clear it.
      it('keeps flagging once a team member has replied to the external comment', () => {
        const item = issue({assignees, comments: 2});
        const reply = event({created_at: daysAgo(0)});
        assert.match(flagReason(item, [externalComment, reply], NOW), /no priority label/);
      });

      it("does not flag a team member's issue with only team comments", () => {
        const item = issue({assignees, comments: 1});
        assert.equal(flagReason(item, [event()], NOW), null);
      });

      // Regression: #3595, filed by the e2e workflow, never stayed flagged.
      it('flags an issue opened by a bot', () => {
        const item = issue({
          assignees,
          author_association: 'CONTRIBUTOR',
          user: {login: 'github-actions[bot]', type: 'Bot'},
        });
        assert.match(flagReason(item, [], NOW), /no priority label/);
      });

      it("flags a team member's issue with a bot comment", () => {
        const item = issue({assignees, comments: 1});
        const botComment = event({
          author_association: 'NONE',
          user: {login: 'ci[bot]', type: 'Bot'},
        });
        assert.match(flagReason(item, [botComment], NOW), /no priority label/);
      });
    });
  }

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

  // Drive the staleness rule off STALE_DAYS so the thresholds live in one
  // place.
  for (const [priority, threshold] of Object.entries(STALE_DAYS)) {
    const assigned = {labels: [priority], assignees: [{login: 'dev'}]};

    it(`does not flag a fresh assigned ${priority} (within ${threshold} day(s))`, () => {
      const item = issue({...assigned, created_at: daysAgo(threshold)});
      assert.equal(flagReason(item, [], NOW), null);
    });

    // Regression: assigned issues used to be skipped before any threshold
    // was consulted, so a stale P0 or P1 was never flagged.
    it(`flags an assigned ${priority} stale beyond ${threshold} day(s)`, () => {
      const item = issue({...assigned, created_at: daysAgo(threshold + 1)});
      assert.match(flagReason(item, [], NOW), /no human activity/);
    });

    it(`measures an assigned ${priority} from its latest human comment`, () => {
      const item = issue({...assigned, comments: 1, created_at: daysAgo(threshold + 10)});
      const recent = event({created_at: daysAgo(threshold)});
      assert.equal(flagReason(item, [recent], NOW), null);
    });

    // An unassigned issue is reported for the missing assignee instead.
    it(`reports a stale unassigned ${priority} as having no assignee`, () => {
      const item = issue({labels: [priority], created_at: daysAgo(threshold + 1)});
      assert.match(flagReason(item, [], NOW), /no assignee/);
    });
  }

  // Every priority with a staleness threshold must also require an assignee:
  // staleness is only checked on assigned issues, and unassigned ones are
  // flagged for having no assignee.
  it('requires an assignee for every priority with a staleness threshold', () => {
    for (const priority of Object.keys(STALE_DAYS)) {
      assert.ok(ASSIGNEE_REQUIRED_PRIORITIES.has(priority), priority);
    }
  });

  // The staleness rules cover P0 and P1 only; P2 used to be flagged after 90
  // days and deliberately no longer is.
  it('watches staleness for P0 and P1 only', () => {
    assert.deepEqual(Object.keys(STALE_DAYS), ['P0', 'P1']);
  });

  it('never flags a P2 for staleness, however old, assigned or not', () => {
    for (const assignees of [[], [{login: 'dev'}]]) {
      const item = issue({labels: ['P2'], assignees, created_at: daysAgo(9999)});
      assert.equal(flagReason(item, [], NOW), null, `${assignees.length} assignee(s)`);
    }
  });
});

describe('flagReason — assigned for triage', () => {
  const dev = [{login: 'dev'}];
  const overdue = daysAgo(TRIAGE_ASSIGNMENT_DAYS + 1);

  // A P3 issue matches no other rule, so any flag comes from step 2.
  const handedOut = (overrides = {}) =>
    issue({labels: ['P3', ASSIGNED_FOR_TRIAGE_LABEL], assignees: dev, ...overrides});

  it('does not flag an assignment within its deadline', () => {
    const since = daysAgo(TRIAGE_ASSIGNMENT_DAYS);
    assert.equal(flagReason(handedOut(), [], NOW, since), null);
  });

  it('flags an assignment past its deadline', () => {
    const reason = flagReason(handedOut(), [], NOW, overdue);
    assert.match(reason, /assigned-for-triage/);
    assert.match(reason, new RegExp(`more than ${TRIAGE_ASSIGNMENT_DAYS} days`));
  });

  it('flags the label when nobody is assigned, however fresh', () => {
    const item = handedOut({assignees: []});
    assert.match(flagReason(item, [], NOW, daysAgo(0)), /nobody is assigned/);
  });

  // Step 2 decides alone: a fresh assignment holds back every later step.
  // Both items below would be flagged without the label.
  it('does not flag a fresh assignment, whatever else is wrong with it', () => {
    const staleP1 = handedOut({
      labels: ['P1', ASSIGNED_FOR_TRIAGE_LABEL],
      created_at: daysAgo(9999),
    });
    assert.equal(flagReason(staleP1, [], NOW, daysAgo(1)), null);

    const unansweredPR = pr({labels: [ASSIGNED_FOR_TRIAGE_LABEL], assignees: dev});
    assert.equal(flagReason(unansweredPR, [], NOW, daysAgo(1)), null);
  });

  // Step 1 outranks step 2: a parked item waits on the author, not the assignee.
  it('does not flag a parked item, even with an overdue assignment', () => {
    const item = handedOut({labels: ['P3', ASSIGNED_FOR_TRIAGE_LABEL, WAITING_LABEL]});
    assert.equal(flagReason(item, [], NOW, overdue), null);
    assert.equal(flagReason({...item, assignees: []}, [], NOW, overdue), null);
  });

  it('flags an overdue assignment on a maintainer-authored PR', () => {
    const item = pr({
      labels: [ASSIGNED_FOR_TRIAGE_LABEL],
      assignees: dev,
      author_association: 'MEMBER',
    });
    assert.match(flagReason(item, [], NOW, overdue), /assigned-for-triage/);
  });

  it('does not flag when the labeling time is unknown', () => {
    assert.equal(flagReason(handedOut(), [], NOW, null), null);
  });

  // The labeling time comes from the snapshot; if the label has since been
  // removed, the time must not count.
  it('ignores the labeling time once the label is gone', () => {
    const item = handedOut({labels: ['P3']});
    assert.equal(flagReason(item, [], NOW, overdue), null);
  });
});

// PRIORITY_LABELS is the single source of truth for which labels count as a
// priority. These tests pin that contract so a rename or reorder can't silently
// break triage.
describe('flagReason — PRIORITY_LABELS contract', () => {
  it('treats every PRIORITY_LABELS entry as a real priority (never "no priority")', () => {
    for (const priority of PRIORITY_LABELS) {
      // Fresh and internally authored, so only the priority rules can flag it.
      const item = issue({labels: [priority]});
      const reason = flagReason(item, [], NOW);
      if (reason !== null) {
        assert.doesNotMatch(reason, /no priority label/, priority);
      }
    }
  });

  it('flags an issue whose label is not in PRIORITY_LABELS as unprioritized', () => {
    const notAPriority = 'area: rendering';
    assert.ok(!PRIORITY_LABELS.includes(notAPriority));
    const item = externalIssue({labels: [notAPriority]});
    assert.match(flagReason(item, [], NOW), /no priority label/);
  });

  it('never flags a priority that has no staleness threshold', () => {
    const unThresholded = PRIORITY_LABELS.filter(
      p => STALE_DAYS[p] === undefined && !ASSIGNEE_REQUIRED_PRIORITIES.has(p),
    );
    assert.ok(unThresholded.length > 0, 'expected at least one priority without a threshold');
    for (const priority of unThresholded) {
      const item = issue({labels: [priority], created_at: daysAgo(9999)});
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
    event({
      created_at: daysAgo(age),
      author_association: 'CONTRIBUTOR',
      user: {login: 'contributor', type: 'User'},
    });
  const memberComment = age =>
    event({
      created_at: daysAgo(age),
      author_association: 'MEMBER',
      user: {login: 'maintainer', type: 'User'},
    });

  it('flags an external PR with no maintainer response', () => {
    const item = pr({created_at: daysAgo(5), comments: 1});
    assert.match(flagReason(item, [externalComment(2)], NOW), /no maintainer/);
  });

  it('flags an external PR that has never been answered', () => {
    // No comments: the opening post itself is the unanswered external word.
    const item = pr({created_at: daysAgo(2)});
    assert.match(flagReason(item, [], NOW), /no maintainer/);
  });

  // There is no grace period any more: a PR is triage work from the moment it
  // is opened, not a day later.
  it('flags an external PR opened moments ago', () => {
    assert.match(flagReason(pr({created_at: daysAgo(0)}), [], NOW), /no maintainer/);
  });

  it('flags an assigned external PR — a PR assignee is its reviewer', () => {
    // The reviewer going quiet is exactly what step 4 watches for.
    const item = pr({created_at: daysAgo(5), assignees: [{login: 'dev'}]});
    assert.match(flagReason(item, [], NOW), /no maintainer/);
  });

  it('does not flag when a maintainer commented after the author', () => {
    const item = pr({created_at: daysAgo(5), comments: 2});
    const comments = [externalComment(3), memberComment(2)];
    assert.equal(flagReason(item, comments, NOW), null);
  });

  it('flags a bot PR until a maintainer responds', () => {
    const item = pr({
      created_at: daysAgo(2),
      user: {login: 'dependabot[bot]', type: 'Bot'},
    });
    assert.match(flagReason(item, [], NOW), /no maintainer/);
    assert.equal(flagReason({...item, comments: 1}, [memberComment(1)], NOW), null);
  });

  // A bot comment is no response, from the author or the team, so it neither
  // flags nor unflags a PR.
  it('ignores bot comments on PRs', () => {
    const botComment = event({
      created_at: daysAgo(1),
      author_association: 'NONE',
      user: {login: 'gemini-code-assist[bot]', type: 'Bot'},
    });
    const answered = pr({created_at: daysAgo(5), comments: 2});
    assert.equal(flagReason(answered, [memberComment(3), botComment], NOW), null);
    const unanswered = pr({created_at: daysAgo(5), comments: 1});
    assert.match(flagReason(unanswered, [botComment], NOW), /no maintainer/);
  });

  it('never flags a maintainer-authored PR, however old', () => {
    for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
      const item = pr({created_at: daysAgo(30), author_association: association});
      assert.equal(flagReason(item, [], NOW), null, association);
    }
  });
});

describe('flagReason — external comment awaiting response', () => {
  const externalComment = age =>
    event({
      created_at: daysAgo(age),
      author_association: 'NONE',
      user: {login: 'reporter', type: 'User'},
    });

  it('flags when the latest reply is an unanswered external comment', () => {
    const item = issue({labels: ['P3'], comments: 1, created_at: daysAgo(5)});
    assert.match(flagReason(item, [externalComment(2)], NOW), /external contributor/);
  });

  // No grace period: the comment is triage work the moment it lands.
  it('flags an external comment posted moments ago', () => {
    const item = issue({labels: ['P3'], comments: 1, created_at: daysAgo(5)});
    assert.match(flagReason(item, [externalComment(0)], NOW), /external contributor/);
  });

  it('does not flag when a maintainer replied last', () => {
    const item = issue({labels: ['P3'], comments: 2, created_at: daysAgo(5)});
    const comments = [
      externalComment(3),
      event({
        created_at: daysAgo(2),
        author_association: 'MEMBER',
        user: {login: 'maintainer', type: 'User'},
      }),
    ];
    assert.equal(flagReason(item, comments, NOW), null);
  });

  it('flags an unassigned P2, P3 or P4 issue', () => {
    for (const priority of ['P2', 'P3', 'P4']) {
      const item = issue({labels: [priority], comments: 1, created_at: daysAgo(5)});
      assert.match(flagReason(item, [externalComment(2)], NOW), /external contributor/, priority);
    }
  });

  it('does not flag an assigned issue, whatever its priority', () => {
    for (const priority of PRIORITY_LABELS) {
      const item = issue({
        labels: [priority],
        assignees: [{login: 'dev'}],
        comments: 1,
        created_at: daysAgo(0),
      });
      assert.equal(flagReason(item, [externalComment(0)], NOW), null, priority);
    }
  });
});

describe('issueTriage reconciliation', () => {
  let github;
  let calls;

  const makeGithub = openItems => {
    calls = {addLabels: [], removeLabel: [], listComments: [], listEvents: [], get: []};
    const rest = {
      issues: {
        listForRepo: 'listForRepo',
        listComments: mock.fn(async params => {
          calls.listComments.push(params.issue_number);
          const item = openItems.find(i => i.number === params.issue_number);
          return {data: item.__comments ?? []};
        }),
        // Label history, used to find when WAITING_LABEL was added.
        listEvents: mock.fn(async params => {
          calls.listEvents.push(params.issue_number);
          const item = openItems.find(i => i.number === params.issue_number);
          return {data: item.__events ?? []};
        }),
        // Live re-read used to guard against concurrent double-labeling.
        // `__fresh` lets a test simulate another run having changed the label.
        get: mock.fn(async params => {
          calls.get.push(params.issue_number);
          const item = openItems.find(i => i.number === params.issue_number);
          return {data: item.__fresh ?? item};
        }),
        addLabels: mock.fn(async params => calls.addLabels.push(params.issue_number)),
        removeLabel: mock.fn(async params =>
          calls.removeLabel.push({number: params.issue_number, name: params.name}),
        ),
      },
    };
    return {
      rest,
      paginate: mock.fn(async (endpoint, params) => {
        if (typeof endpoint === 'function') {
          const res = await endpoint(params);
          return res.data;
        }
        return openItems;
      }),
    };
  };

  const context = {repo: {owner: 'a2ui-project', repo: 'a2ui'}};

  // Unlike the `flagReason` tests, `issueTriage` measures against the real
  // clock, so these fixtures are stamped relative to now rather than to NOW.
  const realDaysAgo = days => new Date(Date.now() - days * DAY).toISOString();
  const labeling = (name, days) => ({
    event: 'labeled',
    label: {name},
    created_at: realDaysAgo(days),
  });

  beforeEach(() => {
    mock.method(console, 'log', () => {});
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('adds the label when a rule matches', async () => {
    github = makeGithub([externalIssue({number: 7})]);
    await issueTriage({github, context});

    assert.deepEqual(calls.addLabels, [7]);
    assert.equal(calls.removeLabel.length, 0);
  });

  it('removes the label when an item no longer matches any rule', async () => {
    // Prioritized and answered: it matches no rule.
    const item = issue({number: 8, labels: ['P3', FLAG_LABEL]});
    github = makeGithub([item]);
    await issueTriage({github, context});

    assert.deepEqual(calls.removeLabel, [{number: 8, name: FLAG_LABEL}]);
    assert.equal(calls.addLabels.length, 0);
  });

  it('is a no-op when the desired and actual state already agree', async () => {
    const flagged = externalIssue({number: 9, labels: [FLAG_LABEL]}); // matches step 3
    const clean = issue({number: 10, labels: ['P3']}); // matches no rule
    github = makeGithub([flagged, clean]);
    await issueTriage({github, context});

    assert.equal(calls.get.length, 0); // no live re-read when state already agrees
    assert.equal(calls.addLabels.length, 0);
    assert.equal(calls.removeLabel.length, 0);
  });

  it('does not add the label twice when a concurrent run already added it', async () => {
    // Snapshot shows no label, but a live re-read finds another run beat us.
    const item = externalIssue({number: 14});
    item.__fresh = externalIssue({number: 14, labels: [FLAG_LABEL]});
    github = makeGithub([item]);
    await issueTriage({github, context});

    assert.deepEqual(calls.get, [14]); // we re-checked before mutating
    assert.equal(calls.addLabels.length, 0); // ...and backed off
  });

  it('does not flag an item that was prioritized between snapshot and mutation', async () => {
    // Snapshot shows no priority label (wants flag), but a live re-read finds
    // it was prioritized before we mutated. A team member answered the
    // reporter, so the priority was the only thing missing.
    const answered = {comments: 1, __comments: [comment()]};
    const item = externalIssue({number: 15, ...answered});
    item.__fresh = externalIssue({number: 15, labels: ['P3'], ...answered});
    github = makeGithub([item]);
    await issueTriage({github, context});

    assert.deepEqual(calls.get, [15]); // we re-checked before mutating
    assert.equal(calls.addLabels.length, 0); // ...and backed off from flagging
    assert.equal(calls.removeLabel.length, 0);
  });

  it('does not unflag an item that was already unflagged between snapshot and mutation', async () => {
    // Snapshot shows a prioritized item with flag (wants unflag), but a live
    // re-read finds the flag was already removed before we mutated.
    const item = issue({number: 24, labels: ['P3', FLAG_LABEL]});
    item.__fresh = issue({number: 24, labels: ['P3']});
    github = makeGithub([item]);
    await issueTriage({github, context});

    assert.deepEqual(calls.get, [24]); // we re-checked before mutating
    assert.equal(calls.removeLabel.length, 0); // ...and backed off from unflagging
    assert.equal(calls.addLabels.length, 0);
  });

  it('skips an item the listing reported as open but that is already closed', async () => {
    // GitHub's index lags: the snapshot matches step 3, but the live re-read
    // shows the item closed, and a closed item is nobody's triage work.
    const item = externalIssue({number: 25});
    item.__fresh = externalIssue({number: 25, state: 'closed'});
    github = makeGithub([item]);
    await issueTriage({github, context});

    assert.deepEqual(calls.get, [25]); // we re-checked before mutating
    assert.equal(calls.addLabels.length, 0);
    assert.equal(calls.removeLabel.length, 0);
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

  describe('waiting-for-author-response', () => {
    const reporter = {login: 'reporter', type: 'User'};

    // A parked item: the waiting label went on `labeledDaysAgo` days ago, and
    // `comments` replies were posted `repliedDaysAgo` days ago — by the reporter
    // unless `replyFrom`/`replyAssociation` say otherwise. Replies default to now
    // so the staleness rules stay quiet and each test asserts on the waiting
    // label alone; `labelEvent: false` drops the labeling from the item's
    // history, as if it could not be read.
    const parked = (
      number,
      {
        comments = 0,
        repliedDaysAgo = 0,
        replyFrom = reporter,
        replyAssociation = 'NONE',
        labeledDaysAgo = 1,
        labelEvent = true,
        ...overrides
      } = {},
    ) => {
      const item = issue({number, labels: [WAITING_LABEL], user: reporter, comments, ...overrides});
      item.__comments = Array.from({length: comments}, () =>
        comment({
          created_at: realDaysAgo(repliedDaysAgo),
          author_association: replyAssociation,
          user: replyFrom,
        }),
      );
      item.__events = labelEvent ? [labeling(WAITING_LABEL, labeledDaysAgo)] : [];
      return item;
    };

    it('keeps the label, and the item out of triage, until someone replies', async () => {
      // With no replies the opening post is the last human contribution, and it
      // predates the label — it must not be mistaken for a response.
      github = makeGithub([parked(15)]); // would otherwise match step 3
      await issueTriage({github, context});

      assert.equal(calls.get.length, 0); // nothing to change, so no live re-read
      assert.equal(calls.removeLabel.length, 0);
      assert.equal(calls.addLabels.length, 0);
    });

    it('clears the label once the reporter has replied', async () => {
      // The reply that unparks the item is itself an unanswered external
      // contribution, so step 3 puts it back on the triage queue at once.
      github = makeGithub([parked(16, {comments: 1, labels: [WAITING_LABEL, 'P3']})]);
      await issueTriage({github, context});

      assert.deepEqual(calls.listEvents, [16]);
      assert.deepEqual(calls.removeLabel, [{number: 16, name: WAITING_LABEL}]);
      assert.deepEqual(calls.addLabels, [16]);
    });

    it('leaves an assigned issue off the queue when it unparks', async () => {
      // Being assigned outranks the reply: a team member is already working on it.
      const item = parked(29, {
        comments: 1,
        labels: [WAITING_LABEL, 'P3'],
        assignees: [{login: 'dev'}],
      });
      github = makeGithub([item]);
      await issueTriage({github, context});

      assert.deepEqual(calls.removeLabel, [{number: 29, name: WAITING_LABEL}]);
      assert.equal(calls.addLabels.length, 0);
    });

    it('clears the label when any external contributor replies, not just the reporter', async () => {
      // The team is waiting to hear from outside, whoever answers.
      github = makeGithub([
        parked(25, {
          comments: 1,
          replyFrom: {login: 'passer-by', type: 'User'},
          labels: [WAITING_LABEL, 'P3'],
        }),
      ]);
      await issueTriage({github, context});

      assert.deepEqual(calls.removeLabel, [{number: 25, name: WAITING_LABEL}]);
    });

    it('keeps the label when only a maintainer has replied', async () => {
      // The team asked the question; asking again does not answer it.
      github = makeGithub([
        parked(26, {
          comments: 1,
          replyFrom: {login: 'maintainer', type: 'User'},
          replyAssociation: 'MEMBER',
        }),
      ]);
      await issueTriage({github, context});

      assert.equal(calls.removeLabel.length, 0);
      assert.equal(calls.addLabels.length, 0); // still parked, so still out of triage
    });

    it('keeps the label when only a bot has replied', async () => {
      github = makeGithub([
        parked(27, {comments: 1, replyFrom: {login: 'stale-bot[bot]', type: 'Bot'}}),
      ]);
      await issueTriage({github, context});

      assert.equal(calls.removeLabel.length, 0);
      assert.equal(calls.addLabels.length, 0);
    });

    it('keeps the label when the reply predates it', async () => {
      // The reply answered an earlier round of the conversation, not this label.
      github = makeGithub([parked(19, {comments: 1, repliedDaysAgo: 2, labeledDaysAgo: 1})]);
      await issueTriage({github, context});

      assert.equal(calls.removeLabel.length, 0);
      assert.equal(calls.addLabels.length, 0); // still parked, so still out of triage
    });

    it('measures from the most recent labeling, not the first', async () => {
      // Parked, answered, parked again: the answer to the first round must not
      // clear the second.
      const item = parked(20, {comments: 1, repliedDaysAgo: 3});
      item.__events = [labeling(WAITING_LABEL, 5), labeling(WAITING_LABEL, 1)];
      github = makeGithub([item]);
      await issueTriage({github, context});

      assert.equal(calls.removeLabel.length, 0);
    });

    it('ignores labelings of other labels', async () => {
      const item = parked(21, {comments: 1, repliedDaysAgo: 2, labeledDaysAgo: 3});
      item.__events = [labeling(WAITING_LABEL, 3), labeling('P3', 0)];
      github = makeGithub([item]);
      await issueTriage({github, context});

      assert.deepEqual(calls.removeLabel, [{number: 21, name: WAITING_LABEL}]);
    });

    it('keeps the label when its history does not record it being added', async () => {
      // Nothing to measure the reply against, so leave it for a human.
      github = makeGithub([parked(22, {comments: 1, labelEvent: false})]);
      await issueTriage({github, context});

      assert.equal(calls.removeLabel.length, 0);
      assert.equal(calls.addLabels.length, 0);
    });

    it('does not read label history for items that are not parked', async () => {
      github = makeGithub([issue({number: 23})]);
      await issueTriage({github, context});

      assert.equal(calls.listEvents.length, 0);
    });

    it('flags in the same run in which it clears the label', async () => {
      // Step 3 matches once the label is gone; that must not wait a whole run.
      github = makeGithub([parked(17, {comments: 1})]);
      await issueTriage({github, context});

      assert.deepEqual(calls.removeLabel, [{number: 17, name: WAITING_LABEL}]);
      assert.deepEqual(calls.addLabels, [17]);
    });

    it('does not clear the label on an item that has since been closed', async () => {
      const item = parked(28, {comments: 1});
      item.__fresh = issue({number: 28, state: 'closed', labels: [WAITING_LABEL]});
      github = makeGithub([item]);
      await issueTriage({github, context});

      assert.deepEqual(calls.get, [28]); // we re-checked before mutating
      assert.equal(calls.removeLabel.length, 0);
      assert.equal(calls.addLabels.length, 0);
    });

    it('backs off when a concurrent run already reconciled both labels', async () => {
      const item = parked(18, {comments: 1});
      item.__fresh = issue({number: 18, labels: [FLAG_LABEL]});
      github = makeGithub([item]);
      await issueTriage({github, context});

      assert.deepEqual(calls.get, [18]); // we re-checked before mutating
      assert.equal(calls.removeLabel.length, 0);
      assert.equal(calls.addLabels.length, 0);
    });
  });

  describe('assigned-for-triage', () => {
    // A P3 issue handed out for triage `labeledDaysAgo` days ago. It matches no
    // other rule, so any flag comes from step 2.
    const handedOut = (number, {labeledDaysAgo, ...overrides} = {}) => {
      const item = issue({
        number,
        labels: ['P3', ASSIGNED_FOR_TRIAGE_LABEL],
        assignees: [{login: 'dev'}],
        ...overrides,
      });
      item.__events =
        labeledDaysAgo === undefined ? [] : [labeling(ASSIGNED_FOR_TRIAGE_LABEL, labeledDaysAgo)];
      return item;
    };

    it('flags an assignment past its deadline', async () => {
      github = makeGithub([handedOut(30, {labeledDaysAgo: TRIAGE_ASSIGNMENT_DAYS + 1})]);
      await issueTriage({github, context});

      assert.deepEqual(calls.listEvents, [30]);
      assert.deepEqual(calls.addLabels, [30]);
    });

    it('leaves an assignment within its deadline alone', async () => {
      github = makeGithub([handedOut(31, {labeledDaysAgo: TRIAGE_ASSIGNMENT_DAYS - 1})]);
      await issueTriage({github, context});

      assert.deepEqual(calls.listEvents, [31]);
      assert.equal(calls.addLabels.length, 0);
    });

    it('measures from the most recent labeling, not the first', async () => {
      // Re-adding the label starts a new assignment.
      const item = handedOut(32);
      item.__events = [
        labeling(ASSIGNED_FOR_TRIAGE_LABEL, TRIAGE_ASSIGNMENT_DAYS + 10),
        labeling(ASSIGNED_FOR_TRIAGE_LABEL, 1),
      ];
      github = makeGithub([item]);
      await issueTriage({github, context});

      assert.equal(calls.addLabels.length, 0);
    });

    it('does not flag when its history does not record the label being added', async () => {
      github = makeGithub([handedOut(33)]);
      await issueTriage({github, context});

      assert.equal(calls.addLabels.length, 0);
    });

    it('does not flag an item whose label was removed before the mutation', async () => {
      // The snapshot shows an overdue assignment, but the live re-read finds
      // the label gone, so the snapshot's labeling time no longer applies.
      const item = handedOut(34, {labeledDaysAgo: TRIAGE_ASSIGNMENT_DAYS + 1});
      item.__fresh = issue({number: 34, labels: ['P3'], assignees: [{login: 'dev'}]});
      github = makeGithub([item]);
      await issueTriage({github, context});

      assert.deepEqual(calls.get, [34]); // we re-checked before mutating
      assert.equal(calls.addLabels.length, 0);
    });

    it('reads label history once for an item carrying both timed labels', async () => {
      const item = handedOut(36, {labels: ['P3', ASSIGNED_FOR_TRIAGE_LABEL, WAITING_LABEL]});
      item.__events = [
        labeling(ASSIGNED_FOR_TRIAGE_LABEL, TRIAGE_ASSIGNMENT_DAYS + 1),
        labeling(WAITING_LABEL, 1),
      ];
      github = makeGithub([item]);
      await issueTriage({github, context});

      assert.deepEqual(calls.listEvents, [36]);
      assert.equal(calls.addLabels.length, 0); // the parking outranks the assignment
      assert.equal(calls.removeLabel.length, 0); // nobody has replied
    });
  });
});
