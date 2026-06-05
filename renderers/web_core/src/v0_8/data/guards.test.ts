/*
 * Copyright 2025 Google LLC
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
import * as guards from './guards.js';

describe('v0.8 Guards', () => {
  const validComponentNode = {id: '1', type: 'Text', properties: {}};
  const validStringValue = {literal: 'hello'};
  const validNumberValue = {literal: 42};
  const validBooleanValue = {literal: true};

  describe('Basics', () => {
    it('isValueMap', () => {
      assert.strictEqual(guards.isValueMap({key: 'k1', valueString: 'v1'}), true);
      assert.strictEqual(guards.isValueMap({notKey: 'k1'}), false);
      assert.strictEqual(guards.isValueMap(null), false);
      assert.strictEqual(guards.isValueMap('string'), false);
    });

    it('isPath', () => {
      assert.strictEqual(guards.isPath('path', '/a/b'), true);
      assert.strictEqual(guards.isPath('path', 123), false);
      assert.strictEqual(guards.isPath('notPath', '/a/b'), false);
    });

    it('isObject', () => {
      assert.strictEqual(guards.isObject({}), true);
      assert.strictEqual(guards.isObject([]), false);
      assert.strictEqual(guards.isObject(null), false);
      assert.strictEqual(guards.isObject(42), false);
    });

    it('isComponentArrayReference', () => {
      assert.strictEqual(guards.isComponentArrayReference({explicitList: ['1', '2']}), true);
      assert.strictEqual(guards.isComponentArrayReference({template: {}}), true);
      assert.strictEqual(guards.isComponentArrayReference({}), false);
      assert.strictEqual(guards.isComponentArrayReference(null), false);
    });
  });

  describe('Component Resolution Guards', () => {
    it('isResolvedAudioPlayer', () => {
      assert.strictEqual(guards.isResolvedAudioPlayer({url: validStringValue}), true);
      assert.strictEqual(guards.isResolvedAudioPlayer({url: 42}), false);
      assert.strictEqual(guards.isResolvedAudioPlayer({}), false);
    });

    it('isResolvedButton', () => {
      assert.strictEqual(guards.isResolvedButton({child: validComponentNode, action: {}}), true);
      assert.strictEqual(guards.isResolvedButton({child: validComponentNode}), false); // missing action
      assert.strictEqual(guards.isResolvedButton({action: {}}), false); // missing child
      assert.strictEqual(guards.isResolvedButton({}), false);
    });

    it('isResolvedCard', () => {
      assert.strictEqual(guards.isResolvedCard({child: validComponentNode}), true);
      assert.strictEqual(guards.isResolvedCard({children: [validComponentNode]}), true);
      assert.strictEqual(guards.isResolvedCard({children: 'not array'}), false);
      assert.strictEqual(guards.isResolvedCard({}), false);
      assert.strictEqual(guards.isResolvedCard(null), false);
    });

    it('isResolvedCheckbox', () => {
      assert.strictEqual(
        guards.isResolvedCheckbox({
          label: validStringValue,
          value: validBooleanValue,
        }),
        true,
      );
      assert.strictEqual(guards.isResolvedCheckbox({label: validStringValue}), false);
      assert.strictEqual(guards.isResolvedCheckbox({value: validBooleanValue}), false);
    });

    it('isResolvedColumn', () => {
      assert.strictEqual(guards.isResolvedColumn({children: [validComponentNode]}), true);
      assert.strictEqual(guards.isResolvedColumn({children: {}}), false);
      assert.strictEqual(guards.isResolvedColumn({}), false);
    });

    it('isResolvedDateTimeInput', () => {
      assert.strictEqual(guards.isResolvedDateTimeInput({value: validStringValue}), true);
      assert.strictEqual(guards.isResolvedDateTimeInput({}), false);
    });

    it('isResolvedDivider', () => {
      assert.strictEqual(guards.isResolvedDivider({anyOptionalProp: true}), true);
      assert.strictEqual(guards.isResolvedDivider(null), false);
    });

    it('isResolvedImage', () => {
      assert.strictEqual(guards.isResolvedImage({url: validStringValue}), true);
      assert.strictEqual(guards.isResolvedImage({}), false);
    });

    it('isResolvedIcon', () => {
      assert.strictEqual(guards.isResolvedIcon({name: validStringValue}), true);
      assert.strictEqual(guards.isResolvedIcon({}), false);
    });

    it('isResolvedList', () => {
      assert.strictEqual(guards.isResolvedList({children: [validComponentNode]}), true);
      assert.strictEqual(guards.isResolvedList({children: {}}), false);
      assert.strictEqual(guards.isResolvedList({}), false);
    });

    it('isResolvedModal', () => {
      assert.strictEqual(
        guards.isResolvedModal({
          entryPointChild: validComponentNode,
          contentChild: validComponentNode,
        }),
        true,
      );
      assert.strictEqual(guards.isResolvedModal({entryPointChild: validComponentNode}), false);
    });

    it('isResolvedMultipleChoice', () => {
      assert.strictEqual(guards.isResolvedMultipleChoice({selections: []}), true);
      assert.strictEqual(guards.isResolvedMultipleChoice({}), false);
    });

    it('isResolvedRow', () => {
      assert.strictEqual(guards.isResolvedRow({children: [validComponentNode]}), true);
      assert.strictEqual(guards.isResolvedRow({children: {}}), false);
      assert.strictEqual(guards.isResolvedRow({}), false);
    });

    it('isResolvedSlider', () => {
      assert.strictEqual(guards.isResolvedSlider({value: validNumberValue}), true);
      assert.strictEqual(guards.isResolvedSlider({}), false);
    });

    it('isResolvedTabs (and isResolvedTabItem)', () => {
      const validItem = {title: validStringValue, child: validComponentNode};
      assert.strictEqual(guards.isResolvedTabs({tabItems: [validItem]}), true);
      assert.strictEqual(guards.isResolvedTabs({tabItems: [{title: validStringValue}]}), false); // missing child
      assert.strictEqual(guards.isResolvedTabs({tabItems: {}}), false);
      assert.strictEqual(guards.isResolvedTabs({}), false);
    });

    it('isResolvedText', () => {
      assert.strictEqual(guards.isResolvedText({text: validStringValue}), true);
      assert.strictEqual(guards.isResolvedText({}), false);
    });

    it('isResolvedTextField', () => {
      assert.strictEqual(guards.isResolvedTextField({label: validStringValue}), true);
      assert.strictEqual(guards.isResolvedTextField({}), false);
    });

    it('isResolvedVideo', () => {
      assert.strictEqual(guards.isResolvedVideo({url: validStringValue}), true);
      assert.strictEqual(guards.isResolvedVideo({}), false);
    });
  });

  describe('Internal/Private structural guards via components', () => {
    it('isStringValue via Text', () => {
      assert.strictEqual(guards.isResolvedText({text: {path: '.'}}), true);
      assert.strictEqual(guards.isResolvedText({text: {literalString: 'hello'}}), true);
      assert.strictEqual(guards.isResolvedText({text: {invalid: 'string'}}), false);
    });

    it('isNumberValue via Slider', () => {
      assert.strictEqual(guards.isResolvedSlider({value: {path: '.'}}), true);
      assert.strictEqual(guards.isResolvedSlider({value: {literalNumber: 42}}), true);
      assert.strictEqual(guards.isResolvedSlider({value: {invalid: 42}}), false);
    });

    it('isBooleanValue via Checkbox', () => {
      assert.strictEqual(
        guards.isResolvedCheckbox({
          label: validStringValue,
          value: {path: '.'},
        }),
        true,
      );
      assert.strictEqual(
        guards.isResolvedCheckbox({
          label: validStringValue,
          value: {literalBoolean: true},
        }),
        true,
      );
      assert.strictEqual(
        guards.isResolvedCheckbox({
          label: validStringValue,
          value: {invalid: true},
        }),
        false,
      );
    });

    it('isAnyComponentNode edge cases via Row', () => {
      assert.strictEqual(guards.isResolvedRow({children: [{id: '1', type: 'Text'}]}), false); // missing properties
      assert.strictEqual(guards.isResolvedRow({children: [null]}), false);
      assert.strictEqual(guards.isResolvedRow({children: ['string']}), false);
    });
  });
});
