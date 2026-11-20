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
 * A minimal MCP Apps host for the browser tests: it loads the bundled test app into an iframe
 * under the default MCP Apps CSP and talks to it through the App SDK's `AppBridge`, the way a
 * real host does. The iframe is same-origin, so tests can read its DOM.
 */

import {
  AppBridge,
  PostMessageTransport,
  type McpUiHostCapabilities,
  type McpUiHostContext,
  type McpUiMessageRequest,
  type McpUiSizeChangedNotification,
  type McpUiUpdateModelContextRequest,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {CallToolRequest, CallToolResult} from '@modelcontextprotocol/sdk/types.js';

/** The CSP MCP Apps hosts apply when a resource declares no domains. */
export const DEFAULT_MCP_APPS_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:";

/** The test apps, bundled from `tests/fixtures/<name>.ts`. */
export type TestAppName = 'embed_app' | 'embed_app_plain';

const appScripts = new Map<TestAppName, Promise<string>>();

function loadAppScript(name: TestAppName): Promise<string> {
  let script = appScripts.get(name);
  if (!script) {
    const url = `/a2ui-fixtures/${name}.js`;
    script = fetch(url).then(response => {
      if (!response.ok) {
        throw new Error(`The test app is not served at ${url}; run build:test-fixtures.`);
      }
      return response.text();
    });
    appScripts.set(name, script);
  }
  return script;
}

/** Options of {@link EmbedTestHost.start}. */
export interface EmbedTestHostOptions {
  capabilities?: McpUiHostCapabilities;
  hostContext?: McpUiHostContext;
  /** The test app to load. Optional (default: `'embed_app'`, with the markdown renderer). */
  app?: TestAppName;
}

export const DEFAULT_CAPABILITIES: McpUiHostCapabilities = {
  serverTools: {},
  message: {text: {}},
  updateModelContext: {text: {}},
  openLinks: {},
};

/** A test host with one app iframe. */
export class EmbedTestHost {
  readonly toolCalls: CallToolRequest['params'][] = [];
  readonly messages: McpUiMessageRequest['params'][] = [];
  readonly sizes: McpUiSizeChangedNotification['params'][] = [];
  readonly modelContexts: McpUiUpdateModelContextRequest['params'][] = [];
  readonly openedLinks: string[] = [];
  /** Answers the app's `tools/call` requests. Defaults to an error result. */
  onToolCall: (params: CallToolRequest['params']) => Promise<CallToolResult> = async () => ({
    content: [{type: 'text', text: 'No tool handler.'}],
    isError: true,
  });

  private constructor(
    readonly iframe: HTMLIFrameElement,
    readonly bridge: AppBridge,
  ) {}

  /** Loads the test app and waits for its handshake. */
  static async start(options: EmbedTestHostOptions = {}): Promise<EmbedTestHost> {
    const script = await loadAppScript(options.app ?? 'embed_app');
    const iframe = document.createElement('iframe');
    iframe.style.width = '600px';
    iframe.srcdoc = [
      '<!doctype html>',
      '<html>',
      '<head>',
      '<meta charset="utf-8" />',
      `<meta http-equiv="Content-Security-Policy" content="${DEFAULT_MCP_APPS_CSP}" />`,
      '<script>',
      'window.cspViolations = [];',
      "document.addEventListener('securitypolicyviolation', event => {",
      "  window.cspViolations.push(event.violatedDirective + ' ' + event.blockedURI);",
      '});',
      '</script>',
      '</head>',
      `<body><script>${script}</script></body>`,
      '</html>',
    ].join('\n');
    document.body.append(iframe);

    const bridge = new AppBridge(
      null,
      {name: 'embed-test-host', version: '0.0.0'},
      options.capabilities ?? DEFAULT_CAPABILITIES,
      {hostContext: options.hostContext ?? {theme: 'light', displayMode: 'inline'}},
    );
    const host = new EmbedTestHost(iframe, bridge);
    bridge.oncalltool = async params => {
      host.toolCalls.push(params);
      return host.onToolCall(params);
    };
    bridge.onmessage = async params => {
      host.messages.push(params);
      return {};
    };
    bridge.onupdatemodelcontext = async params => {
      host.modelContexts.push(params);
      return {};
    };
    bridge.onopenlink = async ({url}) => {
      host.openedLinks.push(url);
      return {};
    };
    bridge.onsizechange = params => {
      host.sizes.push(params);
    };
    const initialized = new Promise<void>(resolve => {
      bridge.oninitialized = () => resolve();
    });
    const contentWindow = iframe.contentWindow!;
    await bridge.connect(new PostMessageTransport(contentWindow, contentWindow));
    await initialized;
    return host;
  }

  /** The app's document. */
  get document(): Document {
    return this.iframe.contentDocument!;
  }

  /** The CSP violations the app's document reported. */
  get cspViolations(): string[] {
    return (this.iframe.contentWindow as unknown as {cspViolations: string[]}).cspViolations;
  }

  /** Sends a tool result whose `structuredContent.a2ui` is `payload`. */
  async sendPayload(payload: unknown, text = 'Summary for the model.'): Promise<void> {
    await this.bridge.sendToolResult({
      content: [{type: 'text', text}],
      structuredContent: {a2ui: payload},
    });
  }

  async dispose(): Promise<void> {
    await this.bridge.close();
    this.iframe.remove();
  }
}

/** Finds the first element matching `selector` in `root` or in any shadow root below it. */
export function deepQuery(root: ParentNode, selector: string): HTMLElement | null {
  const direct = root.querySelector<HTMLElement>(selector);
  if (direct) {
    return direct;
  }
  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (element.shadowRoot) {
      const found = deepQuery(element.shadowRoot, selector);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/** The text of `root`, including the text inside shadow roots. */
export function deepText(root: Node): string {
  let text = '';
  if (root.nodeType === Node.TEXT_NODE) {
    return root.textContent ?? '';
  }
  if (root instanceof Element && root.shadowRoot) {
    text += deepText(root.shadowRoot);
  }
  for (const child of Array.from(root.childNodes)) {
    text += deepText(child);
  }
  return text;
}

/** Polls `predicate` until it returns a truthy value. */
export async function waitFor<T>(
  predicate: () => T | null | undefined | false,
  description: string,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}.`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
