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

import type {
  McpUiSandboxProxyReadyNotification,
  McpUiSandboxResourceReadyNotification,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import {buildAllowAttribute} from '@modelcontextprotocol/ext-apps/app-bridge';

// Allow configuring the expected host origin via environment variable for production
const meta = import.meta as any;
const allowedHostOrigin = meta && meta.env ? meta.env.VITE_ALLOWED_HOST_ORIGIN : undefined;
export function createAllowedReferrerPattern(allowedHostOrigin?: string): RegExp {
  return allowedHostOrigin
    ? new RegExp(`^${allowedHostOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(:|\\/|$)`)
    : /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;
}

export const ALLOWED_REFERRER_PATTERN = createAllowedReferrerPattern(allowedHostOrigin);

export const SENSITIVE_PERMISSIONS = [
  'camera',
  'microphone',
  'geolocation',
  'clipboard-read',
  'clipboard-write',
] as const;

export const RESOURCE_READY_NOTIFICATION: McpUiSandboxResourceReadyNotification['method'] =
  'ui/notifications/sandbox-resource-ready';
export const PROXY_READY_NOTIFICATION: McpUiSandboxProxyReadyNotification['method'] =
  'ui/notifications/sandbox-proxy-ready';

export const A2uiMessageType = {
  Action: 'a2ui_action',
  SandboxProxyReady: 'a2ui_sandbox_proxy_ready',
  SandboxResourceReady: 'a2ui_sandbox_resource_ready',
} as const;

export function buildPermissionsPolicy(allowAttribute?: string): string {
  if (!allowAttribute || !allowAttribute.trim()) {
    return SENSITIVE_PERMISSIONS.map(f => `${f} 'none'`).join('; ') + ';';
  }

  const allowedDirectives = allowAttribute
    .split(';')
    .map(d => d.trim())
    .filter(Boolean);

  const allowedFeatureNames = new Set(allowedDirectives.map(d => d.split(/\s+/)[0].toLowerCase()));

  const mergedDirectives = [...allowedDirectives];

  for (const feature of SENSITIVE_PERMISSIONS) {
    if (!allowedFeatureNames.has(feature)) {
      mergedDirectives.push(`${feature} 'none'`);
    }
  }

  return mergedDirectives.join('; ') + ';';
}

export function normalizeOrigin(origin: string): string {
  return origin.replace('://127.0.0.1', '://localhost');
}

const isTestEnv = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test';

if (!isTestEnv && typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (window.self === window.top) {
    throw new Error('This file is only to be used in an iframe sandbox.');
  }

  if (!document.referrer) {
    throw new Error('No referrer, cannot validate embedding site.');
  }

  if (!document.referrer.match(ALLOWED_REFERRER_PATTERN)) {
    throw new Error(
      `Embedding domain not allowed in referrer ${document.referrer}. Expected sandbox environment configuration.`,
    );
  }

  // Extract the expected host origin from the referrer for origin validation.
  // This is the origin we expect all parent messages to come from.
  const EXPECTED_HOST_ORIGIN = new URL(document.referrer).origin;
  const OWN_ORIGIN = new URL(window.location.href).origin;

  // Check for query param to opt-out of security self-test (for testing)
  const urlParams = new URLSearchParams(window.location.search);
  const disableSelfTest = urlParams.get('disable_security_self_test') === 'true';

  if (!disableSelfTest) {
    // Security self-test: verify iframe isolation is working correctly.
    try {
      window.top!.alert('If you see this, the sandbox is not setup securely.');
      throw 'FAIL';
    } catch (e) {
      if (e === 'FAIL') {
        throw new Error('The sandbox is not setup securely.');
      }
    }
  }

  // Double-iframe sandbox architecture: THIS file is the outer sandbox proxy
  // iframe on a separate origin. It creates an inner iframe for untrusted HTML content.
  // Note: allow-top-navigation and allow-top-navigation-by-user-activation are strictly omitted
  // to prevent embedded scripts from hijacking top-level window navigation (frame-busting).
  // allow-popups and allow-popups-to-escape-sandbox are omitted by default to prevent 1-click hyperlink exfiltration.
  const inner = document.createElement('iframe');
  inner.style.cssText = 'width:100%; height:100%; border:none;';
  inner.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
  inner.setAttribute('allow', buildPermissionsPolicy());
  document.body.appendChild(inner);

  window.addEventListener('message', async event => {
    if (event.source === window.parent) {
      if (normalizeOrigin(event.origin) !== normalizeOrigin(EXPECTED_HOST_ORIGIN)) {
        console.error(
          '[Sandbox] Rejecting message from unexpected origin:',
          event.origin,
          'expected:',
          EXPECTED_HOST_ORIGIN,
        );
        return;
      }

      const isMcpResourceReady = event.data && event.data.method === RESOURCE_READY_NOTIFICATION;
      const isA2uiResourceReady =
        event.data && event.data.type === A2uiMessageType.SandboxResourceReady;

      if (isMcpResourceReady || isA2uiResourceReady) {
        const payload = isMcpResourceReady ? event.data.params : event.data;
        const {html, htmlContent, url, sandbox, permissions} = payload as any;
        const contentHtml = html ?? htmlContent;
        if (typeof sandbox === 'string') {
          inner.setAttribute('sandbox', sandbox);
        }
        const allowAttribute = buildAllowAttribute(permissions);
        inner.setAttribute('allow', buildPermissionsPolicy(allowAttribute));

        const sendInit = () => {
          if (inner.contentWindow) {
            // Use "*" because sandboxed iframes with no 'allow-same-origin' have a "null" origin.
            // A specific target origin will fail matching and block delivery.
            inner.contentWindow.postMessage({type: 'sandbox-init'}, '*');
          }
        };

        if (typeof contentHtml === 'string') {
          inner.onload = sendInit;
          inner.srcdoc = contentHtml;
        } else if (typeof url === 'string') {
          inner.onload = sendInit;
          inner.src = url;
        }
      } else {
        if (inner && inner.contentWindow) {
          // Same rationale as above: target origin must be "*" to reach sandboxed 'null' windows.
          inner.contentWindow.postMessage(
            event.data,
            '*',
            event.ports ? [...event.ports] : undefined,
          );
        }
      }
    } else if (event.source === inner.contentWindow) {
      // MUST allow the string "null" as the origin. Without 'allow-same-origin',
      // browsers force sandboxed frames to an anonymous, unique origin that serializes to "null".
      // Security verification relies primarily on ensuring 'event.source === inner.contentWindow'.
      if (event.origin !== OWN_ORIGIN && event.origin !== 'null') {
        console.error(
          '[Sandbox] Rejecting message from inner iframe with unexpected origin:',
          event.origin,
          'expected:',
          OWN_ORIGIN,
          'or null',
        );
        return;
      }
      window.parent.postMessage(event.data, EXPECTED_HOST_ORIGIN);
    }
  });

  // 1. Notify Host (Standard MCP Apps Component)
  // This uses the standard JSON-RPC 2.0 framing format.
  // Note: This message is a no-op and safely ignored if the host is using a WebAppFrame component instead.
  window.parent.postMessage(
    {
      jsonrpc: '2.0',
      method: PROXY_READY_NOTIFICATION,
      params: {},
    },
    EXPECTED_HOST_ORIGIN,
  );

  // 2. Notify Host (A2UI WebAppFrame Components)
  // This uses the A2UI flat envelope format.
  // Note: This message is a no-op and safely ignored if the host is using an McpApp component instead.
  window.parent.postMessage(
    {
      type: A2uiMessageType.SandboxProxyReady,
    },
    EXPECTED_HOST_ORIGIN,
  );
}
