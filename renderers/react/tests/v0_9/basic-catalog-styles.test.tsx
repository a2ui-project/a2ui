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

import React from 'react';
import {describe, it, expect, beforeEach, afterEach} from 'vitest';

import {Text} from '../../src/v0_9/catalog/basic/components/Text';
import {Button} from '../../src/v0_9/catalog/basic/components/Button';
import {TextField} from '../../src/v0_9/catalog/basic/components/TextField';
import {ChoicePicker} from '../../src/v0_9/catalog/basic/components/ChoicePicker';
import {BASIC_CATALOG_CSS} from '../../src/v0_9/catalog/basic/styles';
import {renderA2uiComponent} from '../utils';

/**
 * The basic catalog must be styled with literal, stable `a2ui-*` class names
 * (the convention shared with the Angular and Lit renderers) rather than
 * CSS-module lookups: the published build does not process CSS modules, so
 * module lookups ship as `undefined` and components render unstyled
 * (issue #1307).
 */
describe('basic catalog styling contract', () => {
  describe('Button', () => {
    it('carries the a2ui-button class', () => {
      const {view} = renderA2uiComponent(Button, {});
      const button = view.container.querySelector('button');
      expect(button?.classList.contains('a2ui-button')).toBe(true);
    });

    it('adds the primary class for the primary variant', () => {
      const {view} = renderA2uiComponent(Button, {variant: 'primary'});
      const button = view.container.querySelector('button');
      expect(button?.classList.contains('a2ui-button')).toBe(true);
      expect(button?.classList.contains('primary')).toBe(true);
    });

    it('adds the borderless class for the borderless variant', () => {
      const {view} = renderA2uiComponent(Button, {variant: 'borderless'});
      const button = view.container.querySelector('button');
      expect(button?.classList.contains('borderless')).toBe(true);
    });
  });

  describe('Text', () => {
    it('carries the a2ui-text class for markdown text', () => {
      const {view} = renderA2uiComponent(Text, {text: 'hello'});
      expect(view.container.querySelector('.a2ui-text')).not.toBeNull();
    });

    it('carries a2ui-text and a2ui-caption for the caption variant', () => {
      const {view} = renderA2uiComponent(Text, {text: 'note', variant: 'caption'});
      const caption = view.container.querySelector('.a2ui-caption');
      expect(caption).not.toBeNull();
      expect(caption?.classList.contains('a2ui-text')).toBe(true);
    });

    it('carries a2ui-text plus the variant class for headings', () => {
      const {view} = renderA2uiComponent(Text, {text: 'Title', variant: 'h1'});
      const heading = view.container.querySelector('.a2ui-text');
      expect(heading).not.toBeNull();
      expect(heading?.classList.contains('h1')).toBe(true);
    });
  });

  describe('TextField', () => {
    it('classes the container, label and input', () => {
      const {view} = renderA2uiComponent(TextField, {label: 'Name'});
      expect(view.container.querySelector('.a2ui-text-field-container')).not.toBeNull();
      expect(view.container.querySelector('label.a2ui-field-label')).not.toBeNull();
      expect(view.container.querySelector('input.a2ui-field-input')).not.toBeNull();
    });

    it('marks invalid input and classes the error message', () => {
      const {view} = renderA2uiComponent(TextField, {
        label: 'Name',
        validationErrors: ['Required'],
      });
      const input = view.container.querySelector('input');
      expect(input?.classList.contains('invalid')).toBe(true);
      expect(view.container.querySelector('.a2ui-error-message')?.textContent).toBe('Required');
    });
  });

  describe('ChoicePicker', () => {
    const options = [
      {label: 'A', value: 'a'},
      {label: 'B', value: 'b'},
    ];

    it('classes the host and option labels', () => {
      const {view} = renderA2uiComponent(ChoicePicker, {options, value: []});
      expect(view.container.querySelector('.a2ui-choice-picker')).not.toBeNull();
      expect(view.container.querySelectorAll('.a2ui-option-label').length).toBe(2);
    });

    it('classes chips with a2ui-chip and marks selection with selected', () => {
      const {view} = renderA2uiComponent(ChoicePicker, {
        options,
        value: ['a'],
        displayStyle: 'chips',
      });
      const chips = view.container.querySelectorAll('.a2ui-chip');
      expect(chips.length).toBe(2);
      const selected = view.container.querySelectorAll('.a2ui-chip.selected');
      expect(selected.length).toBe(1);
    });
  });

  it('never renders the literal string "undefined" in a class attribute', () => {
    const cases: Array<[Parameters<typeof renderA2uiComponent>[0], Record<string, unknown>]> = [
      [Button, {variant: 'primary'}],
      [Text, {text: 'note', variant: 'caption'}],
      [TextField, {label: 'Name', validationErrors: ['Required']}],
      [ChoicePicker, {options: [{label: 'A', value: 'a'}], value: ['a'], displayStyle: 'chips'}],
    ];
    for (const [impl, props] of cases) {
      const {view} = renderA2uiComponent(impl, props);
      for (const el of view.container.querySelectorAll('[class]')) {
        expect(el.getAttribute('class')).not.toContain('undefined');
      }
    }
  });
});

describe('basic catalog stylesheet', () => {
  it('defines rules for every styled component', () => {
    for (const selector of [
      '.a2ui-button',
      '.a2ui-button.primary',
      '.a2ui-button.borderless',
      '.a2ui-text',
      '.a2ui-caption',
      '.a2ui-text-field-container',
      '.a2ui-field-input',
      '.a2ui-error-message',
      '.a2ui-choice-picker',
      '.a2ui-chip.selected',
      '.a2ui-option-label',
    ]) {
      expect(BASIC_CATALOG_CSS).toContain(selector);
    }
  });

  describe('injection', () => {
    let hadAdopted: boolean;

    beforeEach(() => {
      // jsdom has no adoptedStyleSheets; stub it so the guarded injection
      // path runs the way it does in a real browser.
      hadAdopted = 'adoptedStyleSheets' in document;
      (document as unknown as {adoptedStyleSheets: CSSStyleSheet[]}).adoptedStyleSheets = [];
    });

    afterEach(() => {
      if (!hadAdopted) {
        delete (document as unknown as {adoptedStyleSheets?: CSSStyleSheet[]}).adoptedStyleSheets;
      }
    });

    it('adopts the component rules when a component renders', () => {
      renderA2uiComponent(Button, {});
      const hasButtonRule = document.adoptedStyleSheets.some(sheet =>
        Array.from(sheet.cssRules).some(rule => rule.cssText.includes('a2ui-button')),
      );
      expect(hasButtonRule).toBe(true);
    });
  });
});
