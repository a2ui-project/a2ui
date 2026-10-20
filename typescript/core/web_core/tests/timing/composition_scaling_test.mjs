// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Times the composition checks of `MessageProcessor.processMessages` under a
// validation config that defers the graph checks, as an agent's renderer state
// configures it. Like message_processor_scaling_test.mjs, it runs only under
// `yarn test:timing`.

import {describe, it} from 'node:test';

import {measureGrowth} from './timing.mjs';

import {Catalog, MessageProcessor, RELAXED_VALIDATION} from '../../dist/src/index.js';

/** A catalog whose `Column` holds only `Text` children. */
function allowedChildrenCatalog() {
  return Catalog.fromJson(
    {
      catalogId: 'allowed_children',
      components: {
        Column: {
          type: 'object',
          allowedChildren: ['Text'],
          properties: {children: {$ref: '#/$defs/ChildList'}},
        },
        Text: {type: 'object', properties: {text: {type: 'string'}}},
      },
    },
    '1.0',
  );
}

describe('composition checks under a deferred validation config', () => {
  it('check each child once when children arrive one per message', () => {
    // `root` lists every child up front, and the children then arrive one
    // per message. Each child is checked against `root` without reading the
    // other children, so the time grows with the number of children rather
    // than its square.
    const testCase = {
      action: 'measure_growth',
      operation: 'process_messages',
      payload: [
        '[{"version": "v1.0", "createSurface": {"surfaceId": "s1", "catalogId": "allowed_children"}}, ' +
          '{"version": "v1.0", "updateComponents": {"surfaceId": "s1", "components": [{"id": "root", "component": "Column", "children": [',
        {repeat: '"item_{i}"', separator: ', '},
        ']}]}}, ',
        {
          repeat:
            '{"version": "v1.0", "updateComponents": {"surfaceId": "s1", "components": [{"id": "item_{i}", "component": "Text", "text": "Item number {i}"}]}}',
          separator: ', ',
        },
        ']',
      ],
      sizes: [2000, 8000],
      max_ratio: 8,
    };
    const catalogs = [allowedChildrenCatalog()];
    const result = measureGrowth(testCase, payload => {
      const messages = JSON.parse(payload);
      return () =>
        new MessageProcessor(catalogs, undefined, {
          validationConfig: RELAXED_VALIDATION,
        }).processMessages(messages);
    });
    const [smaller, larger] = result.sizes;
    const [smallerMs, largerMs] = result.medianMs;
    console.log(
      `allowedChildren Column: ${smallerMs.toFixed(2)} ms at ${smaller}, ` +
        `${largerMs.toFixed(2)} ms at ${larger}, ratio ${result.ratio.toFixed(2)}`,
    );
  });
});
