/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
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
const ALLOWED_REFERRER_PATTERN = allowedHostOrigin
  ? new RegExp(`^${allowedHostOrigin.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`)
  : /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;

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
const inner = document.createElement('iframe');
inner.style.cssText = 'width:100%; height:100%; border:none;';
inner.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals');
document.body.appendChild(inner);

const RESOURCE_READY_NOTIFICATION: McpUiSandboxResourceReadyNotification['method'] =
  'ui/notifications/sandbox-resource-ready';
const PROXY_READY_NOTIFICATION: McpUiSandboxProxyReadyNotification['method'] =
  'ui/notifications/sandbox-proxy-ready';

window.addEventListener('message', async event => {
  if (event.source === window.parent) {
    const normalizeOrigin = (origin: string) => origin.replace('://127.0.0.1', '://localhost');
    if (normalizeOrigin(event.origin) !== normalizeOrigin(EXPECTED_HOST_ORIGIN)) {
      console.error(
        '[Sandbox] Rejecting message from unexpected origin:',
        event.origin,
        'expected:',
        EXPECTED_HOST_ORIGIN,
      );
      return;
    }

    if (event.data && event.data.method === RESOURCE_READY_NOTIFICATION) {
      const {html, sandbox, permissions} = event.data.params;
      if (typeof sandbox === 'string') {
        inner.setAttribute('sandbox', sandbox);
      }
      const allowAttribute = buildAllowAttribute(permissions);
      if (allowAttribute) {
        inner.setAttribute('allow', allowAttribute);
      }
      if (typeof html === 'string') {
        const sendInit = () => {
          if (inner.contentWindow) {
            // Use "*" because sandboxed iframes with no 'allow-same-origin' have a "null" origin.
            // A specific target origin will fail matching and block delivery.
            inner.contentWindow.postMessage({type: 'sandbox-init'}, '*');
          }
        };
        inner.onload = sendInit;

        inner.srcdoc = html;
      }
    } else {
      if (inner && inner.contentWindow) {
        // Same rationale as above: target origin must be "*" to reach sandboxed 'null' windows.
        inner.contentWindow.postMessage(event.data, '*');
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

// Notify Host
window.parent.postMessage(
  {
    jsonrpc: '2.0',
    method: PROXY_READY_NOTIFICATION,
    params: {},
  },
  EXPECTED_HOST_ORIGIN,
);
