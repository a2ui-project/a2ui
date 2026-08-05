/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {html, css} from 'lit';
import {property, query, state} from 'lit/decorators.js';
import {Root} from '@a2ui/lit/ui';
import {v0_8} from '@a2ui/lit';
import {AppBridge, PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {McpUiSandboxProxyReadyNotification} from '@modelcontextprotocol/ext-apps/app-bridge';
import {SANDBOX_IFRAME_PATH} from '../shared-constants.js';

export class McpApp extends Root {
  static override styles = [
    ...Root.styles,
    css`
      :host {
        display: block;
        width: 100%;
        border: 1px solid var(--p-60, #eee);
        position: relative;
        overflow: hidden; /* For Aspect Ratio / Container */
        border-radius: 8px;
        background: #fff;
      }
      iframe {
        width: 100%;
        height: 100%;
        border: none;
        background: #f5f5f5;
        transition:
          height 0.3s ease-out,
          min-width 0.3s ease-out;
      }
    `,
  ];

  /* --- Properties (Server Contract) --- */

  @property({type: String})
  accessor resourceUri: string = '';

  @property({type: String})
  accessor htmlContent: string = '';

  @property({type: Number})
  accessor height: number | undefined = undefined;

  @property({type: Array})
  accessor allowedTools: string[] = [];

  // --- Internal State ---

  @query('iframe')
  accessor iframe!: HTMLIFrameElement;

  private bridge?: AppBridge;

  override render() {
    // Default to aspect ratio if no height. Use 16:9 or 4:3.
    const style = this.height ? `height: ${this.height}px;` : 'aspect-ratio: 4/3;';

    return html`
      <div style="position: relative; width: 100%; ${style}">
        <iframe
          id="mcp-sandbox"
          referrerpolicy="origin"
          sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
        ></iframe>
      </div>
    `;
  }

  override updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);
    if (!this.bridge && this.htmlContent && this.iframe) {
      this.initializeSandbox();
    }
  }

  override disconnectedCallback() {
    if (this.bridge) {
      this.bridge.close();
      this.bridge = undefined;
    }
    super.disconnectedCallback();
  }

  private async initializeSandbox() {
    if (!this.iframe || !this.htmlContent) return;

    // Allow configuring the sandbox URL via env var for production deployment
    // Fall back to the 127.0.0.1 trick for local development to simulate cross-origin isolation
    const meta = import.meta as any;
    const configuredSandboxUrl = meta && meta.env ? meta.env.VITE_MCP_SANDBOX_URL : undefined;
    const sandboxOrigin =
      configuredSandboxUrl || `http://127.0.0.1:${window.location.port}${SANDBOX_IFRAME_PATH}`;
    const sandboxUrl = new URL(sandboxOrigin);

    // Set up the bridge. No MCP client needed because A2UI acts as the orchestrator.
    this.bridge = new AppBridge(
      null,
      {name: 'A2UI Client Host', version: '1.0.0'},
      {
        serverTools: {},
        updateModelContext: {text: {}},
      },
      {
        hostContext: {
          theme: 'light',
          platform: 'web',
          displayMode: 'inline',
        },
      },
    );

    this.bridge.onsizechange = ({width, height}) => {
      // Allow the view to dynamically resize the iframe container
      const from: Keyframe = {};
      const to: Keyframe = {};

      if (width !== undefined) {
        from.minWidth = `${this.iframe.offsetWidth}px`;
        this.iframe.style.minWidth = to.minWidth = `min(${width}px, 100%)`;
      }
      if (height !== undefined) {
        from.height = `${this.iframe.offsetHeight}px`;
        this.iframe.style.height = to.height = `${height}px`;
      }
      this.iframe.animate([from, to], {duration: 300, easing: 'ease-out'});
    };

    // Forward Tool Calls to the A2UI Action Dispatch
    this.bridge.oncalltool = async params => {
      const actionName = params.name;
      const args = params.arguments || {};

      if (this.allowedTools.includes(actionName)) {
        this.dispatchAgentAction(actionName, args);
        return {content: [{type: 'text', text: 'Action dispatched to A2UI Agent'}]};
      } else {
        console.warn(`[McpApp] Tool '${actionName}' blocked.`);
        throw new Error('Tool not allowed');
      }
    };

    this.bridge.onloggingmessage = params => {
      console.log(`[MCP Sandbox ${params.level}]:`, params.data);
    };

    // 1. Listen for the Outer Iframe to declare itself ready.
    const readyNotification: McpUiSandboxProxyReadyNotification['method'] =
      'ui/notifications/sandbox-proxy-ready';
    const proxyReady = new Promise<boolean>(resolve => {
      const listener = ({source, data, origin}: MessageEvent) => {
        if (
          source === this.iframe.contentWindow &&
          origin === sandboxUrl.origin &&
          data?.method === readyNotification
        ) {
          window.removeEventListener('message', listener);
          resolve(true);
        }
      };
      window.addEventListener('message', listener);
    });

    // 2. Load the proxy iframe.
    this.iframe.src = sandboxUrl.href;
    await proxyReady;
    console.log('[McpApp] proxyReady resolved');

    // 3. Connect AppBridge via PostMessage transport.
    // We pass iframe.contentWindow to target just the sandbox proxy.
    await this.bridge.connect(
      new PostMessageTransport(this.iframe.contentWindow!, this.iframe.contentWindow!),
    );

    // 4. Send the Inner HTML UI resource to the sandbox to spin up the actual app.
    await this.bridge.sendSandboxResourceReady({
      html: this.htmlContent,
      sandbox: 'allow-scripts allow-forms allow-popups allow-modals allow-same-origin',
    });
  }

  private dispatchAgentAction(actionName: string, params: any) {
    const context: v0_8.Types.Action['context'] = [];
    if (params && typeof params === 'object') {
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string') {
          context.push({key, value: {literalString: value}});
        } else if (typeof value === 'number') {
          context.push({key, value: {literalNumber: value}});
        } else if (typeof value === 'boolean') {
          context.push({key, value: {literalBoolean: value}});
        } else if (value !== null && typeof value === 'object') {
          context.push({key, value: {literalString: JSON.stringify(value)}});
        }
      }
    }

    const action: v0_8.Types.Action = {
      name: actionName,
      context,
    };

    const eventPayload: v0_8.Events.StateEventDetailMap['a2ui.action'] = {
      eventType: 'a2ui.action',
      action,
      sourceComponentId: this.id,
      dataContextPath: this.dataContextPath,
      sourceComponent: this.component as v0_8.Types.AnyComponentNode,
    };

    this.dispatchEvent(new v0_8.Events.StateEvent(eventPayload));
  }
}
