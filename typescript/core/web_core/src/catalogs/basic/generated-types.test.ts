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

import type {
  ButtonProps as V09ButtonProps,
  TextProps as V09TextProps,
} from '../../v0_9/basic_catalog/index.js';
import type {ButtonProps as V1ButtonProps, TextProps as V1TextProps} from './v1/index.js';

// The checks are made by the compiler: each `@ts-expect-error` fails the
// build if the line below it type-checks.
describe('generated basic catalog props types', () => {
  it('bind with the spelling of their own protocol version', () => {
    const v1: V1TextProps[] = [
      {text: 'hi'},
      {text: {'@path': '/x'}},
      {text: {'@call': 'formatString', args: {value: 'x'}}},
      // @ts-expect-error a v1.0 binding is spelled '@path'
      {text: {path: '/x'}},
      // @ts-expect-error a binding names its path
      {text: {}},
    ];
    const v09: V09TextProps[] = [
      {text: {path: '/x'}},
      {text: {call: 'formatString', args: {value: 'x'}}},
      // @ts-expect-error a v0.9 binding is spelled 'path'
      {text: {'@path': '/x'}},
    ];
    assert.strictEqual(v1.length + v09.length, 8);
  });

  it('type checks as each version declares them', () => {
    const v1: V1ButtonProps[] = [
      {child: 'c', action: {event: {name: 'go'}}, '@checks': [{condition: {'@path': '/ok'}}]},
      // @ts-expect-error a v1.0 check condition is a binding or a call, not a literal
      {child: 'c', action: {event: {name: 'go'}}, '@checks': [{condition: true}]},
    ];
    const v09: V09ButtonProps[] = [
      {child: 'c', action: {event: {name: 'go'}}, checks: [{condition: true, message: 'm'}]},
    ];
    assert.strictEqual(v1.length + v09.length, 3);
  });
});
