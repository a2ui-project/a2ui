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

// Tests for flag_reason.mts. Run from the repository root with:
// node --test tools/internal/triage/flagging/flag_reason.test.mts

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {itemReason, parseItem, toPath, toSentence} from './flag_reason.mts';
import {type GitHubReader, type IssueEvent, type Item, type RawContribution} from './triage.mts';

const NOW = new Date('2026-06-30T00:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

const item = (overrides: Partial<Item> = {}): Item => ({
  number: 7,
  state: 'open',
  html_url: 'https://github.com/a2ui-project/a2ui/issues/7',
  labels: [],
  assignees: [],
  created_at: daysAgo(1),
  author_association: 'NONE',
  user: {login: 'reporter', type: 'User'},
  comments: 0,
  ...overrides,
});

/** A reader that returns `served` for item 7, with its comments and events. */
const reader = (
  served: Item,
  comments: RawContribution[] = [],
  events: IssueEvent[] = [],
): GitHubReader => {
  const data = (value: unknown) => async () => ({data: value});
  return {
    rest: {
      issues: {
        get: async () => ({data: served}),
        listComments: data(comments),
        listEvents: data(events),
      },
      pulls: {listReviews: data([]), listReviewComments: data([])},
    },
    paginate: async <T,>(
      endpoint: (params: Record<string, unknown>) => Promise<unknown>,
      params: Record<string, unknown>,
    ) => ((await endpoint(params)) as {data: T[]}).data,
  };
};

const ref = {owner: 'a2ui-project', repo: 'a2ui', number: 7};

describe('parseItem', () => {
  it('reads a number as an item in a2ui-project/a2ui', () => {
    assert.deepEqual(parseItem('123'), {owner: 'a2ui-project', repo: 'a2ui', number: 123});
    assert.deepEqual(parseItem('#123'), {owner: 'a2ui-project', repo: 'a2ui', number: 123});
  });

  it('reads issue and PR URLs', () => {
    assert.deepEqual(parseItem('https://github.com/a2ui-project/a2ui/issues/12'), {
      owner: 'a2ui-project',
      repo: 'a2ui',
      number: 12,
    });
    assert.deepEqual(parseItem('https://github.com/octo/genui/pull/34/'), {
      owner: 'octo',
      repo: 'genui',
      number: 34,
    });
  });

  it('rejects anything else', () => {
    for (const arg of ['', 'abc', '12a', 'https://github.com/a2ui-project/a2ui/commit/12']) {
      assert.throws(() => parseItem(arg), /Not an issue or PR/, arg);
    }
  });
});

describe('toPath', () => {
  it('fills the route parameters and puts the rest in the query', () => {
    assert.equal(
      toPath('repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner: 'a2ui-project',
        repo: 'a2ui',
        issue_number: 7,
        per_page: 100,
      }),
      'repos/a2ui-project/a2ui/issues/7/comments?per_page=100',
    );
  });

  it('leaves out the query when every parameter is in the route', () => {
    assert.equal(toPath('repos/{owner}', {owner: 'a2ui-project'}), 'repos/a2ui-project');
  });
});

describe('toSentence', () => {
  it('capitalizes the reason', () => {
    assert.equal(
      toSentence('this external PR has no assignee.'),
      'This external PR has no assignee.',
    );
  });
});

describe('itemReason', () => {
  it('returns the reason for a flagged item, as a sentence', async () => {
    assert.deepEqual(await itemReason(reader(item()), ref, NOW), {
      url: 'https://github.com/a2ui-project/a2ui/issues/7',
      reason: 'This issue has external input but no priority label yet.',
    });
  });

  it('returns null for an item that should not be flagged', async () => {
    const teamIssue = item({author_association: 'MEMBER', labels: ['P2']});
    const result = await itemReason(reader(teamIssue), ref, NOW);
    assert.equal(result.reason, null);
  });

  it('reads the comments', async () => {
    const teamIssue = item({author_association: 'MEMBER', labels: ['P2'], comments: 1});
    const external: RawContribution = {
      created_at: daysAgo(0),
      author_association: 'NONE',
      user: {login: 'reporter', type: 'User'},
    };
    const {reason} = await itemReason(reader(teamIssue, [external]), ref, NOW);
    assert.match(reason ?? '', /^The latest contribution is from an external contributor/);
  });

  it('reads when the timed labels were added', async () => {
    const assigned = item({
      labels: ['status: assigned-for-triage'],
      assignees: [{login: 'triager'}],
    });
    const labeled: IssueEvent = {
      event: 'labeled',
      label: {name: 'status: assigned-for-triage'},
      created_at: daysAgo(15),
    };
    const {reason} = await itemReason(reader(assigned, [], [labeled]), ref, NOW);
    assert.match(reason ?? '', /was added more than 14 days ago/);
  });

  it('scores the item as if the answered waiting label were gone', async () => {
    const parked = item({labels: ['status: waiting-for-author-response'], comments: 1});
    const labeled: IssueEvent = {
      event: 'labeled',
      label: {name: 'status: waiting-for-author-response'},
      created_at: daysAgo(1),
    };
    const reply: RawContribution = {
      created_at: daysAgo(0),
      author_association: 'NONE',
      user: {login: 'reporter', type: 'User'},
    };
    const {reason} = await itemReason(reader(parked, [reply], [labeled]), ref, NOW);
    assert.equal(reason, 'This issue has external input but no priority label yet.');
  });

  it('builds the URL when the API does not return one', async () => {
    const {url} = await itemReason(reader(item({html_url: undefined})), ref, NOW);
    assert.equal(url, 'https://github.com/a2ui-project/a2ui/issues/7');
  });
});
