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
 * The MCP Apps specification requires web hosts to wrap the view in a sandbox proxy and
 * recommends serving that proxy from a dedicated origin. This file implements that proxy once for
 * both catalog packages. `sandbox.html` (inline HTML content) and `sandbox-url.html` (external
 * URLs) load it inside an iframe that the host page embeds without a `sandbox` attribute, because
 * the proxy checks who embeds it (`document.referrer`) and exchanges messages with the host by
 * origin. The proxy creates the inner iframe that holds the untrusted content, with `sandbox`
 * flags that exclude `allow-same-origin`, and relays messages between the host and that frame.
 *
 * By default the proxy is served from the host's own origin (`/a2ui-sandbox/`). That is
 * convenient but gives no origin isolation beyond the sandboxed inner frame itself and disables
 * the proxy's cross-origin self-test. Production hosts should serve the proxy from a dedicated
 * origin by pointing `configureSandbox({baseUrl})` at it and listing the host origin in the proxy
 * page's `a2ui-sandbox-host-origins` meta tag. Even when same-origin, the proxy still gives the
 * content a controlled embedding document: `srcdoc` documents inherit the embedding document's
 * CSP, so the proxy page sets only `object-src 'none'` and leaves `script-src`, `style-src` and the
 * rest to the `<meta>` CSP the proxy injects into every inline document. Author CSP tags are kept,
 * so the effective policy is the intersection of the proxy page's, the injected one and the
 * author's. The proxy also keeps a single code path regardless of where it is served.
 *
 * The injected CSP binds only the document the proxy loads, so the proxy also keeps the inner frame
 * on that document. Before it loads inline HTML, it adds a `frame-src` policy to its own page,
 * which the browser checks on every navigation of the inner frame, including the ones the content
 * starts itself: a navigation to another network, `data:` or `blob:` document is refused before
 * anything is requested. As a second line, the proxy treats any further `load` of the inner frame,
 * or a `frame-src` violation, as the frame leaving its content. It then replaces the frame, stops
 * relaying in both directions and reports {@link SandboxErrorCode.InnerFrameNavigated} to the
 * host, until the host sends a new resource.
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
  SandboxError: 'a2ui_sandbox_error',
} as const;

/**
 * Method of the standard MCP logging notification. The proxy reports its errors to an MCP Apps host
 * with it, because every `AppBridge` surfaces it (`onloggingmessage`).
 */
export const LOGGING_MESSAGE_NOTIFICATION = 'notifications/message';

/** `logger` of the logging notifications the proxy sends, which tells them apart from the app's. */
export const SANDBOX_PROXY_LOGGER = 'a2ui-sandbox-proxy';

/** Errors the proxy reports to the host. */
export const SandboxErrorCode = {
  /**
   * The inner frame left the document the host sent: the content navigated it, reloaded it or
   * tried to. The proxy has dropped the frame and relays nothing until the host sends a new
   * resource.
   */
  InnerFrameNavigated: 'inner_frame_navigated',
} as const;

export type SandboxErrorCode = (typeof SandboxErrorCode)[keyof typeof SandboxErrorCode];

/**
 * Builds the messages that report an error to the host: the flat A2UI envelope and an MCP logging
 * notification at level `error`, each with the same `code` and `message`. The proxy posts both, as
 * it does for proxy-ready; each host ignores the framing it does not use.
 */
export function createSandboxErrorMessages(
  code: SandboxErrorCode,
  message: string,
): [a2ui: Record<string, unknown>, mcp: Record<string, unknown>] {
  return [
    {type: A2uiSandboxMessageType.SandboxError, code, message},
    {
      jsonrpc: '2.0',
      method: LOGGING_MESSAGE_NOTIFICATION,
      params: {level: 'error', logger: SANDBOX_PROXY_LOGGER, data: {code, message}},
    },
  ];
}

/**
 * Sandbox flags of the inner iframe when the host does not provide its own. `allow-same-origin`
 * is omitted so the content runs in an opaque origin with no access to the host's cookies or
 * storage; `allow-top-navigation` and `allow-top-navigation-by-user-activation` are omitted so
 * embedded scripts cannot redirect the host window (frame busting); `allow-popups` and
 * `allow-popups-to-escape-sandbox` are omitted so a click on an attacker-built link cannot open a
 * new window and exfiltrate data through its URL.
 */
export const DEFAULT_INNER_SANDBOX = 'allow-scripts allow-forms allow-modals';

/**
 * Resolves the `sandbox` attribute of the inner iframe for a resource. Without a host-provided
 * value the frame gets {@link DEFAULT_INNER_SANDBOX}, so a resource that omits `sandbox` never
 * keeps the flags of a previous one. A host-provided value is kept as is, except that
 * `allow-same-origin` is dropped for inline HTML: a `srcdoc` frame with that flag inherits the
 * proxy's origin and can reach the proxy window.
 */
export function resolveInnerSandbox(sandbox: string | undefined, isSrcdoc: boolean): string {
  if (sandbox === undefined) {
    return DEFAULT_INNER_SANDBOX;
  }
  if (!isSrcdoc) {
    return sandbox;
  }
  return sandbox
    .split(/\s+/)
    .filter(flag => flag.toLowerCase() !== 'allow-same-origin')
    .join(' ');
}

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

/**
 * Per-resource Content Security Policy allowlists, in the shape of the MCP Apps `McpUiResourceCsp`
 * (`_meta.ui.csp`) type.
 */
export interface SandboxCsp {
  readonly connectDomains?: readonly string[];
  readonly resourceDomains?: readonly string[];
  readonly frameDomains?: readonly string[];
  readonly baseUriDomains?: readonly string[];
}

function sanitizeCspDomains(domains: readonly string[] | undefined): string[] {
  if (!Array.isArray(domains)) {
    return [];
  }
  return domains
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0 && !/[;"'\s]/.test(entry));
}

/** The `frame-src` source list for a resource: its `frameDomains`, or `'none'` without any. */
function frameSourceList(csp: SandboxCsp | undefined): string {
  const frameDomains = sanitizeCspDomains(csp?.frameDomains);
  return frameDomains.length > 0 ? frameDomains.join(' ') : "'none'";
}

/**
 * Compiles the Content Security Policy directive string injected into an inner `srcdoc` frame.
 * Defaults to a deny-by-default policy with `connect-src 'none'` and `frame-src 'none'`, and
 * widens specific directives only for origins listed in `csp`.
 */
export function buildInnerCspContent(csp?: SandboxCsp): string {
  const connectDomains = sanitizeCspDomains(csp?.connectDomains);
  const resourceDomains = sanitizeCspDomains(csp?.resourceDomains);
  const baseUriDomains = sanitizeCspDomains(csp?.baseUriDomains);

  const resourceSuffix = resourceDomains.length > 0 ? ` ${resourceDomains.join(' ')}` : '';
  const connectSrc = connectDomains.length > 0 ? connectDomains.join(' ') : "'none'";
  const frameSrc = frameSourceList(csp);
  const baseUri = baseUriDomains.length > 0 ? `'self' ${baseUriDomains.join(' ')}` : "'self'";

  return (
    [
      "default-src 'none'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:${resourceSuffix}`,
      `style-src 'self' 'unsafe-inline' blob: data:${resourceSuffix}`,
      `img-src 'self' data: blob:${resourceSuffix}`,
      `font-src 'self' data: blob:${resourceSuffix}`,
      `media-src 'self' data: blob:${resourceSuffix}`,
      `connect-src ${connectSrc}`,
      `frame-src ${frameSrc}`,
      `base-uri ${baseUri}`,
      "form-action 'none'",
    ].join('; ') + ';'
  );
}

/**
 * Compiles the policy the proxy adds to its own page before it loads inline HTML. A page's
 * `frame-src` applies to every navigation of its child frames, including the ones a child starts
 * itself, so this policy keeps the inner frame on its `srcdoc` document (`about:srcdoc` is not
 * subject to `frame-src`). The `srcdoc` document inherits the policy, so it lists the same
 * `frameDomains` as the injected policy's `frame-src` and leaves the content's own nested frames
 * as they were.
 */
export function buildProxyFramePolicy(csp?: SandboxCsp): string {
  return `frame-src ${frameSourceList(csp)};`;
}

/**
 * Returns `html` with a `<meta http-equiv="Content-Security-Policy">` tag built from `csp` as the
 * first child of `<head>`. The document is parsed with `DOMParser`, so a missing `<html>`, `<head>`
 * or `<body>` is created and comments, scripts and template markers are left untouched.
 * Author-supplied CSP meta tags are kept: a document enforces every policy it receives, so the
 * author's policy can only narrow the proxy's, never widen it. The result is serialized as a full
 * document, keeping the author's doctype when there is one.
 */
export function injectCspMeta(html: string, csp?: SandboxCsp): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = doc.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', buildInnerCspContent(csp));
  doc.head.prepend(meta);

  // `srcdoc` is always parsed as a full document, so the result is serialized as one. The doctype
  // is kept when the author wrote one (no doctype means quirks mode, as the author asked).
  // `XMLSerializer` is not used because its XML output escapes `<` and `&` inside inline scripts
  // and styles.
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : '';
  return `${doctype}${doc.documentElement.outerHTML}`;
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
  readonly top: {readonly location: {readonly href: string}} | null;
  readonly parent: SandboxProxyMessageTarget | null;
  readonly location: {readonly href: string; readonly search: string; reload(): void};
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/** The subset of `Document` the proxy uses; tests provide a controlled instance. */
export interface SandboxProxyDocument {
  readonly referrer: string;
  readonly head: Pick<HTMLElement, 'appendChild'>;
  readonly body: Pick<HTMLElement, 'appendChild'>;
  createElement<K extends 'iframe' | 'meta'>(tagName: K): HTMLElementTagNameMap[K];
  querySelector(selectors: string): Element | null;
  addEventListener(
    type: 'securitypolicyviolation',
    listener: (event: SecurityPolicyViolationEvent) => void,
  ): void;
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
  readonly csp?: SandboxCsp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCsp(raw: unknown): SandboxCsp | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  return {
    connectDomains: Array.isArray(raw['connectDomains'])
      ? sanitizeCspDomains(raw['connectDomains'])
      : undefined,
    resourceDomains: Array.isArray(raw['resourceDomains'])
      ? sanitizeCspDomains(raw['resourceDomains'])
      : undefined,
    frameDomains: Array.isArray(raw['frameDomains'])
      ? sanitizeCspDomains(raw['frameDomains'])
      : undefined,
    baseUriDomains: Array.isArray(raw['baseUriDomains'])
      ? sanitizeCspDomains(raw['baseUriDomains'])
      : undefined,
  };
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
    csp: readCsp(payload['csp']),
  };
}

/** Creates an inner iframe with the given sandbox flags and permissions policy. */
function createInnerFrame(
  doc: SandboxProxyDocument,
  sandbox: string,
  allow: string,
): HTMLIFrameElement {
  const frame = doc.createElement('iframe');
  frame.style.cssText = 'width:100%; height:100%; border:none;';
  frame.setAttribute('sandbox', sandbox);
  frame.setAttribute('allow', allow);
  return frame;
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
 *
 * Each resource the host sends replaces the inner frame with a fresh one. The proxy relays
 * messages for that frame until it leaves the document the host sent (see the file overview),
 * then drops it and reports {@link SandboxErrorCode.InnerFrameNavigated}.
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
    // Security self-test: a proxy that can read the top window's location is not isolated from
    // it. A reachable top window means the proxy is served from the host's own origin.
    let topReachable = false;
    try {
      void win.top?.location.href;
      topReachable = Boolean(win.top);
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

  // The inner frame of the current resource. Every resource gets a fresh frame, so a load or a
  // message of an earlier document is never taken for the current one, and the frame has no
  // session history the content could go back through.
  let inner = createInnerFrame(doc, DEFAULT_INNER_SANDBOX, buildPermissionsPolicy());
  doc.body.appendChild(inner);
  // Whether messages flow between the host and the inner frame. Turned off when the inner frame
  // leaves the document the host sent, and on again when the host sends a new resource.
  let relaying = true;
  // The `frame-src` policy this page has added to itself, if any. A page can add policies but
  // never remove one, so a resource that needs a different policy gets a fresh proxy page.
  let framePolicy: string | null = null;

  const replaceInnerFrame = (next: HTMLIFrameElement) => {
    inner.remove();
    doc.body.appendChild(next);
    inner = next;
  };

  const stopAfterNavigation = (frame: HTMLIFrameElement) => {
    if (frame !== inner || !relaying) {
      return;
    }
    relaying = false;
    // Removing the frame discards the document it navigated to and anything still running there.
    replaceInnerFrame(createInnerFrame(doc, DEFAULT_INNER_SANDBOX, buildPermissionsPolicy()));
    const message =
      'The sandboxed content navigated away from the document the host sent; the sandbox stopped relaying its messages.';
    console.error(`[Sandbox] ${message}`);
    for (const report of createSandboxErrorMessages(
      SandboxErrorCode.InnerFrameNavigated,
      message,
    )) {
      parent.postMessage(report, expectedHostOrigin);
    }
  };

  // The inner frame is this page's only child frame, so a `frame-src` violation here is the inner
  // frame trying to navigate to a document the policy refuses.
  doc.addEventListener('securitypolicyviolation', event => {
    if (event.effectiveDirective === 'frame-src') {
      stopAfterNavigation(inner);
    }
  });

  const loadResource = ({html, url, sandbox, permissions, csp}: SandboxResourcePayload) => {
    const next = createInnerFrame(
      doc,
      resolveInnerSandbox(sandbox, html !== undefined),
      buildPermissionsPolicy(buildAllowAttribute(permissions)),
    );
    let loads = 0;
    next.addEventListener('load', () => {
      if (next !== inner) {
        return;
      }
      loads += 1;
      if (loads === 1) {
        // The target origin is "*" because a sandboxed iframe without 'allow-same-origin' has
        // an opaque ("null") origin, which no specific target origin can match.
        next.contentWindow?.postMessage({type: 'sandbox-init'}, '*');
      } else {
        // Without a new resource from the host, only a navigation or a reload loads it again.
        stopAfterNavigation(next);
      }
    });
    if (html !== undefined) {
      next.srcdoc = injectCspMeta(html, csp);
    } else if (url !== undefined) {
      next.src = url;
    }
    replaceInnerFrame(next);
    relaying = true;
  };

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
        const resource = readResourcePayload(isMcpResourceReady ? data['params'] : data);
        if (resource.html === undefined && resource.url === undefined) {
          return;
        }
        // An external URL brings its own policies and network access, so only inline HTML needs
        // the page policy that keeps the frame on its document.
        const requiredPolicy =
          resource.html !== undefined ? buildProxyFramePolicy(resource.csp) : null;
        if (framePolicy !== null && requiredPolicy !== framePolicy) {
          // The new resource would run under both policies. A fresh page starts without one, and
          // the host sends the resource again when the page announces itself.
          win.location.reload();
          return;
        }
        if (requiredPolicy !== null && framePolicy === null) {
          const meta = doc.createElement('meta');
          meta.httpEquiv = 'Content-Security-Policy';
          meta.content = requiredPolicy;
          doc.head.appendChild(meta);
          framePolicy = requiredPolicy;
        }
        loadResource(resource);
      } else if (relaying && inner.contentWindow) {
        // Same rationale as above: only "*" reaches an opaque-origin window.
        inner.contentWindow.postMessage(event.data, '*', event.ports ? [...event.ports] : []);
      }
    } else if (event.source === inner.contentWindow) {
      if (!relaying) {
        return;
      }
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
