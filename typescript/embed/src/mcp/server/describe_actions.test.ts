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

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {AnySchema} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import {z} from 'zod';
import {z as z4} from 'zod/v4';
import {describeActionRoutes, type DescribedActionRoute} from './describe_actions.js';

describe('describeActionRoutes', () => {
  it('returns an empty string when no routes are registered', () => {
    assert.equal(describeActionRoutes(new Map()), '');
  });

  it('produces identical output for equivalent Zod v3 and Zod v4 shapes', () => {
    const v3Routes = new Map<string, DescribedActionRoute>([
      [
        'select_date',
        {
          kind: 'action',
          description: 'Loads results for the chosen date.',
          argsSchema: {
            date: z.string().describe('ISO date'),
            cabin: z.enum(['economy', 'business']).optional().describe('Cabin class'),
            limit: z.number().default(10),
            tags: z.array(z.string()),
            filter: z.object({maxPrice: z.number(), nonstop: z.boolean().optional()}),
          },
        },
      ],
    ]);

    const v4Routes = new Map<string, DescribedActionRoute>([
      [
        'select_date',
        {
          kind: 'action',
          description: 'Loads results for the chosen date.',
          argsSchema: {
            date: z4.string().describe('ISO date'),
            cabin: z4.enum(['economy', 'business']).optional().describe('Cabin class'),
            limit: z4.number().default(10),
            tags: z4.array(z4.string()),
            filter: z4.object({maxPrice: z4.number(), nonstop: z4.boolean().optional()}),
          },
        },
      ],
    ]);

    assert.equal(describeActionRoutes(v3Routes), describeActionRoutes(v4Routes));
  });

  it('never throws on custom, async, or unrecognized schemas', () => {
    const routes = new Map<string, DescribedActionRoute>([
      [
        'custom_route',
        {
          kind: 'action',
          argsSchema: {
            known: z4.string().describe('Known string'),
            custom: z4
              .custom<symbol>((val): val is symbol => typeof val === 'symbol')
              .describe('Custom token'),
            asyncField: z.string().refine(async () => true),
            broken: {} as unknown as AnySchema,
          },
        },
      ],
    ]);

    const text = describeActionRoutes(routes);
    assert.match(text, /`known` \(`string`, required\): Known string/);
    assert.match(text, /`custom` \(`unknown`, required\): Custom token/);
    assert.match(text, /`asyncField` \(`string`, required\)/);
    assert.match(text, /`broken` \(`unknown`, required\)/);
  });
});
