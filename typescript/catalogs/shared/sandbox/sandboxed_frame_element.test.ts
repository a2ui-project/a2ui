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
 * These tests load the real sandbox proxy, which the package's Karma configuration serves from
 * `dist/sandbox/` at the default `/a2ui-sandbox/` path.
 */

import {
  AccessibilityAttributesSchema,
  Catalog,
  ComponentContext,
  DynamicNumberSchema,
  MessageProcessor,
  type ComponentApi,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {renderA2uiNode, type WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import {render} from 'lit';
import {z} from 'zod';
import type {SandboxProtocol, SandboxResource} from './sandbox_bootstrap.js';
import {resetSandboxConfig, resolveSandboxUrl, type SandboxMode} from './sandbox_config.js';
import {
  frameHeightFromProp,
  frameTitleFromProps,
  SandboxedFrameElement,
} from './sandboxed_frame_element.js';

const CATALOG_ID = 'https://example.com/catalogs/sandboxed-frame-test.json';
const SURFACE_ID = 'sandboxed-frame-surface';
const COMPONENT_ID = 'frame';

const TestFrameApi = {
  name: 'TestFrame',
  schema: z.object({
    'content': z.string().optional(),
    'height': DynamicNumberSchema.optional(),
    'accessibility': AccessibilityAttributesSchema.optional(),
  }),
} satisfies ComponentApi;

/** One call to `connectFrame` and whether its disconnect function has run. */
interface Connection {
  readonly frame: HTMLIFrameElement;
  readonly sandboxOrigin: string;
  disconnected: boolean;
}

class TestFrameElement extends SandboxedFrameElement<typeof TestFrameApi> {
  protected readonly api = TestFrameApi;
  protected readonly sandboxMode: SandboxMode = 'html';
  protected readonly sandboxProtocol: SandboxProtocol = 'a2ui';

  readonly connections: Connection[] = [];

  protected resolveResource(): SandboxResource | null {
    const {content} = this.controller.props;
    return typeof content === 'string' && content !== '' ? {html: content} : null;
  }

  protected resolveHeight(): number | undefined {
    return frameHeightFromProp(this.controller.props.height);
  }

  protected resolveTitle(): string {
    return frameTitleFromProps(this.controller.props.accessibility, 'Test frame');
  }

  protected connectFrame(frame: HTMLIFrameElement, sandboxOrigin: string): () => void {
    const connection: Connection = {frame, sandboxOrigin, disconnected: false};
    this.connections.push(connection);
    return () => {
      connection.disconnected = true;
    };
  }

  /** Exposes the protected sizing hook to the tests. */
  requestSize(width?: number, height?: number): void {
    this.requestFrameSize(width, height);
  }
}

const TestFrame: WebComponentImplementation = {
  ...TestFrameApi,
  tagName: 'a2ui-test-sandboxed-frame',
  element: TestFrameElement,
};

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 800 && !predicate(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  expect(predicate()).withContext(what).toBeTrue();
}

/** Gives pending messages a chance to arrive when nothing is expected. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

/** The inner frame the proxy created, readable because the proxy page is same-origin. */
function innerFrame(frame: HTMLIFrameElement): HTMLIFrameElement | null {
  return frame.contentDocument?.querySelector('iframe') ?? null;
}

function innerSrcdoc(frame: HTMLIFrameElement): string {
  return innerFrame(frame)?.getAttribute('srcdoc') ?? '';
}

describe('SandboxedFrameElement', () => {
  let container: HTMLDivElement;
  let catalog: Catalog<WebComponentImplementation>;
  let processor: MessageProcessor<WebComponentImplementation>;
  let surface: SurfaceModel;
  let addedListeners: EventListenerOrEventListenerObject[];
  let removedListeners: EventListenerOrEventListenerObject[];

  function componentProps(props: Record<string, unknown>) {
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: SURFACE_ID,
          components: [{id: COMPONENT_ID, component: 'TestFrame', ...props}],
        },
      },
    ]);
  }

  async function renderFrame(props: Record<string, unknown>): Promise<{
    element: TestFrameElement;
    frame: HTMLIFrameElement;
  }> {
    componentProps(props);
    render(renderA2uiNode(new ComponentContext(surface, COMPONENT_ID), catalog), container);
    const element = container.querySelector(TestFrame.tagName);
    expect(element).toBeInstanceOf(TestFrameElement);
    const frameElement = element as TestFrameElement;
    await frameElement.updateComplete;
    const frame = frameElement.querySelector('iframe');
    expect(frame).withContext('the frame is rendered').not.toBeNull();
    return {element: frameElement, frame: frame!};
  }

  beforeEach(() => {
    addedListeners = [];
    removedListeners = [];
    spyOn(window, 'addEventListener')
      .and.callThrough()
      .and.callFake((type: string, listener: EventListenerOrEventListenerObject | null) => {
        if (type === 'message' && listener) {
          addedListeners.push(listener);
        }
        return EventTarget.prototype.addEventListener.call(window, type, listener);
      });
    spyOn(window, 'removeEventListener')
      .and.callThrough()
      .and.callFake((type: string, listener: EventListenerOrEventListenerObject | null) => {
        if (type === 'message' && listener) {
          removedListeners.push(listener);
        }
        return EventTarget.prototype.removeEventListener.call(window, type, listener);
      });

    container = document.createElement('div');
    container.style.width = '600px';
    document.body.appendChild(container);

    catalog = new Catalog<WebComponentImplementation>(CATALOG_ID, [TestFrame]);
    processor = new MessageProcessor([catalog]);
    processor.processMessages([
      {version: 'v0.9', createSurface: {surfaceId: SURFACE_ID, catalogId: CATALOG_ID}},
    ]);
    surface = processor.model.getSurface(SURFACE_ID)!;
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    surface.dispose();
    resetSandboxConfig();
  });

  it('renders the proxy frame in the light DOM, titled and without a sandbox attribute', async () => {
    const {element, frame} = await renderFrame({
      content: '<p>hello</p>',
      accessibility: {label: 'Counter app'},
    });

    expect(element.shadowRoot).toBeNull();
    expect(frame.parentElement).toBe(element);
    expect(frame.src).toBe(resolveSandboxUrl('html').href);
    expect(frame.title).toBe('Counter app');
    expect(frame.hasAttribute('sandbox')).toBeFalse();
    expect(getComputedStyle(element).display).toBe('flex');
  });

  it('falls back to the default title without an accessibility label', async () => {
    const {frame} = await renderFrame({content: '<p>hello</p>', accessibility: {label: '  '}});

    expect(frame.title).toBe('Test frame');
  });

  it('connects the bridge once the frame renders and disconnects it on removal', async () => {
    const {element, frame} = await renderFrame({content: '<p>hello</p>'});

    expect(element.connections.length).toBe(1);
    expect(element.connections[0].frame).toBe(frame);
    expect(element.connections[0].sandboxOrigin).toBe(window.location.origin);
    expect(element.connections[0].disconnected).toBeFalse();
    expect(addedListeners.length).toBeGreaterThan(0);

    render(null, container);

    expect(element.connections[0].disconnected).toBeTrue();
    expect(removedListeners).toEqual(addedListeners);
  });

  it('hands the content to the proxy once it is ready, inside a strictly sandboxed inner frame', async () => {
    const {frame} = await renderFrame({content: '<p id="app">hello</p>'});

    await waitFor(() => innerSrcdoc(frame).includes('<p id="app">hello</p>'), 'inner frame loaded');

    const inner = innerFrame(frame)!;
    const sandbox = inner.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-top-navigation');
    expect(sandbox).not.toContain('allow-popups');
  });

  it('reconnects the bridge and reloads the content when the content changes', async () => {
    const {element, frame} = await renderFrame({content: '<p>first</p>'});
    await waitFor(() => innerSrcdoc(frame).includes('<p>first</p>'), 'first content loaded');

    componentProps({content: '<p>second</p>'});
    await element.updateComplete;

    expect(element.connections.length).toBe(2);
    expect(element.connections[0].disconnected).toBeTrue();
    expect(element.connections[1].disconnected).toBeFalse();
    expect(element.connections[1].frame).toBe(frame);
    await waitFor(() => innerSrcdoc(frame).includes('<p>second</p>'), 'second content loaded');
  });

  it('keeps the bridge when a property other than the content changes', async () => {
    const {element} = await renderFrame({content: '<p>first</p>', height: 200});

    componentProps({content: '<p>first</p>', height: 300});
    await element.updateComplete;

    expect(element.connections.length).toBe(1);
    expect(element.style.height).toBe('300px');
  });

  it('reconnects the bridge when the context changes', async () => {
    const {element} = await renderFrame({content: '<p>first</p>'});

    element.context = new ComponentContext(surface, COMPONENT_ID);
    await element.updateComplete;

    expect(element.connections.length).toBe(2);
    expect(element.connections[0].disconnected).toBeTrue();
  });

  it('ignores ready signals from other windows or other origins', async () => {
    const {frame} = await renderFrame({content: '<p>hello</p>'});
    await waitFor(() => innerSrcdoc(frame) !== '', 'real proxy ready handled');
    const postMessage = spyOn(frame.contentWindow!, 'postMessage');

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {type: 'a2ui_sandbox_proxy_ready'},
        origin: 'https://evil.example',
        source: frame.contentWindow,
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {type: 'a2ui_sandbox_proxy_ready'},
        origin: window.location.origin,
        source: window,
      }),
    );
    await settle();

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('applies the height property and lets the app resize the frame', async () => {
    const {element, frame} = await renderFrame({content: '<p>hello</p>', height: 240});
    expect(element.style.height).toBe('240px');
    expect(frame.style.height).toBe('');

    element.requestSize(undefined, 320);
    await waitFor(() => frame.style.height === '320px', 'app resize applied');
    expect(element.style.height).toBe('320px');

    componentProps({content: '<p>hello</p>', height: 200});
    await element.updateComplete;
    expect(element.style.height).toBe('200px');
    expect(frame.style.height).toBe('');
  });

  it('leaves the height to the stylesheet without a height property', async () => {
    const {element, frame} = await renderFrame({content: '<p>hello</p>'});

    expect(element.style.height).toBe('');
    expect(frame.style.height).toBe('');
    expect(getComputedStyle(element).height).toBe('500px');
  });

  it('ignores heights that are not positive numbers', async () => {
    const {element} = await renderFrame({content: '<p>hello</p>', height: -5});

    expect(element.style.height).toBe('');
  });

  it('starts a new session when the element is attached again', async () => {
    const {element, frame} = await renderFrame({content: '<p>hello</p>'});
    await waitFor(() => innerSrcdoc(frame) !== '', 'first session ready');

    element.remove();
    expect(element.connections[0].disconnected).toBeTrue();

    container.appendChild(element);
    await element.updateComplete;

    expect(element.connections.length).toBe(2);
    expect(element.connections[1].disconnected).toBeFalse();
    await waitFor(() => innerSrcdoc(frame).includes('<p>hello</p>'), 'second session ready');
  });
});
