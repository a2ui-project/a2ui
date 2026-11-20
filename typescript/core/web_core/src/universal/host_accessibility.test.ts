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

import * as assert from 'node:assert';
import {after, afterEach, before, describe, it} from 'node:test';

import {setupTestDom, teardownTestDom} from '../test/dom-setup.js';
import {setValue, signal, type Signal} from '../reactivity/signals.js';
import type {ComponentNode, NodeProps} from '../resolution/component-node.js';

describe('bindHostAccessibility', () => {
  let hostModule: typeof import('./host_accessibility.js');

  before(async () => {
    setupTestDom();
    hostModule = await import('./host_accessibility.js');
  });

  afterEach(() => {
    document.body.textContent = '';
  });

  after(() => {
    teardownTestDom();
  });

  /** A host element, a node whose props can be replaced, and its targets. */
  function setup(props: NodeProps) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const propsSignal: Signal<NodeProps> = signal(props);
    const node = {id: 'n1', props: propsSignal} as unknown as ComponentNode;
    const targets = hostModule.createAccessibilityTargets();
    const stop = hostModule.bindHostAccessibility(host, node, targets);
    return {host, propsSignal, targets, stop};
  }

  it('labels the host as a group without a target', () => {
    const {host} = setup({
      accessibility: {label: 'Deal', description: 'Ends today', live: 'polite', hidden: true},
    });

    assert.strictEqual(host.getAttribute('role'), 'group');
    assert.strictEqual(host.getAttribute('aria-label'), 'Deal');
    assert.strictEqual(host.getAttribute('aria-description'), 'Ends today');
    assert.strictEqual(host.getAttribute('aria-live'), 'polite');
    assert.strictEqual(host.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(host.inert, true);
  });

  it('keeps a role the host already has', () => {
    const host = document.createElement('div');
    host.setAttribute('role', 'region');
    const node = {id: 'n1', props: signal({accessibility: {label: 'Deal'}})};
    const stop = hostModule.bindHostAccessibility(
      host,
      node as unknown as ComponentNode,
      hostModule.createAccessibilityTargets(),
    );

    assert.strictEqual(host.getAttribute('role'), 'region');
    stop();
    assert.strictEqual(host.getAttribute('role'), 'region');
  });

  it('leaves an attribute that someone else changed since it set it', () => {
    const {host, propsSignal} = setup({accessibility: {label: 'Deal'}});
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Offer');

    setValue(propsSignal, {});

    assert.strictEqual(host.getAttribute('role'), 'region');
    assert.strictEqual(host.getAttribute('aria-label'), 'Offer');
  });

  it('moves the label and validation state to the target', () => {
    const {host, targets} = setup({
      accessibility: {label: 'Email', live: 'polite'},
      isValid: false,
      validationErrors: ['Required'],
    });
    const input = document.createElement('input');
    const errors = document.createElement('div');

    setValue(targets.target, input);
    setValue(targets.errors, errors);

    assert.strictEqual(host.hasAttribute('role'), false);
    assert.strictEqual(host.hasAttribute('aria-label'), false);
    assert.strictEqual(host.getAttribute('aria-live'), 'polite');
    assert.strictEqual(input.getAttribute('aria-label'), 'Email');
    assert.strictEqual(input.getAttribute('aria-invalid'), 'true');
    assert.strictEqual(errors.id, 'n1-error');
    assert.strictEqual(input.getAttribute('aria-describedby'), 'n1-error');
  });

  it('follows prop changes and target removal', () => {
    const {host, propsSignal, targets} = setup({
      accessibility: {label: 'Email'},
      isValid: false,
      validationErrors: ['Required'],
    });
    const input = document.createElement('input');
    setValue(targets.target, input);

    setValue(propsSignal, {accessibility: {label: 'Email'}, isValid: true, validationErrors: []});
    assert.strictEqual(input.hasAttribute('aria-invalid'), false);

    setValue(targets.target, null);
    assert.strictEqual(input.hasAttribute('aria-label'), false);
    assert.strictEqual(host.getAttribute('aria-label'), 'Email');
  });

  it('keeps the attributes the component set on its target', () => {
    const {propsSignal, targets, stop} = setup({});
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Search');
    input.setAttribute('aria-describedby', 'hint');
    const errors = document.createElement('div');
    setValue(targets.target, input);
    setValue(targets.errors, errors);
    assert.strictEqual(input.getAttribute('aria-label'), 'Search');

    setValue(propsSignal, {
      accessibility: {label: 'Email'},
      isValid: false,
      validationErrors: ['Required'],
    });
    assert.strictEqual(input.getAttribute('aria-label'), 'Email');
    assert.strictEqual(input.getAttribute('aria-describedby'), 'hint n1-error');

    setValue(propsSignal, {isValid: true, validationErrors: []});
    assert.strictEqual(input.getAttribute('aria-label'), 'Search');
    assert.strictEqual(input.getAttribute('aria-describedby'), 'hint');
    assert.strictEqual(errors.hasAttribute('id'), false);

    setValue(propsSignal, {accessibility: {label: 'Email'}});
    stop();
    assert.strictEqual(input.getAttribute('aria-label'), 'Search');
  });

  it('leaves the DOM alone when other props change', () => {
    const {host, propsSignal, targets} = setup({
      value: 'a',
      accessibility: {label: 'Email', live: 'polite'},
      isValid: false,
      validationErrors: ['Required'],
    });
    const input = document.createElement('input');
    const errors = document.createElement('div');
    host.append(input, errors);
    setValue(targets.target, input);
    setValue(targets.errors, errors);
    const observer = new MutationObserver(() => {});
    observer.observe(host, {attributes: true, subtree: true});

    setValue(propsSignal, {
      value: 'ab',
      accessibility: {label: 'Email', live: 'polite'},
      isValid: false,
      validationErrors: ['Required'],
    });

    assert.deepStrictEqual(observer.takeRecords(), []);
    observer.disconnect();
  });

  it('removes every attribute it set when stopped', () => {
    const {host, targets, stop} = setup({
      accessibility: {label: 'Email', live: 'polite'},
      isValid: false,
      validationErrors: ['Required'],
    });
    const input = document.createElement('input');
    const errors = document.createElement('div');
    setValue(targets.target, input);
    setValue(targets.errors, errors);

    stop();

    for (const name of ['aria-label', 'aria-invalid', 'aria-describedby']) {
      assert.strictEqual(input.hasAttribute(name), false, name);
    }
    assert.strictEqual(errors.hasAttribute('id'), false);
    for (const name of ['role', 'aria-label', 'aria-live']) {
      assert.strictEqual(host.hasAttribute(name), false, name);
    }
  });
});
