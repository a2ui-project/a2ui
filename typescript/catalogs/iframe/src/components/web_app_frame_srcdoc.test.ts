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
 * application themselves, over the real port the component transfers. The scenarios under
 * `tests/` exercise the real proxy and a real application.
 */

import example from '../../../../../catalogs/iframe/examples/00_srcdoc-shared-counter.json' with {type: 'json'};
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
  waitFor,
  type FrameInbox,
} from '../testing/frame_test_support.js';
import {SRCDOC_CONTENT_SECURITY_POLICY} from './srcdoc_content.js';
import {A2uiWebAppFrameSrcdoc, WebAppFrameSrcdocApi} from './web_app_frame_srcdoc.js';

const SURFACE_ID = 'gallery-iframe-shared-counter';
const COMPONENT_ID = 'counter_app';
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${SRCDOC_CONTENT_SECURITY_POLICY}">`;

describe('WebAppFrameSrcdoc', () => {
  let harness: FrameTestHarness;
  let inbox: FrameInbox | null;
  let appPort: MessagePort | null;

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
    inbox = await openFrameInbox(frame, resolveSandboxUrl('html').href);
    return {element, frame, inbox};
  }

  /** Plays the application's ready signal and returns its end of the transferred port. */
  async function connectApp(frame: HTMLIFrameElement, messages: FrameInbox) {
    postFromFrame(frame, {type: 'a2ui_app_frame_ready'});
    const init = await messages.next('a2ui_app_frame_init');
    appPort = init.ports[0];
    const received: unknown[] = [];
    appPort.onmessage = event => {
      received.push(event.data);
    };
    return {init, port: appPort, received};
  }

  beforeEach(() => {
    configureSandbox({baseUrl: '/a2ui-fixtures/inert/'});
    harness = new FrameTestHarness(SURFACE_ID, parseExampleMessages(example));
    inbox = null;
    appPort = null;
  });

  afterEach(() => {
    appPort?.close();
    inbox?.dispose();
    harness.dispose();
    resetSandboxConfig();
  });

  it('declares exactly the properties of the catalog schema', () => {
    expect(Object.keys(WebAppFrameSrcdocApi.schema.shape).sort()).toEqual(
      catalogPropertyNames('WebAppFrameSrcdoc'),
    );
    expect(A2uiWebAppFrameSrcdoc.name).toBe('WebAppFrameSrcdoc');
    expect(A2uiWebAppFrameSrcdoc.tagName).toBe('a2ui-web-app-frame-srcdoc');
  });

  it('renders the HTML-mode proxy frame with the height of the example', async () => {
    const {element, frame} = await renderExample();

    expect(element.tagName.toLowerCase()).toBe('a2ui-web-app-frame-srcdoc');
    expect(element.shadowRoot).toBeNull();
    expect(frame.src).toBe(resolveSandboxUrl('html').href);
    expect(frame.hasAttribute('sandbox')).toBeFalse();
    expect(frame.title).toBe('Embedded web application');
    expect(element.style.height).toBe('160px');
  });

  it('uses the accessibility label as the frame title', async () => {
    const {element, frame} = await renderExample();

    harness.updateComponent({...exampleComponent(), accessibility: {label: 'Shared counter'}});
    await element.updateComplete;

    expect(frame.title).toBe('Shared counter');
  });

  it('answers the proxy with the markup, secured, and the strict sandbox flags', async () => {
    const {frame, inbox: messages} = await renderExample();

    postFromFrame(frame, {type: 'a2ui_sandbox_proxy_ready'});

    const ready = await messages.next('a2ui_sandbox_resource_ready');
    const html: string = ready.data.html;
    expect(html).toContain(CSP_META);
    expect(html.indexOf(CSP_META)).toBeLessThan(html.indexOf('<style>'));
    expect(html).toContain('<button id="add" disabled="">Add one</button>');
    expect(ready.data.htmlContent).toBe(html);
    expect(ready.data.sandbox).toBe(DEFAULT_INNER_SANDBOX);
    expect(ready.data.sandbox).not.toContain('allow-same-origin');
    expect(ready.data.url).toBeUndefined();
  });

  it('decodes url_encoded content and reloads when the content changes', async () => {
    const {element, frame, inbox: messages} = await renderExample();
    postFromFrame(frame, {type: 'a2ui_sandbox_proxy_ready'});
    await messages.next('a2ui_sandbox_resource_ready');

    harness.updateComponent({
      ...exampleComponent(),
      htmlContent: `url_encoded:${encodeURIComponent('<p>Ünïcödé & <b>bold</b></p>')}`,
    });
    await element.updateComplete;

    const ready = await messages.next('a2ui_sandbox_resource_ready', 1);
    expect(ready.data.html).toContain('<p>Ünïcödé &amp; <b>bold</b></p>');
    expect(ready.data.html).toContain(CSP_META);
    expect(element.querySelector('iframe')).toBe(frame);
  });

  it('loads nothing for empty content', async () => {
    const {element, frame, inbox: messages} = await renderExample();
    postFromFrame(frame, {type: 'a2ui_sandbox_proxy_ready'});
    await messages.next('a2ui_sandbox_resource_ready');

    harness.updateComponent({...exampleComponent(), htmlContent: ''});
    await element.updateComplete;
    await settle();

    expect(messages.ofType('a2ui_sandbox_resource_ready').length).toBe(1);
  });

  it('hands the app the bound data and the allowlists of the example', async () => {
    const {frame, inbox: messages} = await renderExample();

    const {init} = await connectApp(frame, messages);

    expect(init.data.value).toEqual({
      config: {},
      initialData: {count: 0, label: 'clicks'},
      allowedEvents: {counter_saved: jasmine.any(Object)},
      allowedFunctions: {},
      mutableDataKeys: ['count'],
      hostContext: {containerDimensions: {width: jasmine.any(Number), height: jasmine.any(Number)}},
    });
  });

  it('writes the app data changes that mutableData allows into the surface data model', async () => {
    const {frame, inbox: messages} = await renderExample();
    const {port} = await connectApp(frame, messages);

    port.postMessage({type: 'a2ui_data_model_change', key: 'count', value: 3});
    await waitFor(() => harness.surface.dataModel.get('/counter/count') === 3, 'count written');

    port.postMessage({type: 'a2ui_data_model_change', key: 'label', value: 'taps'});
    port.postMessage({type: 'a2ui_data_model_change', key: 'count', value: -1});
    await settle();

    expect(harness.surface.dataModel.get('/counter/label')).toBe('clicks');
    expect(harness.surface.dataModel.get('/counter/count')).toBe(3);
  });

  it('pushes surface data changes to the app', async () => {
    const {frame, inbox: messages} = await renderExample();
    const {received} = await connectApp(frame, messages);

    harness.setData('/counter/count', 7);
    await waitFor(
      () => received.some(message => JSON.stringify(message).includes('"count"')),
      'update received',
    );

    expect(received).toContain({type: 'a2ui_data_model_update', key: 'count', value: 7});
  });

  it('forwards the actions that allowedEvents lists, from the component, and drops the rest', async () => {
    const {frame, inbox: messages} = await renderExample();
    const {port} = await connectApp(frame, messages);

    port.postMessage({type: 'a2ui_action', action: 'not_declared', data: {count: 1}});
    port.postMessage({type: 'a2ui_action', action: 'counter_saved', data: {count: 'one'}});
    port.postMessage({type: 'a2ui_action', action: 'counter_saved', data: {count: 4}});

    const action = await harness.nextAction('counter_saved');
    expect(action.context).toEqual({count: 4});
    expect(action.sourceComponentId).toBe(COMPONENT_ID);
    expect(action.surfaceId).toBe(SURFACE_ID);
    await settle();
    expect(harness.actions.length).toBe(1);
  });

  it('only accepts protocol messages on the port, not on the window', async () => {
    const {frame, inbox: messages} = await renderExample();
    await connectApp(frame, messages);

    postFromFrame(frame, {type: 'a2ui_action', action: 'counter_saved', data: {count: 4}});
    postFromFrame(frame, {type: 'a2ui_data_model_change', key: 'count', value: 9});
    await settle();

    expect(harness.actions.length).toBe(0);
    expect(harness.surface.dataModel.get('/counter/count')).toBe(0);
  });

  it('closes the channel when the element is removed', async () => {
    const {frame, inbox: messages} = await renderExample();
    const {port} = await connectApp(frame, messages);

    harness.clear();
    port.postMessage({type: 'a2ui_data_model_change', key: 'count', value: 3});
    await settle();

    expect(harness.surface.dataModel.get('/counter/count')).toBe(0);
  });
});
