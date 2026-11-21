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

import {ISSUES} from '../testing/synthetic_snapshot.js';
import {describeFilter, filterIssues, normalizeFilter} from './inbox_filter.js';
import {isUntriaged, priorityProblems, REPLY_TEMPLATE_IDS} from './rules.js';

describe('inbox filters', () => {
  it('defaults to untriaged issues, newest first', () => {
    const issues = filterIssues(ISSUES, normalizeFilter());
    expect(issues.every(isUntriaged)).toBe(true);
    expect(issues[0]?.number).toBe(110);
    expect(issues).toHaveLength(14);
  });

  it('filters by labels, author and text, and sorts', () => {
    expect(
      filterIssues(ISSUES, normalizeFilter({labels: ['type: bug'], onlyUntriaged: false})).map(
        i => i.number,
      ),
    ).toEqual([110, 107]);
    expect(
      filterIssues(ISSUES, normalizeFilter({author: '@Alice-Dev', onlyUntriaged: false})).map(
        i => i.number,
      ),
    ).toEqual([106]);
    expect(filterIssues(ISSUES, normalizeFilter({text: 'empty list'})).map(i => i.number)).toEqual([
      110,
    ]);
    expect(filterIssues(ISSUES, normalizeFilter({sort: 'oldest'}))[0]?.number).toBe(161);
    expect(filterIssues(ISSUES, normalizeFilter({sort: 'comments'}))[0]?.number).toBe(110);
  });

  it('describes a filter', () => {
    expect(
      describeFilter(normalizeFilter({labels: ['type: bug'], author: 'x', text: 'crash'})),
    ).toBe('untriaged open issues, labeled type: bug, by @x, matching "crash", sorted by newest');
  });
});

describe('triage rules', () => {
  it('requires an owner for P0 and P1', () => {
    expect(priorityProblems('P0', [], null)).toEqual(['A P0 issue needs an assignee.']);
    expect(priorityProblems('P1', [], null)).toHaveLength(1);
    expect(priorityProblems('P1', [], 3)).toEqual([]);
    expect(priorityProblems('P2', [], null)).toEqual([]);
  });

  it('lists the canonical replies', () => {
    expect(REPLY_TEMPLATE_IDS).toEqual([
      'request_info',
      'compliance_report',
      'assigned_no_priority',
      'stale_p1',
      'out_of_scope',
    ]);
  });
});
