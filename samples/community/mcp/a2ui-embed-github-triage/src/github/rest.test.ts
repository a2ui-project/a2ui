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

import {GitHubError, MAX_BODY_LENGTH, RestGitHub, toIssue, toLabel} from './rest.js';

interface Call {
  url: string;
  method: string;
  body?: unknown;
  auth?: string;
}

/** A fetch that answers from `routes` (path prefix to JSON) and records calls. */
function fakeFetch(routes: Record<string, unknown>, calls: Call[] = []): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers['Authorization'],
    });
    const path = url.replace('https://api.github.com', '');
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find(prefix => path.startsWith(prefix));
    if (key === undefined)
      return new Response(JSON.stringify({message: 'Not Found'}), {status: 404});
    return new Response(JSON.stringify(routes[key]), {status: 200});
  }) as typeof fetch;
}

const rawIssue = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  user: {login: 'alice', avatar_url: 'https://avatars.githubusercontent.com/u/1'},
  labels: [{name: 'P2', color: 'FBCA04', description: 'Medium'}],
  assignees: [],
  milestone: null,
  comments: 1,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
  html_url: `https://github.com/o/r/issues/${number}`,
  body: 'Body',
  ...extra,
});

describe('RestGitHub', () => {
  it('rejects a malformed repo name', () => {
    expect(() => new RestGitHub({repo: 'not a repo'})).toThrow(/owner\/name/);
  });

  it('normalizes issues and labels', () => {
    const issue = toIssue(rawIssue(5, {body: 'x'.repeat(MAX_BODY_LENGTH + 10), user: null}));
    expect(issue.author.login).toBe('ghost');
    expect(issue.labels).toEqual([{name: 'P2', color: 'fbca04', description: 'Medium'}]);
    expect(issue.body.length).toBeLessThan(MAX_BODY_LENGTH + 10);
    expect(toLabel({name: 'x', color: 'red'}).color).toBe('ededed');
  });

  it('lists open issues without PRs, with the token, and caches reads', async () => {
    const calls: Call[] = [];
    const github = new RestGitHub({
      repo: 'o/r',
      token: 'secret-token',
      fetch: fakeFetch(
        {'/repos/o/r/issues?': [rawIssue(2), rawIssue(1, {pull_request: {}})]},
        calls,
      ),
    });
    const issues = await github.listOpenIssues();
    expect(issues.map(issue => issue.number)).toEqual([2]);
    expect(issues[0]?.body).toBe('');
    expect(calls[0]?.auth).toBe('Bearer secret-token');
    await github.listOpenIssues();
    expect(calls).toHaveLength(1);
    await github.listOpenIssues({fresh: true});
    expect(calls).toHaveLength(2);
  });

  it('reads check runs only for commit SHAs', async () => {
    const calls: Call[] = [];
    const github = new RestGitHub({
      repo: 'o/r',
      fetch: fakeFetch(
        {
          '/repos/o/r/commits/abcdef1/check-runs': {
            check_runs: [{name: 'lint', status: 'completed', conclusion: 'success', html_url: 'u'}],
          },
        },
        calls,
      ),
    });
    expect(await github.listCheckRuns('../../evil')).toEqual([]);
    expect(await github.listCheckRuns('abcdef1')).toEqual([
      {name: 'lint', status: 'completed', conclusion: 'success', url: 'u'},
    ]);
    expect(calls).toHaveLength(1);
  });

  it('turns HTTP errors into GitHubError with the status', async () => {
    const github = new RestGitHub({repo: 'o/r', fetch: fakeFetch({})});
    await expect(github.getIssue(1)).rejects.toThrow(GitHubError);
    await expect(github.getIssue(1)).rejects.toThrow(/404: Not Found/);
  });

  it('sends writes to the REST endpoints', async () => {
    const calls: Call[] = [];
    const github = new RestGitHub({repo: 'o/r', fetch: fakeFetch({'/repos/o/r/': {}}, calls)});
    await github.addLabels(1, ['P1']);
    await github.removeLabel(1, 'status: needs-triage');
    await github.addAssignees(1, ['bob']);
    await github.setMilestone(1, 3);
    await github.addComment(1, 'Hi');
    await github.createReview(2, {event: 'COMMENT', body: 'Looks good'});
    expect(
      calls.map(call => `${call.method} ${call.url.replace('https://api.github.com', '')}`),
    ).toEqual([
      'POST /repos/o/r/issues/1/labels',
      'DELETE /repos/o/r/issues/1/labels/status%3A%20needs-triage',
      'POST /repos/o/r/issues/1/assignees',
      'PATCH /repos/o/r/issues/1',
      'POST /repos/o/r/issues/1/comments',
      'POST /repos/o/r/pulls/2/reviews',
    ]);
    expect(calls[0]?.body).toEqual({labels: ['P1']});
  });
});
