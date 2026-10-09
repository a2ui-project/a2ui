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
 * Runs the `url-order-tracker.json` example of the catalog through the real sandbox proxy. The
 * example points at a placeholder origin, so the test swaps in `fixtures/apps/order_tracker.html`,
 * which Karma serves. The app lives in a sandboxed frame the test cannot reach into, so it is
 * driven through the host data model and observed through what it writes back.
 */

import example from '../../../../../catalogs/iframe/examples/url-order-tracker.json' with {type: 'json'};
import {
  FrameTestHarness,
  innerFrameOf,
  parseExampleMessages,
  waitFor,
} from '../../src/testing/frame_test_support.js';

const SURFACE_ID = 'gallery-iframe-order-tracker';
const COMPONENT_ID = 'order_tracker';
const APP_URL = new URL('/a2ui-fixtures/apps/order_tracker.html', window.location.origin).href;

/** The example messages with the component's placeholder `url` replaced by the served app. */
function exampleMessagesServedByKarma() {
  const messages = structuredClone(example.messages);
  for (const message of messages) {
    for (const component of message.updateComponents?.components ?? []) {
      if (component.id === COMPONENT_ID) {
        Object.assign(component, {url: APP_URL});
      }
    }
  }
  return parseExampleMessages({messages});
}

describe('the url order tracker example', () => {
  let harness: FrameTestHarness;
  let frame: HTMLIFrameElement;

  beforeEach(async () => {
    harness = new FrameTestHarness(SURFACE_ID, exampleMessagesServedByKarma());
    const element = await harness.renderComponent(COMPONENT_ID);
    frame = element.querySelector('iframe')!;
    await waitFor(
      () => harness.surface.dataModel.get('/summary') === '1 processing, 2 shipped',
      'the app summarized the seeded orders',
    );
  });

  afterEach(() => {
    harness.dispose();
  });

  it('summarizes the seeded orders once the handshake completes', () => {
    expect(innerFrameOf(frame)).not.toBeNull();
    expect(harness.actions).toEqual([]);
  });

  it('updates the summary and reports the delivery when the host delivers an order', async () => {
    harness.setData('/orders/0/status', 'delivered');

    await waitFor(
      () => harness.surface.dataModel.get('/summary') === '1 processing, 1 shipped, 1 delivered',
      'the app summarized the delivered order',
    );
    const delivered = await harness.nextAction('order_delivered');
    expect(delivered.context).toEqual({orderId: 'A-1001'});
    expect(harness.actions.length).toBe(1);
  });
});
