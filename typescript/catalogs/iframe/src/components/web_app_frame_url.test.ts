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
 * These tests point the sandbox at an inert same-origin page and play the proxy and the
 * application themselves, so the example's external URL is never loaded. The scenarios under
 * `tests/` exercise the real proxy.
 */

import example from '../../../../../catalogs/iframe/examples/01_url-frame.json' with {type: 'json'};
import {DEFAULT_INNER_SANDBOX} from '../shared/sandbox/sandbox.js';
import {
  configureSandbox,
  resetSandboxConfig,
  resolveSandboxUrl,
} from '../shared/sandbox/sandbox_config.js';
import {
  catalogPropertyNames,
  FrameTestHarness,
  openFrameInbox,
  parseExampleMessages,
  postFromFrame,
  settle,
  type FrameInbox,
} from '../testing/frame_test_support.js';
import {A2uiWebAppFrameUrl, resolveWebAppUrl, WebAppFrameUrlApi} from './web_app_frame_url.js';

const SURFACE_ID = 'gallery-iframe-url-frame';
const COMPONENT_ID = 'order_tracker';
const EXAMPLE_URL = 'https://example.com/a2ui-apps/order-tracker/';

describe('resolveWebAppUrl', () => {
  it('appends the host origin to http and https URLs and keeps their own query', () => {
    expect(resolveWebAppUrl('https://apps.example/tracker/?tab=open', 'https://host.example')).toBe(
      'https://apps.example/tracker/?tab=open&origin=https%3A%2F%2Fhost.example',
    );
    expect(resolveWebAppUrl('http://localhost:8080/app', 'https://host.example')).toBe(
      'http://localhost:8080/app?origin=https%3A%2F%2Fhost.example',
    );
  });

  it('defaults the origin to the page origin', () => {
    expect(resolveWebAppUrl(EXAMPLE_URL)).toBe(
      `${EXAMPLE_URL}?origin=${encodeURIComponent(window.location.origin)}`,
    );
  });

  it('rejects other schemes, relative and malformed URLs, and non-strings', () => {
    for (const rejected of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://files.example/app',
      '/relative/app',
      'not a url',
      '',
      undefined,
      42,
    ]) {
      expect(resolveWebAppUrl(rejected, 'https://host.example'))
        .withContext(String(rejected))
        .toBeNull();
    }
  });
});

describe('WebAppFrameUrl', () => {
  let harness: FrameTestHarness;
  let inbox: FrameInbox | null;

  const exampleComponent = () => {
    const components = example.messages.flatMap(
      message => message.updateComponents?.components ?? [],
    );
    return components.find(component => component.id === COMPONENT_ID)!;
  };

  async function renderExample() {
    const element = await harness.renderComponent(COMPONENT_ID);
    const frame = element.querySelector('iframe')!;
    expect(frame).withContext('the frame is rendered').not.toBeNull();
    return {element, frame};
  }

  beforeEach(() => {
    configureSandbox({baseUrl: '/a2ui-fixtures/inert/'});
    harness = new FrameTestHarness(SURFACE_ID, parseExampleMessages(example));
    inbox = null;
  });

  afterEach(() => {
    inbox?.dispose();
    harness.dispose();
    resetSandboxConfig();
  });

  it('declares exactly the properties of the catalog schema', () => {
    expect(Object.keys(WebAppFrameUrlApi.schema.shape).sort()).toEqual(
      catalogPropertyNames('WebAppFrameUrl'),
    );
    expect(A2uiWebAppFrameUrl.name).toBe('WebAppFrameUrl');
    expect(A2uiWebAppFrameUrl.tagName).toBe('a2ui-web-app-frame-url');
  });

  it('renders the URL-mode proxy frame with the height of the example and a default title', async () => {
    const {element, frame} = await renderExample();

    expect(element.tagName.toLowerCase()).toBe('a2ui-web-app-frame-url');
    expect(element.shadowRoot).toBeNull();
    expect(frame.src).toBe(resolveSandboxUrl('url').href);
    expect(frame.hasAttribute('sandbox')).toBeFalse();
    expect(frame.title).toBe('Embedded web application');
    expect(element.style.height).toBe('400px');
  });

  it('answers the proxy with the URL, the host origin appended, and the strict sandbox flags', async () => {
    const {frame} = await renderExample();
    inbox = await openFrameInbox(frame, resolveSandboxUrl('url').href);

    postFromFrame(frame, {type: 'a2ui_sandbox_proxy_ready'});

    const ready = await inbox.next('a2ui_sandbox_resource_ready');
    expect(ready.data).toEqual({
      type: 'a2ui_sandbox_resource_ready',
      url: `${EXAMPLE_URL}?origin=${encodeURIComponent(window.location.origin)}`,
      sandbox: DEFAULT_INNER_SANDBOX,
    });
    expect(ready.data.sandbox).not.toContain('allow-same-origin');
  });

  it('answers the app with its configuration and data on a transferred port', async () => {
    const {frame} = await renderExample();
    inbox = await openFrameInbox(frame, resolveSandboxUrl('url').href);

    postFromFrame(frame, {type: 'a2ui_app_frame_ready'});

    const init = await inbox.next('a2ui_app_frame_init');
    expect(init.ports.length).toBe(1);
    expect(init.data.value).toEqual({
      config: {theme: 'light', locale: 'en-US'},
      initialData: {
        orders: [
          {id: 'A-1001', status: 'shipped'},
          {id: 'A-1002', status: 'processing'},
        ],
      },
      allowedEvents: {order_selected: jasmine.any(Object)},
      allowedFunctions: {},
      mutableDataKeys: [],
      hostContext: {containerDimensions: {width: jasmine.any(Number), height: jasmine.any(Number)}},
    });
    init.ports[0].close();
  });

  it('ignores handshake messages from other origins or other windows', async () => {
    const {frame} = await renderExample();
    inbox = await openFrameInbox(frame, resolveSandboxUrl('url').href);

    postFromFrame(frame, {type: 'a2ui_sandbox_proxy_ready'}, 'https://evil.example');
    postFromFrame(frame, {type: 'a2ui_app_frame_ready'}, 'https://evil.example');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {type: 'a2ui_app_frame_ready'},
        origin: window.location.origin,
        source: window,
      }),
    );
    await settle();

    expect(inbox.messages.length).toBe(0);
  });

  it('loads the new URL when the property changes', async () => {
    const {element, frame} = await renderExample();
    inbox = await openFrameInbox(frame, resolveSandboxUrl('url').href);
    postFromFrame(frame, {type: 'a2ui_sandbox_proxy_ready'});
    await inbox.next('a2ui_sandbox_resource_ready');

    harness.updateComponent({...exampleComponent(), url: 'https://apps.example/other-app/'});
    await element.updateComplete;

    const ready = await inbox.next('a2ui_sandbox_resource_ready', 1);
    expect(ready.data.url).toBe(
      `https://apps.example/other-app/?origin=${encodeURIComponent(window.location.origin)}`,
    );
  });

  it('loads nothing for a URL that is not http or https, and warns once about it', async () => {
    const warn = spyOn(console, 'warn');
    const {element, frame} = await renderExample();
    inbox = await openFrameInbox(frame, resolveSandboxUrl('url').href);
    postFromFrame(frame, {type: 'a2ui_sandbox_proxy_ready'});
    await inbox.next('a2ui_sandbox_resource_ready');

    harness.updateComponent({...exampleComponent(), url: 'javascript:alert(1)'});
    await element.updateComplete;
    harness.updateComponent({...exampleComponent(), url: 'javascript:alert(1)', height: 300});
    await element.updateComplete;
    await settle();

    expect(inbox.ofType('a2ui_sandbox_resource_ready').length).toBe(1);
    const warnings = warn.calls
      .allArgs()
      .filter(args => String(args[0]).includes('javascript:alert(1)'));
    expect(warnings.length).toBe(1);
    expect(element.style.height).toBe('300px');
  });

  it('keeps the same frame and connection when only the height changes', async () => {
    const {element, frame} = await renderExample();
    inbox = await openFrameInbox(frame, resolveSandboxUrl('url').href);
    postFromFrame(frame, {type: 'a2ui_sandbox_proxy_ready'});
    await inbox.next('a2ui_sandbox_resource_ready');

    harness.updateComponent({...exampleComponent(), height: 250});
    await element.updateComplete;
    await settle();

    expect(element.querySelector('iframe')).toBe(frame);
    expect(element.style.height).toBe('250px');
    expect(inbox.ofType('a2ui_sandbox_resource_ready').length).toBe(1);
  });
});
