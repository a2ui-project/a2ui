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

import {describe, expect, it} from 'vitest';

import {A2uiValidationError, type ComponentNode, defineMacro, param} from '../../../src/index.js';

describe('defineMacro', () => {
  it.each(['Surface', 'Ｓurface', '123-invalid!', 'has space'])(
    'rejects the component name %j',
    name => {
      expect(() => defineMacro({name, render: () => ({component: 'Text'})})).toThrow(
        A2uiValidationError,
      );
    },
  );

  it('fills in defaults for the parameters an input leaves out', () => {
    const seen: unknown[] = [];
    const Badge = defineMacro({
      name: 'Badge',
      parameters: {
        label: param.string(),
        variant: param.string({default: 'body'}),
        weight: param.number({required: false}),
      },
      render: (args): ComponentNode => {
        seen.push(args);
        return {component: 'Text', text: args.label, variant: args.variant};
      },
    });

    expect(Badge.render({label: 'Hi'})).toEqual({component: 'Text', text: 'Hi', variant: 'body'});
    expect(seen).toEqual([{label: 'Hi', variant: 'body', weight: undefined}]);
  });
});
