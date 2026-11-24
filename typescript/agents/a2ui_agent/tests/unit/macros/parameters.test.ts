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

import {describe, expect, expectTypeOf, it} from 'vitest';

import {type ComponentChild, defineMacro, type MacroInput, param} from '../../../src/index.js';

describe('param', () => {
  it('records the presence its options give a parameter', () => {
    expect(param.string()).toEqual({type: 'string', presence: 'required'});
    expect(param.integer({default: 10})).toEqual({
      type: 'integer',
      presence: 'defaulted',
      default: 10,
    });
    expect(param.number({required: false, description: 'Weight'})).toEqual({
      type: 'number',
      presence: 'optional',
      description: 'Weight',
    });
    expect(param.string({enum: ['a', 'b'], default: 'a'})).toEqual({
      type: 'string',
      presence: 'defaulted',
      enum: ['a', 'b'],
      default: 'a',
    });
  });

  it('infers the render arguments from the parameters', () => {
    type Items = ComponentChild[] | {path: string; componentId: ComponentChild};
    const Typed = defineMacro({
      name: 'Typed',
      parameters: {
        title: param.string(),
        variant: param.string({enum: ['primary', 'secondary'], default: 'primary'}),
        weight: param.number({required: false}),
        content: param.component(),
        items: param.childList(),
        active: param.boolean({default: true}),
      },
      render: args => {
        expectTypeOf(args).toEqualTypeOf<{
          readonly title: string;
          readonly variant: 'primary' | 'secondary';
          readonly weight: number | undefined;
          readonly content: ComponentChild;
          readonly items: Items;
          readonly active: boolean;
        }>();
        return {component: 'Text'};
      },
    });

    expectTypeOf(Typed.render).parameter(0).toEqualTypeOf<MacroInput<typeof Typed.parameters>>();
    expectTypeOf<MacroInput<typeof Typed.parameters>>().toEqualTypeOf<
      {title: string; content: ComponentChild; items: Items} & {
        variant?: 'primary' | 'secondary';
        weight?: number;
        active?: boolean;
      }
    >();
  });

  it('types the action and dynamic parameters as their v1.0 wire forms', () => {
    defineMacro({
      name: 'Wired',
      parameters: {
        onClick: param.action(),
        label: param.dynamicString(),
        checks: param.checkRuleList(),
      },
      render: _args => {
        expectTypeOf<{event: {name: string}}>().toExtend<typeof _args.onClick>();
        expectTypeOf<{functionCall: {'@call': string}}>().toExtend<typeof _args.onClick>();
        expectTypeOf<{'@path': string}>().toExtend<typeof _args.label>();
        expectTypeOf<[{condition: {'@call': string}; message: string}]>().toExtend<
          typeof _args.checks
        >();
        return {component: 'Text'};
      },
    });
  });
});
