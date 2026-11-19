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

import {
  BREAKDOWN_EVENT,
  BREAKDOWN_TEMPLATE,
  BreakdownContextSchema,
  breakdownAction,
  REFRESH_EVENT,
  RefreshContextSchema,
  refreshAction,
} from './events.js';

describe('events', () => {
  it('builds a refresh action that the action schema accepts once resolved', () => {
    expect(refreshAction().event.name).toBe(REFRESH_EVENT);
    expect(
      RefreshContextSchema.parse({sql: 'SELECT 1', visualization: 'auto', title: 'Query result'}),
    ).toEqual({sql: 'SELECT 1', visualization: 'auto', title: 'Query result'});
    expect(() => RefreshContextSchema.parse({sql: ''})).toThrow();
    expect(() => RefreshContextSchema.parse({sql: 'SELECT 1', visualization: 'pie'})).toThrow();
  });

  it('builds a breakdown action whose context the follow-up schema accepts', () => {
    const action = breakdownAction({dimension: 'Customer.Country', metric: 'Revenue'});
    expect(action).toEqual({
      event: {name: BREAKDOWN_EVENT, context: {dimension: 'Customer.Country', metric: 'Revenue'}},
    });
    expect(BreakdownContextSchema.parse(action.event.context)).toEqual(action.event.context);
    expect(() => BreakdownContextSchema.parse({dimension: 'x'})).toThrow();
  });

  it('has a follow-up template with only the breakdown context keys', () => {
    const keys = [...BREAKDOWN_TEMPLATE.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
    expect(keys.sort()).toEqual(Object.keys(BreakdownContextSchema.shape).sort());
  });
});
