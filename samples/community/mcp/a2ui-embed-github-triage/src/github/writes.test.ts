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

import {syntheticSnapshot} from '../testing/synthetic_snapshot.js';
import {FixtureGitHub} from './fixture.js';
import {describeChange, planTriage, TriageWriter, WriteGate} from './writes.js';

async function issue(number: number) {
  return new FixtureGitHub(syntheticSnapshot()).getIssue(number);
}

describe('planTriage', () => {
  it('replaces the priority and type, adds components, assignee, milestone and reply', async () => {
    const plan = planTriage(await issue(110), {
      priority: 'P1',
      type: 'type: feature/enhancement',
      components: ['component: lit adapter', 'not a component'],
      assignee: 'bob-maintainer',
      milestone: {number: 3, title: 'v1.0'},
      reply: '  Thanks!  ',
      markHandled: true,
    });
    expect(plan.changes.map(describeChange)).toEqual([
      '+ label P1',
      '+ label type: feature/enhancement',
      '+ label component: lit adapter',
      '+ label status: first-line-handled',
      '- label type: bug',
      '+ assignee @bob-maintainer',
      'milestone none → v1.0',
      '+ comment (7 characters)',
    ]);
  });

  it('plans nothing when the issue already matches', async () => {
    const current = await issue(107);
    const plan = planTriage(current, {
      priority: 'P1',
      type: 'type: bug',
      assignee: 'bob-maintainer',
      milestone: {number: 3, title: 'v1.0'},
    });
    expect(plan.changes).toEqual([]);
  });

  it('removes a previous priority', async () => {
    const plan = planTriage(await issue(108), {priority: 'P3'});
    expect(plan.changes.map(describeChange)).toEqual(['+ label P3', '- label P2']);
  });
});

describe('WriteGate', () => {
  it('needs TRIAGE_WRITE=1 and the repo in TRIAGE_WRITE_REPOS', () => {
    expect(new WriteGate({}).allows('o/r')).toBe(false);
    expect(new WriteGate({TRIAGE_WRITE: '1'}).allows('o/r')).toBe(false);
    expect(new WriteGate({TRIAGE_WRITE_REPOS: 'o/r'}).allows('o/r')).toBe(false);
    expect(new WriteGate({TRIAGE_WRITE: 'true', TRIAGE_WRITE_REPOS: 'o/r'}).allows('o/r')).toBe(
      false,
    );
    expect(new WriteGate({TRIAGE_WRITE: '1', TRIAGE_WRITE_REPOS: 'x/y, O/R'}).allows('o/r')).toBe(
      true,
    );
    expect(
      new WriteGate({TRIAGE_WRITE: '1', TRIAGE_WRITE_REPOS: 'o/r'}).allows('a2ui-project/a2ui'),
    ).toBe(false);
  });

  it('explains why writes are dry runs', () => {
    expect(new WriteGate({}).dryRunReason('o/r')).toMatch(/TRIAGE_WRITE=1/);
    expect(new WriteGate({TRIAGE_WRITE: '1'}).dryRunReason('o/r')).toBe(
      'o/r is not in TRIAGE_WRITE_REPOS',
    );
  });
});

describe('TriageWriter', () => {
  it('writes nothing in a dry run', async () => {
    const github = new FixtureGitHub(syntheticSnapshot());
    const writer = new TriageWriter(github, new WriteGate({TRIAGE_WRITE: '1'}), github.repo);
    const plan = planTriage(await github.getIssue(110), {priority: 'P2', reply: 'Hi'});
    const result = await writer.apply([plan]);
    expect(result).toMatchObject({dryRun: true, written: 0, planned: 2});
    expect(github.writes).toEqual([]);
    expect((await github.getIssue(110)).labels.map(label => label.name)).not.toContain('P2');
  });

  it('writes every change when the gate allows the repo', async () => {
    const github = new FixtureGitHub(syntheticSnapshot());
    const writer = new TriageWriter(
      github,
      new WriteGate({TRIAGE_WRITE: '1', TRIAGE_WRITE_REPOS: github.repo}),
      github.repo,
    );
    const plan = planTriage(await github.getIssue(110), {
      priority: 'P2',
      assignee: 'alice-dev',
      milestone: {number: 3, title: 'v1.0'},
      reply: 'Hi',
    });
    const result = await writer.apply([plan]);
    expect(result).toMatchObject({dryRun: false, written: 4, planned: 4, errors: []});
    expect(github.writes.map(write => write.method)).toEqual([
      'addLabels',
      'addAssignees',
      'setMilestone',
      'addComment',
    ]);
    const after = await github.getIssue(110);
    expect(after.labels.map(label => label.name)).toContain('P2');
    expect(after.milestone?.title).toBe('v1.0');
  });

  it('reports failed writes and keeps going', async () => {
    const github = new FixtureGitHub(syntheticSnapshot());
    const writer = new TriageWriter(
      github,
      new WriteGate({TRIAGE_WRITE: '1', TRIAGE_WRITE_REPOS: github.repo}),
      github.repo,
    );
    const result = await writer.apply([
      {number: 999, title: 'missing', changes: [{kind: 'addLabel', label: 'P1'}]},
      {number: 110, title: 'ok', changes: [{kind: 'comment', body: 'Hi'}]},
    ]);
    expect(result.written).toBe(1);
    expect(result.errors[0]).toMatch(/#999 \+ label P1/);
  });
});
