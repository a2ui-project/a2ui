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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';

import {checkV08ComponentIds} from './component-ids.js';

const surfaceUpdate = (components: unknown[]) => ({surfaceUpdate: {surfaceId: 's', components}});

describe('checkV08ComponentIds', () => {
  it('accepts unique ids with resolvable references', () => {
    const issues = checkV08ComponentIds(
      surfaceUpdate([
        {id: 'root', component: {Column: {children: {explicitList: ['a']}}}},
        {id: 'a', component: {Card: {child: 'b'}}},
        {id: 'b', component: {Text: {text: {literalString: 'x'}}}},
      ]),
    );
    assert.deepStrictEqual(issues, []);
  });

  it('reports a duplicate id', () => {
    const issues = checkV08ComponentIds(
      surfaceUpdate([
        {id: 'x', component: {Text: {}}},
        {id: 'x', component: {Text: {}}},
      ]),
    );
    assert.strictEqual(issues.length, 1);
    assert.match(issues[0].message, /Duplicate component ID found: x/);
    assert.deepStrictEqual(issues[0].path, ['surfaceUpdate', 'components', 1, 'id']);
  });

  it('reports dangling references from each container kind', () => {
    const issues = checkV08ComponentIds(
      surfaceUpdate([
        {id: 'row', component: {Row: {children: {explicitList: ['gone1']}}}},
        {id: 'list', component: {List: {children: {template: {componentId: 'gone2'}}}}},
        {id: 'card', component: {Card: {child: 'gone3'}}},
        {id: 'tabs', component: {Tabs: {tabItems: [{child: 'gone4'}]}}},
        {id: 'modal', component: {Modal: {entryPointChild: 'gone5', contentChild: 'gone6'}}},
        {id: 'btn', component: {Button: {child: 'gone7'}}},
      ]),
    );
    const ids = issues.map(i => /'(gone\d)'/.exec(i.message)?.[1]);
    assert.deepStrictEqual(ids, ['gone1', 'gone2', 'gone3', 'gone4', 'gone5', 'gone6', 'gone7']);
  });

  it('requires exactly one of explicitList or template in children', () => {
    const both = checkV08ComponentIds(
      surfaceUpdate([
        {
          id: 'a',
          component: {Column: {children: {explicitList: [], template: {componentId: 'a'}}}},
        },
      ]),
    );
    assert.match(both[0].message, /either 'explicitList' or 'template'/);
    const neither = checkV08ComponentIds(
      surfaceUpdate([{id: 'a', component: {Row: {children: {}}}}]),
    );
    assert.match(neither[0].message, /either 'explicitList' or 'template'/);
  });

  it('ignores messages without a surfaceUpdate', () => {
    assert.deepStrictEqual(checkV08ComponentIds({deleteSurface: {surfaceId: 's'}}), []);
    assert.deepStrictEqual(checkV08ComponentIds(null), []);
  });
});
