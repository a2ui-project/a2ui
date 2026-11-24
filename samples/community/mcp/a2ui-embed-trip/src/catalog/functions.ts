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

/** Client-side reactive catalog functions for Day & Trip Studio. */

import {z} from 'zod';

import {createFunctionImplementation, spec} from '@a2ui/web_core/v1_0';

import {computeTripStats, parseStops} from './model.js';

/**
 * `tripStats(stops, hotel, budgetCap)`: computes total spend, category breakdown,
 * walking leg minutes, and rush/open-hours conflicts reactively on the client.
 */
export const tripStats = createFunctionImplementation(
  {
    name: 'tripStats',
    returnType: 'object',
    description:
      'Computes live itinerary totals, category spend (food, tickets, transit, stay), total walk minutes, and schedule/open-hours conflicts.',
    schema: spec(
      z
        .object({
          stops: z
            .unknown()
            .describe('REF:#/$defs/DynamicValue|Array of scheduled itinerary stops.'),
          hotel: z
            .unknown()
            .describe('REF:#/$defs/DynamicValue|Optional active basecamp hotel object.')
            .optional(),
          budgetCap: z
            .unknown()
            .describe('REF:#/$defs/DynamicNumber|Optional total trip budget cap.')
            .optional(),
        })
        .strict(),
      {required: ['stops'], closure: 'unevaluatedProperties'},
    ),
  },
  args =>
    computeTripStats(args['stops'], args['hotel'], args['budgetCap']) as unknown as Record<
      string,
      unknown
    >,
);

/** Returns the title of the currently selected stop from `/stops` and `/selectedStopId`. */
export function resolveSelectedStopTitle(rawStops: unknown, rawSelectedId: unknown): string {
  const stops = parseStops(rawStops);
  const selectedId = typeof rawSelectedId === 'string' ? rawSelectedId : '';
  const match = stops.find(stop => stop.id === selectedId) ?? stops[0];
  return match ? match.title : 'the itinerary';
}

export const selectedStopTitle = createFunctionImplementation(
  {
    name: 'selectedStopTitle',
    returnType: 'string',
    description: 'Returns the title of the selected stop, falling back to the first stop.',
    schema: spec(
      z
        .object({
          stops: z
            .unknown()
            .describe('REF:#/$defs/DynamicValue|Array of scheduled itinerary stops.'),
          selectedStopId: z
            .unknown()
            .describe('REF:#/$defs/DynamicString|ID of the currently selected stop.'),
        })
        .strict(),
      {required: ['stops', 'selectedStopId'], closure: 'unevaluatedProperties'},
    ),
  },
  args => resolveSelectedStopTitle(args['stops'], args['selectedStopId']),
);
