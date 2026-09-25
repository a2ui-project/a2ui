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
 * Outer proxy of the A2UI double-iframe sandbox.
 *
 * `sandbox.html` (inline HTML content) and `sandbox-url.html` (external URLs) load this script
 * inside an iframe that the host page embeds without a `sandbox` attribute. A single sandboxed
 * iframe placed directly in the host page triggers `SecurityError` crashes in browser DevTools and
 * extensions that walk the frame tree, so the untrusted content lives one level down instead: this
 * proxy creates a strictly sandboxed inner iframe for it and relays messages between the host and
 * that inner frame. The proxy is served from the host's own origin by default, which is what keeps
 * the outer frame reachable for developer tooling while the inner frame stays isolated.
 *
 * `sandbox_main.ts` is the bundle entry point; it calls {@link startSandboxProxy} with the real
 * `window` and `document`. Everything else in this file is side-effect free so tests can import it.
 */

/** Wire constants of the MCP Apps sandbox handshake (`@modelcontextprotocol/ext-apps`). */
export const PROXY_READY_NOTIFICATION = 'ui/notifications/sandbox-proxy-ready';
export const RESOURCE_READY_NOTIFICATION = 'ui/notifications/sandbox-resource-ready';

/** Wire constants of the A2UI web app frame sandbox handshake. */
export const A2uiSandboxMessageType = {
  SandboxProxyReady: 'a2ui_sandbox_proxy_ready',
  SandboxResourceReady: 'a2ui_sandbox_resource_ready',
} as const;

/**
 * Sandbox flags of the inner iframe. `allow-same-origin` is omitted so the content runs in an
 * opaque origin with no access to the host's cookies or storage; `allow-top-navigation` and
 * `allow-top-navigation-by-user-activation` are omitted so embedded scripts cannot redirect the
 * host window (frame busting); `allow-popups` and `allow-popups-to-escape-sandbox` are omitted so a
 * click on an attacker-built link cannot open a new window and exfiltrate data through its URL.
 */
export const DEFAULT_INNER_SANDBOX = 'allow-scripts allow-forms allow-modals';

/** Sensitive capabilities the inner frame never gets unless the host delegates them explicitly. */
export const SENSITIVE_PERMISSIONS = [
  'camera',
  'microphone',
  'geolocation',
  'clipboard-read',
  'clipboard-write',
] as const;

/**
 * Capabilities a resource may request, in the shape of the MCP Apps `McpUiResourcePermissions`
 * type: the presence of a key (with any object value) requests the capability.
 */
export interface SandboxPermissions {
  readonly camera?: object;
  readonly microphone?: object;
  readonly geolocation?: object;
  readonly clipboardWrite?: object;
}

/**
 * Builds the iframe `allow` attribute for the requested permissions, mapping each MCP Apps
 * permission key to its Permissions Policy feature name (for example `clipboardWrite` becomes
 * `clipboard-write`). Mirrors `buildAllowAttribute` from `@modelcontextprotocol/ext-apps` so the
 * proxy needs no dependency.
 */
export function buildAllowAttribute(permissions: SandboxPermissions | undefined): string {
  if (!permissions) {
    return '';
  }
  const features: string[] = [];
  if (permissions.camera) features.push('camera');
  if (permissions.microphone) features.push('microphone');
  if (permissions.geolocation) features.push('geolocation');
  if (permissions.clipboardWrite) features.push('clipboard-write');
  return features.join('; ');
}

/**
 * Merges an `allow` attribute with the deny-all baseline: every sensitive permission that the
 * attribute does not grant is locked with `'none'`, and non-sensitive directives pass through.
 * Without an attribute the result denies all sensitive permissions.
 */
export function buildPermissionsPolicy(allowAttribute?: string): string {
  if (!allowAttribute || !allowAttribute.trim()) {
    return SENSITIVE_PERMISSIONS.map(feature => `${feature} 'none'`).join('; ') + ';';
  }

  const allowedDirectives = allowAttribute
    .split(';')
    .map(directive => directive.trim())
    .filter(Boolean);

  const allowedFeatureNames = new Set(
    allowedDirectives.map(directive => directive.split(/\s+/)[0].toLowerCase()),
  );

  const mergedDirectives = [...allowedDirectives];
  for (const feature of SENSITIVE_PERMISSIONS) {
    if (!allowedFeatureNames.has(feature)) {
      mergedDirectives.push(`${feature} 'none'`);
    }
  }

  return mergedDirectives.join('; ') + ';';
}

/** Treats `127.0.0.1` and `localhost` as the same host so local development works with either. */
export function normalizeOrigin(origin: string): string {
  return origin.replace('://127.0.0.1', '://localhost');
}

/**
 * Builds the pattern a referrer must match to be accepted as the embedding page: the given origin
 * followed by a port separator, a path separator or the end of the string, so that
 * `https://a2ui.org.attacker.com` does not match `https://a2ui.org`.
 */
export function createAllowedReferrerPattern(allowedHostOrigin: string): RegExp {
  return new RegExp(`^${allowedHostOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(:|\\/|$)`);
}

/** The window a message is posted to. */
export interface SandboxProxyMessageTarget {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
}

/** The subset of `Window` the proxy uses; tests provide a controlled instance. */
export interface SandboxProxyWindow {
  readonly self: unknown;
  readonly top: {alert(message: string): void} | null;
  readonly parent: SandboxProxyMessageTarget | null;
  readonly location: {readonly href: string; readonly search: string};
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/** The subset of `Document` the proxy uses; tests provide a controlled instance. */
export interface SandboxProxyDocument {
  readonly referrer: string;
  readonly body: Pick<HTMLElement, 'appendChild'>;
  createElement(tagName: 'iframe'): HTMLIFrameElement;
  querySelector(selectors: string): Element | null;
}

/**
 * Name of the `<meta>` tag that lists the origins allowed to embed the proxy, separated by
 * whitespace or commas. Hosts that serve the proxy from a dedicated origin add it to the proxy
 * page; the tag lives with the proxy, so an embedding page cannot widen the list.
 */
export const HOST_ORIGINS_META_NAME = 'a2ui-sandbox-host-origins';

/**
 * Returns the origins allowed to embed the proxy: its own origin, plus any listed in the
 * {@link HOST_ORIGINS_META_NAME} meta tag. Entries that are not valid absolute URLs are dropped.
 */
export function readAllowedHostOrigins(
  doc: Pick<SandboxProxyDocument, 'querySelector'>,
  ownOrigin: string,
): string[] {
  const origins = [ownOrigin];
  const content = doc
    .querySelector(`meta[name="${HOST_ORIGINS_META_NAME}"]`)
    ?.getAttribute('content');
  for (const entry of (content ?? '').split(/[\s,]+/)) {
    if (!entry) {
      continue;
    }
    let origin: string;
    try {
      origin = new URL(entry).origin;
    } catch {
      continue;
    }
    if (origin !== 'null' && !origins.includes(origin)) {
      origins.push(origin);
    }
  }
  return origins;
}

/** The environment {@link startSandboxProxy} runs in. */
export interface SandboxProxyEnvironment {
  readonly window: SandboxProxyWindow;
  readonly document: SandboxProxyDocument;
}

/** A resource-ready payload, in either protocol, after loose validation. */
interface SandboxResourcePayload {
  readonly html?: string;
  readonly url?: string;
  readonly sandbox?: string;
  readonly permissions?: SandboxPermissions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readResourcePayload(raw: unknown): SandboxResourcePayload {
  const payload = isRecord(raw) ? raw : {};
  const html =
    typeof payload['html'] === 'string'
      ? payload['html']
      : typeof payload['htmlContent'] === 'string'
        ? payload['htmlContent']
        : undefined;
  return {
    html,
    url: typeof payload['url'] === 'string' ? payload['url'] : undefined,
    sandbox: typeof payload['sandbox'] === 'string' ? payload['sandbox'] : undefined,
    permissions: isRecord(payload['permissions'])
      ? (payload['permissions'] as SandboxPermissions)
      : undefined,
  };
}

/**
 * Runs the proxy: validates the embedding context, creates the sandboxed inner iframe, relays
 * messages between the host and the inner frame, and tells the host it is ready.
 *
 * The checks, in order:
 *
 * 1. The page must be framed; the proxy is useless (and unsafe) as a top-level page.
 * 2. `document.referrer` must be present and come from an allowed embedding origin: the proxy's
 *    own origin (the default deployment) or one listed in the {@link HOST_ORIGINS_META_NAME} meta
 *    tag of the proxy page. The referrer's origin then becomes the only origin the proxy accepts
 *    messages from and posts messages to.
 * 3. Unless the page URL carries `disable_security_self_test=true`, the proxy checks that it cannot
 *    reach the top window. That check only passes when the proxy is served from an origin other
 *    than the host page's; hosts that serve it from their own origin (the default) pass the query
 *    parameter, which the host-side configuration does for them.
 */
export function startSandboxProxy(env: SandboxProxyEnvironment): void {
  const {window: win, document: doc} = env;

  if (win.self === win.top) {
    throw new Error('This file is only to be used in an iframe sandbox.');
  }

  if (!doc.referrer) {
    throw new Error('No referrer, cannot validate embedding site.');
  }

  const ownOrigin = new URL(win.location.href).origin;
  const referrer = normalizeOrigin(doc.referrer);
  const referrerAllowed = readAllowedHostOrigins(doc, ownOrigin).some(origin =>
    createAllowedReferrerPattern(normalizeOrigin(origin)).test(referrer),
  );
  if (!referrerAllowed) {
    throw new Error(
      `Embedding domain not allowed in referrer ${doc.referrer}. Expected sandbox environment configuration.`,
    );
  }

  // The origin all parent messages must come from, and the only target the proxy posts to.
  const expectedHostOrigin = new URL(doc.referrer).origin;

  const urlParams = new URLSearchParams(win.location.search);
  const disableSelfTest = urlParams.get('disable_security_self_test') === 'true';

  if (!disableSelfTest) {
    // Security self-test: a proxy that can call into the top window is not isolated from it.
    let topReachable = false;
    try {
      win.top?.alert('If you see this, the sandbox is not setup securely.');
      topReachable = true;
    } catch {
      // Cross-origin access threw, which is the expected outcome.
    }
    if (topReachable) {
      throw new Error('The sandbox is not setup securely.');
    }
  }

  const parent = win.parent;
  if (!parent) {
    throw new Error('This file is only to be used in an iframe sandbox.');
  }

  const inner = doc.createElement('iframe');
  inner.style.cssText = 'width:100%; height:100%; border:none;';
  inner.setAttribute('sandbox', DEFAULT_INNER_SANDBOX);
  inner.setAttribute('allow', buildPermissionsPolicy());
  doc.body.appendChild(inner);

  win.addEventListener('message', event => {
    if (event.source === parent) {
      if (normalizeOrigin(event.origin) !== normalizeOrigin(expectedHostOrigin)) {
        console.error(
          '[Sandbox] Rejecting message from unexpected origin:',
          event.origin,
          'expected:',
          expectedHostOrigin,
        );
        return;
      }

      const data: unknown = event.data;
      const isMcpResourceReady = isRecord(data) && data['method'] === RESOURCE_READY_NOTIFICATION;
      const isA2uiResourceReady =
        isRecord(data) && data['type'] === A2uiSandboxMessageType.SandboxResourceReady;

      if (isMcpResourceReady || isA2uiResourceReady) {
        const {html, url, sandbox, permissions} = readResourcePayload(
          isMcpResourceReady ? data['params'] : data,
        );
        if (sandbox !== undefined) {
          inner.setAttribute('sandbox', sandbox);
        }
        inner.setAttribute('allow', buildPermissionsPolicy(buildAllowAttribute(permissions)));

        const sendInit = () => {
          // The target origin is "*" because a sandboxed iframe without 'allow-same-origin' has
          // an opaque ("null") origin, which no specific target origin can match.
          inner.contentWindow?.postMessage({type: 'sandbox-init'}, '*');
        };

        if (html !== undefined) {
          inner.onload = sendInit;
          inner.srcdoc = html;
        } else if (url !== undefined) {
          inner.onload = sendInit;
          inner.src = url;
        }
      } else if (inner.contentWindow) {
        // Same rationale as above: only "*" reaches an opaque-origin window.
        inner.contentWindow.postMessage(event.data, '*', event.ports ? [...event.ports] : []);
      }
    } else if (event.source === inner.contentWindow) {
      // Without 'allow-same-origin' the inner frame's origin serializes to the string "null", so
      // that value must be accepted; the identity check on `event.source` above is what
      // authenticates the inner frame.
      if (event.origin !== ownOrigin && event.origin !== 'null') {
        console.error(
          '[Sandbox] Rejecting message from inner iframe with unexpected origin:',
          event.origin,
          'expected:',
          ownOrigin,
          'or null',
        );
        return;
      }
      parent.postMessage(event.data, expectedHostOrigin);
    }
  });

  // 1. Notify an MCP Apps host, in JSON-RPC 2.0 framing. A web app frame host ignores it.
  parent.postMessage(
    {
      jsonrpc: '2.0',
      method: PROXY_READY_NOTIFICATION,
      params: {},
    },
    expectedHostOrigin,
  );

  // 2. Notify a web app frame host, in the flat A2UI envelope. An MCP Apps host ignores it.
  parent.postMessage(
    {
      type: A2uiSandboxMessageType.SandboxProxyReady,
    },
    expectedHostOrigin,
  );
}
