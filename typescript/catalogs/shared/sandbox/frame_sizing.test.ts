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

import {
  FrameSizing,
  measureHostContext,
  observeHostContext,
  type FrameHostContext,
} from './frame_sizing.js';

describe('FrameSizing', () => {
  let container: HTMLDivElement;
  let frame: HTMLIFrameElement;
  let sizing: FrameSizing;

  beforeEach(() => {
    jasmine.clock().install();
    container = document.createElement('div');
    frame = document.createElement('iframe');
    container.appendChild(frame);
    document.body.appendChild(container);
    sizing = new FrameSizing({frame});
  });

  afterEach(() => {
    sizing.dispose();
    container.remove();
    jasmine.clock().uninstall();
  });

  it('applies a request after the throttle window, to the frame and its parent', () => {
    sizing.requestSize(640, 480);
    expect(frame.style.height).toBe('');
    jasmine.clock().tick(100);
    expect(frame.style.width).toBe('640px');
    expect(frame.style.height).toBe('480px');
    expect(container.style.width).toBe('640px');
    expect(container.style.height).toBe('480px');
    expect(container.style.aspectRatio).toBe('auto');
  });

  it('clamps dimensions to the allowed range', () => {
    sizing.requestSize(10, 9000);
    jasmine.clock().tick(100);
    expect(frame.style.width).toBe('200px');
    expect(frame.style.height).toBe('2000px');
  });

  it('leaves an omitted dimension unchanged', () => {
    sizing.requestSize(undefined, 300);
    jasmine.clock().tick(100);
    expect(frame.style.width).toBe('');
    expect(frame.style.height).toBe('300px');
  });

  it('ignores changes below the threshold once a size is applied', () => {
    sizing.requestSize(400, 300);
    jasmine.clock().tick(100);
    sizing.requestSize(403, 304);
    jasmine.clock().tick(100);
    expect(frame.style.width).toBe('400px');
    expect(frame.style.height).toBe('300px');
    sizing.requestSize(405, 305);
    jasmine.clock().tick(100);
    expect(frame.style.width).toBe('405px');
    expect(frame.style.height).toBe('305px');
  });

  it('coalesces requests within a window and applies the latest', () => {
    sizing.requestSize(undefined, 300);
    jasmine.clock().tick(50);
    sizing.requestSize(undefined, 500);
    sizing.requestSize(undefined, 700);
    jasmine.clock().tick(50);
    expect(frame.style.height).toBe('700px');
    jasmine.clock().tick(200);
    expect(frame.style.height).toBe('700px');
  });

  it('honours custom limits, threshold and throttle', () => {
    sizing.dispose();
    sizing = new FrameSizing({
      frame,
      minWidth: 50,
      maxWidth: 100,
      minHeight: 20,
      maxHeight: 40,
      threshold: 1,
      throttleMs: 10,
    });
    sizing.requestSize(500, 1);
    jasmine.clock().tick(10);
    expect(frame.style.width).toBe('100px');
    expect(frame.style.height).toBe('20px');
    sizing.requestSize(99, 21);
    jasmine.clock().tick(10);
    expect(frame.style.width).toBe('99px');
    expect(frame.style.height).toBe('21px');
  });

  it('drops a pending request on dispose', () => {
    sizing.requestSize(640, 480);
    sizing.dispose();
    jasmine.clock().tick(100);
    expect(frame.style.width).toBe('');
    expect(frame.style.height).toBe('');
  });
});

describe('host context', () => {
  let frame: HTMLIFrameElement;

  beforeEach(() => {
    frame = document.createElement('iframe');
    frame.style.width = '320px';
    frame.style.height = '240px';
    frame.style.border = '0';
    document.body.appendChild(frame);
  });

  afterEach(() => {
    frame.remove();
  });

  it('measures the frame dimensions', () => {
    expect(measureHostContext(frame)).toEqual({containerDimensions: {width: 320, height: 240}});
  });

  it('reports dimension changes until stopped', async () => {
    const contexts: FrameHostContext[] = [];
    let notify: (() => void) | null = null;
    const nextContext = () =>
      new Promise<void>(resolve => {
        notify = resolve;
      });
    const stop = observeHostContext(frame, context => {
      contexts.push(context);
      notify?.();
    });

    await nextContext();
    expect(contexts[0]).toEqual({containerDimensions: {width: 320, height: 240}});

    // Leave the observer's delivery loop before changing the layout, otherwise the browser
    // reports the new observation as an undelivered notification.
    await new Promise(resolve => setTimeout(resolve, 0));
    const resized = nextContext();
    frame.style.width = '400px';
    await resized;
    stop();
    expect(contexts[1]).toEqual({containerDimensions: {width: 400, height: 240}});
  });
});
