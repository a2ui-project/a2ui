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
 * Real-frame scenarios. The components load the real sandbox proxy from `/a2ui-sandbox/`, which
 * Karma serves from `dist/sandbox/`, and a real application, `fixtures/apps/test_app.html`,
 * served from `/a2ui-fixtures/`. The application reports what it receives as actions and takes
 * its commands from the data model, so the tests never reach into the sandboxed frame; see the
 * fixture for the commands.
 */

import {IFRAME_CATALOG_ID} from '../src/catalog.js';
import {SRCDOC_CONTENT_SECURITY_POLICY} from '../src/components/srcdoc_content.js';
import {DEFAULT_INNER_SANDBOX} from '../src/shared/sandbox/sandbox.js';
import {
  resetSandboxConfig,
  resolveSandboxUrl,
  type SandboxMode,
} from '../src/shared/sandbox/sandbox_config.js';
import {
  FrameTestHarness,
  innerFrameOf,
  parseExampleMessages,
  settle,
  waitFor,
} from '../src/testing/frame_test_support.js';

const SURFACE_ID = 'frame-scenarios';
const COMPONENT_ID = 'app';
const APP_URL = new URL('/a2ui-fixtures/apps/test_app.html', window.location.origin).href;
const ANY_OBJECT = {type: 'object'};

/** The actions the fixture application reports, plus one with a strict payload. */
const APP_EVENTS = {
  app_ready: ANY_OBJECT,
  data_seen: ANY_OBJECT,
  function_result: ANY_OBJECT,
  host_context: ANY_OBJECT,
  navigate_top_result: ANY_OBJECT,
  unknown_command: ANY_OBJECT,
  saved: {
    type: 'object',
    properties: {count: {type: 'integer'}},
    required: ['count'],
    additionalProperties: false,
  },
};

type Content = {readonly url: string} | {readonly htmlContent: string};

function surfaceMessages(content: Content) {
  return parseExampleMessages({
    messages: [
      {version: 'v0.9', createSurface: {surfaceId: SURFACE_ID, catalogId: IFRAME_CATALOG_ID}},
      {
        version: 'v0.9',
        updateDataModel: {surfaceId: SURFACE_ID, value: {counter: {count: 1, label: 'clicks'}}},
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: SURFACE_ID,
          components: [
            {
              id: COMPONENT_ID,
              component: 'url' in content ? 'WebAppFrameUrl' : 'WebAppFrameSrcdoc',
              ...content,
              height: 240,
              config: {theme: 'dark'},
              data: {
                paths: {count: '/counter/count', label: '/counter/label', command: '/command'},
              },
              mutableData: {count: {type: 'integer', minimum: 0}},
              allowedEvents: APP_EVENTS,
              allowedFunctions: {
                add: {
                  type: 'object',
                  properties: {a: {type: 'number'}, b: {type: 'number'}},
                  required: ['a', 'b'],
                  additionalProperties: false,
                },
              },
            },
          ],
        },
      },
    ],
  });
}

interface Scenario {
  readonly component: string;
  readonly mode: SandboxMode;
  readonly content: (appHtml: string) => Content;
}

const SCENARIOS: readonly Scenario[] = [
  {component: 'WebAppFrameSrcdoc', mode: 'html', content: appHtml => ({htmlContent: appHtml})},
  {component: 'WebAppFrameUrl', mode: 'url', content: () => ({url: APP_URL})},
];

describe('WebAppFrame components with the real sandbox proxy', () => {
  let appHtml: string;
  let harness: FrameTestHarness;
  let commandSequence = 0;
  const pageHref = window.location.href;

  beforeAll(async () => {
    const response = await fetch(APP_URL);
    expect(response.ok).withContext('fixture app served').toBeTrue();
    appHtml = await response.text();
  });

  afterEach(() => {
    harness.dispose();
    resetSandboxConfig();
  });

  /** Sends a command to the application by writing it to the bound `command` path. */
  function command(payload: Record<string, unknown>): void {
    harness.setData('/command', JSON.stringify({...payload, seq: ++commandSequence}));
  }

  async function startApp(content: Content) {
    harness = new FrameTestHarness(SURFACE_ID, surfaceMessages(content));
    const element = await harness.renderComponent(COMPONENT_ID);
    const frame = element.querySelector('iframe')!;
    const ready = await harness.nextAction('app_ready');
    return {element, frame, ready};
  }

  for (const scenario of SCENARIOS) {
    describe(scenario.component, () => {
      it('boots the application through the proxy and completes the handshake', async () => {
        const {frame, ready} = await startApp(scenario.content(appHtml));

        expect(frame.src).toBe(resolveSandboxUrl(scenario.mode).href);
        expect(frame.hasAttribute('sandbox')).toBeFalse();
        expect(ready.surfaceId).toBe(SURFACE_ID);
        expect(ready.sourceComponentId).toBe(COMPONENT_ID);
        expect(ready.context['config']).toEqual({theme: 'dark'});
        expect(ready.context['initialData']).toEqual(
          jasmine.objectContaining({count: 1, label: 'clicks'}),
        );
        expect(ready.context['allowedEvents']).toEqual(Object.keys(APP_EVENTS));
        expect(ready.context['allowedFunctions']).toEqual(['add']);
        expect(ready.context['mutableDataKeys']).toEqual(['count']);
        expect(ready.context['hostContext']).toEqual({
          containerDimensions: {width: jasmine.any(Number), height: jasmine.any(Number)},
        });
      });

      it('runs the application in an inner frame without allow-same-origin', async () => {
        const {frame, ready} = await startApp(scenario.content(appHtml));

        const inner = innerFrameOf(frame)!;
        expect(inner).not.toBeNull();
        expect(inner.getAttribute('sandbox')).toBe(DEFAULT_INNER_SANDBOX);
        expect(inner.getAttribute('sandbox')).not.toContain('allow-same-origin');
        expect(inner.getAttribute('sandbox')).not.toContain('allow-top-navigation');
        const location = ready.context['location'] as {href: string; search: string};
        if ('url' in scenario.content(appHtml)) {
          const expectedUrl = `${APP_URL}?origin=${encodeURIComponent(window.location.origin)}`;
          expect(inner.src).toBe(expectedUrl);
          expect(location.href).toBe(expectedUrl);
        } else {
          expect(inner.getAttribute('srcdoc')).toContain(
            `<meta http-equiv="Content-Security-Policy" content="${SRCDOC_CONTENT_SECURITY_POLICY}">`,
          );
          expect(inner.hasAttribute('src')).toBeFalse();
          expect(location.href).toBe('about:srcdoc');
        }
      });

      it('carries actions, data changes and function calls over the channel', async () => {
        await startApp(scenario.content(appHtml));

        command({kind: 'action', action: 'saved', data: {count: 2}});
        const saved = await harness.nextAction('saved');
        expect(saved.context).toEqual({count: 2});
        expect(saved.sourceComponentId).toBe(COMPONENT_ID);

        harness.setData('/counter/count', 5);
        const seen = await harness.nextAction('data_seen');
        expect(seen.context).toEqual(jasmine.objectContaining({key: 'count', value: 5}));

        command({kind: 'set', key: 'count', value: 6});
        await waitFor(
          () => harness.surface.dataModel.get('/counter/count') === 6,
          'count written by the application',
        );

        command({kind: 'call', call: 'add', callId: 'sum-1', args: {a: 3, b: 4}});
        const result = await harness.nextAction('function_result');
        expect(result.context).toEqual(
          jasmine.objectContaining({call: 'add', callId: 'sum-1', status: 'success', result: 7}),
        );
      });

      it('resizes the frame when the application asks, within the limits', async () => {
        const {element, frame} = await startApp(scenario.content(appHtml));
        expect(element.style.height).toBe('240px');

        command({kind: 'resize', height: 320});
        await waitFor(() => frame.style.height === '320px', 'frame resized');
        expect(element.style.height).toBe('320px');

        command({kind: 'resize', height: 99999});
        await waitFor(() => frame.style.height === '2000px', 'height clamped');
      });

      it('drops what the allowlists do not cover', async () => {
        await startApp(scenario.content(appHtml));

        command({kind: 'action', action: 'not_declared', data: {}});
        command({kind: 'action', action: 'saved', data: {count: 'two'}});
        command({kind: 'set', key: 'label', value: 'taps'});
        command({kind: 'set', key: 'count', value: -1});
        command({kind: 'call', call: 'multiply', callId: 'mul-1', args: {a: 2, b: 3}});

        const result = await harness.nextAction('function_result');
        expect(result.context).toEqual(
          jasmine.objectContaining({
            callId: 'mul-1',
            status: 'error',
            error: jasmine.objectContaining({code: 'NOT_ALLOWED'}),
          }),
        );
        await settle();
        expect(harness.actionsNamed('not_declared').length).toBe(0);
        expect(harness.actionsNamed('saved').length).toBe(0);
        expect(harness.surface.dataModel.get('/counter/label')).toBe('clicks');
        expect(harness.surface.dataModel.get('/counter/count')).toBe(1);
      });

      it('only accepts protocol messages on the port, not on the window', async () => {
        await startApp(scenario.content(appHtml));

        command({kind: 'ambient_action', action: 'saved', data: {count: 3}});
        command({kind: 'action', action: 'saved', data: {count: 4}});

        const saved = await harness.nextAction('saved');
        expect(saved.context).toEqual({count: 4});
        expect(harness.actionsNamed('saved').length).toBe(1);
      });

      it('keeps the application from navigating the host page', async () => {
        await startApp(scenario.content(appHtml));

        command({kind: 'navigate_top', url: 'about:blank'});

        const result = await harness.nextAction('navigate_top_result');
        expect(result.context).toEqual({blocked: true, error: 'SecurityError'});
        expect(window.location.href).toBe(pageHref);
      });
    });
  }
});
