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

/**
 * Custom catalog functions for `canvasCatalog`:
 * - `evaluatePlan(scene, placements, rules)` -> live spatial/social constraint evaluation
 * - `inspectItem(scene, placements, selectedId)` -> contextual piece/guest inspector details
 * - `selectedLabel(scene, placements, selectedId)` -> concise string for follow-up prompts
 * - `scoreSummaryText(scene, placements, rules)` -> concise score string for follow-up prompts
 */

import {z} from 'zod';

import {createFunctionImplementation, spec} from '@a2ui/web_core/v1_0';

import {evaluatePlanData, inspectItemData} from '../domain/geometry.js';

export const evaluatePlan = createFunctionImplementation(
  {
    name: 'evaluatePlan',
    returnType: 'object',
    description:
      'Evaluates spatial clearances (door swing, walkway width, window daylight, side access, safety halos) or banquet seating rules (conflicts, parent-child adjacency, dietary grouping, quiet zones, host balance) against the current placements.',
    schema: spec(
      z
        .object({
          scene: z.unknown().describe('REF:#/$defs/DynamicValue|The floorplan or seating scene.'),
          placements: z
            .unknown()
            .describe('REF:#/$defs/DynamicValue|Current furniture or guest seat placements.'),
          rules: z.unknown().describe('REF:#/$defs/DynamicValue|Constraint rules to evaluate.'),
        })
        .strict(),
      {required: ['scene', 'placements', 'rules'], closure: 'unevaluatedProperties'},
    ),
  },
  args =>
    evaluatePlanData(args['scene'], args['placements'], args['rules']) as unknown as Record<
      string,
      unknown
    >,
);

export const inspectItem = createFunctionImplementation(
  {
    name: 'inspectItem',
    returnType: 'object',
    description:
      'Returns contextual dimensions, coordinates, table/seat assignment, and constraint notes for the currently selected piece or guest.',
    schema: spec(
      z
        .object({
          scene: z.unknown().describe('REF:#/$defs/DynamicValue|The floorplan or seating scene.'),
          placements: z
            .unknown()
            .describe('REF:#/$defs/DynamicValue|Current furniture or guest seat placements.'),
          selectedId: z
            .unknown()
            .describe('REF:#/$defs/DynamicString|ID of the selected piece or guest.'),
        })
        .strict(),
      {required: ['scene', 'placements', 'selectedId'], closure: 'unevaluatedProperties'},
    ),
  },
  args =>
    inspectItemData(args['scene'], args['placements'], args['selectedId']) as unknown as Record<
      string,
      unknown
    >,
);

export const selectedLabel = createFunctionImplementation(
  {
    name: 'selectedLabel',
    returnType: 'string',
    description:
      'Returns a short summary label for the currently selected furniture piece or guest.',
    schema: spec(
      z
        .object({
          scene: z.unknown().describe('REF:#/$defs/DynamicValue|The floorplan or seating scene.'),
          placements: z
            .unknown()
            .describe('REF:#/$defs/DynamicValue|Current furniture or guest seat placements.'),
          selectedId: z
            .unknown()
            .describe('REF:#/$defs/DynamicString|ID of the selected piece or guest.'),
        })
        .strict(),
      {required: ['scene', 'placements', 'selectedId'], closure: 'unevaluatedProperties'},
    ),
  },
  args => {
    const info = inspectItemData(args['scene'], args['placements'], args['selectedId']);
    return info.found ? `${info.title} (${info.subtitle})` : info.title;
  },
);

export const scoreSummaryText = createFunctionImplementation(
  {
    name: 'scoreSummaryText',
    returnType: 'string',
    description: 'Returns a concise score summary string for the current layout.',
    schema: spec(
      z
        .object({
          scene: z.unknown().describe('REF:#/$defs/DynamicValue|The floorplan or seating scene.'),
          placements: z
            .unknown()
            .describe('REF:#/$defs/DynamicValue|Current furniture or guest seat placements.'),
          rules: z.unknown().describe('REF:#/$defs/DynamicValue|Constraint rules to evaluate.'),
        })
        .strict(),
      {required: ['scene', 'placements', 'rules'], closure: 'unevaluatedProperties'},
    ),
  },
  args => evaluatePlanData(args['scene'], args['placements'], args['rules']).summary,
);

export const CANVAS_FUNCTIONS = [evaluatePlan, inspectItem, selectedLabel, scoreSummaryText];
