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
 * Runs the `srcdoc-tip-calculator.json` example of the catalog through the real sandbox proxy.
 * The app lives in a sandboxed frame the test cannot reach into, so it is driven through the
 * host data model and observed through what it writes back.
 */

import example from '../../../../../catalogs/iframe/examples/srcdoc-tip-calculator.json' with {type: 'json'};
import {
  FrameTestHarness,
  innerFrameOf,
  parseExampleMessages,
  waitFor,
} from '../../src/testing/frame_test_support.js';

const SURFACE_ID = 'gallery-iframe-tip-calculator';
const COMPONENT_ID = 'tip_calculator';
const DECLARED_HEIGHT = '240px';

describe('the srcdoc tip calculator example', () => {
  let harness: FrameTestHarness;
  let element: HTMLElement;
  let frame: HTMLIFrameElement;

  async function start(messages: {readonly messages: readonly unknown[]}) {
    harness = new FrameTestHarness(SURFACE_ID, parseExampleMessages(messages));
    element = await harness.renderComponent(COMPONENT_ID);
    frame = element.querySelector('iframe')!;
  }

  beforeEach(async () => {
    await start(example);
    await waitFor(
      () => harness.surface.dataModel.get('/bill/totalLabel') === '$75.52',
      'the app formatted the seeded bill',
    );
  });

  afterEach(() => {
    harness.dispose();
  });

  it('computes the seeded bill once the handshake completes', () => {
    expect(innerFrameOf(frame)).not.toBeNull();
    expect(harness.surface.dataModel.get('/bill/total')).toBe(75.52);
  });

  it('recomputes the total and its label when the host changes the bill', async () => {
    harness.setData('/bill/amount', 80);
    harness.setData('/bill/tipPercent', 15);

    await waitFor(
      () => harness.surface.dataModel.get('/bill/totalLabel') === '$92.00',
      'the app formatted the new bill',
    );
    expect(harness.surface.dataModel.get('/bill/total')).toBe(92);
  });

  it('formats the total in the currency of its static config', async () => {
    harness.dispose();
    const messages = structuredClone(example.messages);
    const calculator = messages
      .flatMap(message => message.updateComponents?.components ?? [])
      .find(component => component.id === COMPONENT_ID)!;
    Object.assign(calculator, {config: {currency: 'EUR', locale: 'en-US'}});

    await start({messages});

    await waitFor(
      () => harness.surface.dataModel.get('/bill/totalLabel') === '€75.52',
      'the app formatted the bill in euros',
    );
    expect(harness.surface.dataModel.get('/bill/total')).toBe(75.52);
  });

  it('sizes the frame to the breakdown the app renders', async () => {
    await waitFor(
      () => /^\d+px$/.test(frame.style.height) && frame.style.height !== DECLARED_HEIGHT,
      'the frame took the height the app asked for',
    );
    expect(element.style.height).toBe(frame.style.height);
  });
});
