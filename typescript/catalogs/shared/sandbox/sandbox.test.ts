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

import {
  A2uiSandboxMessageType,
  buildAllowAttribute,
  buildInnerCspContent,
  buildPermissionsPolicy,
  buildProxyFramePolicy,
  createAllowedReferrerPattern,
  createSandboxErrorMessages,
  DEFAULT_INNER_SANDBOX,
  HOST_ORIGINS_META_NAME,
  injectCspMeta,
  LOGGING_MESSAGE_NOTIFICATION,
  normalizeOrigin,
  PROXY_READY_NOTIFICATION,
  readAllowedHostOrigins,
  resolveInnerSandbox,
  RESOURCE_READY_NOTIFICATION,
  SANDBOX_PROXY_LOGGER,
  SandboxErrorCode,
  SENSITIVE_PERMISSIONS,
  startSandboxProxy,
  type SandboxProxyDocument,
  type SandboxProxyWindow,
} from './sandbox.js';
import {resolveSandboxUrl} from './sandbox_config.js';

const DENY_ALL =
  "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none';";

describe('sandbox proxy helpers', () => {
  describe('SENSITIVE_PERMISSIONS', () => {
    it('contains the five sensitive browser capabilities', () => {
      expect(SENSITIVE_PERMISSIONS).toEqual([
        'camera',
        'microphone',
        'geolocation',
        'clipboard-read',
        'clipboard-write',
      ]);
    });
  });

  describe('buildAllowAttribute', () => {
    it('returns an empty attribute without permissions', () => {
      expect(buildAllowAttribute(undefined)).toBe('');
      expect(buildAllowAttribute({})).toBe('');
    });

    it('maps each permission key to its Permissions Policy feature', () => {
      expect(buildAllowAttribute({camera: {}, clipboardWrite: {}})).toBe('camera; clipboard-write');
      expect(
        buildAllowAttribute({camera: {}, microphone: {}, geolocation: {}, clipboardWrite: {}}),
      ).toBe('camera; microphone; geolocation; clipboard-write');
    });
  });

  describe('buildPermissionsPolicy', () => {
    it('returns a full deny-all policy when allowAttribute is undefined', () => {
      expect(buildPermissionsPolicy()).toBe(DENY_ALL);
    });

    it('returns a full deny-all policy when allowAttribute is empty or whitespace', () => {
      expect(buildPermissionsPolicy('')).toBe(DENY_ALL);
      expect(buildPermissionsPolicy('   ')).toBe(DENY_ALL);
    });

    it('enables a single granted permission while locking the other sensitive features', () => {
      const policy = buildPermissionsPolicy('camera');
      expect(policy.startsWith('camera;')).toBeTrue();
      expect(policy).toContain("microphone 'none'");
      expect(policy).toContain("geolocation 'none'");
      expect(policy).toContain("clipboard-read 'none'");
      expect(policy).toContain("clipboard-write 'none'");
    });

    it('enables multiple granted permissions and locks the unrequested ones', () => {
      const policy = buildPermissionsPolicy('camera; microphone');
      expect(policy).toContain('camera');
      expect(policy).toContain('microphone');
      expect(policy).not.toContain("camera 'none'");
      expect(policy).not.toContain("microphone 'none'");
      expect(policy).toContain("geolocation 'none'");
      expect(policy).toContain("clipboard-read 'none'");
      expect(policy).toContain("clipboard-write 'none'");
    });

    it('preserves directive parameters and origins on granted permissions', () => {
      const policy = buildPermissionsPolicy("camera 'src'; geolocation 'self'");
      expect(policy).toContain("camera 'src'");
      expect(policy).toContain("geolocation 'self'");
      expect(policy).toContain("microphone 'none'");
      expect(policy).toContain("clipboard-read 'none'");
      expect(policy).toContain("clipboard-write 'none'");
    });

    it('matches directive names case-insensitively', () => {
      const policy = buildPermissionsPolicy('CAMERA; Microphone');
      expect(policy).toContain('CAMERA');
      expect(policy).toContain('Microphone');
      expect(policy).not.toContain("camera 'none'");
      expect(policy).not.toContain("microphone 'none'");
      expect(policy).toContain("geolocation 'none'");
    });

    it('preserves non-sensitive directives and denies all sensitive ones', () => {
      const policy = buildPermissionsPolicy('fullscreen; payment');
      expect(policy).toContain('fullscreen');
      expect(policy).toContain('payment');
      expect(policy).toContain("camera 'none'");
      expect(policy).toContain("microphone 'none'");
      expect(policy).toContain("geolocation 'none'");
      expect(policy).toContain("clipboard-read 'none'");
      expect(policy).toContain("clipboard-write 'none'");
    });

    it('does not append none directives when all sensitive permissions are granted', () => {
      const policy = buildPermissionsPolicy(
        'camera; microphone; geolocation; clipboard-read; clipboard-write',
      );
      expect(policy).not.toContain("'none'");
      expect(policy).toBe('camera; microphone; geolocation; clipboard-read; clipboard-write;');
    });
  });

  describe('normalizeOrigin', () => {
    it('normalizes 127.0.0.1 to localhost', () => {
      expect(normalizeOrigin('http://127.0.0.1:4200')).toBe('http://localhost:4200');
      expect(normalizeOrigin('http://127.0.0.1')).toBe('http://localhost');
      expect(normalizeOrigin('https://127.0.0.1:8443')).toBe('https://localhost:8443');
    });

    it('leaves localhost and standard domain origins unmodified', () => {
      expect(normalizeOrigin('http://localhost:4200')).toBe('http://localhost:4200');
      expect(normalizeOrigin('https://a2ui.org')).toBe('https://a2ui.org');
      expect(normalizeOrigin('https://example.com:8080')).toBe('https://example.com:8080');
    });
  });

  describe('createAllowedReferrerPattern', () => {
    it('matches localhost referrers, and 127.0.0.1 ones once normalized', () => {
      const pattern = createAllowedReferrerPattern('http://localhost');
      expect(pattern.test('http://localhost:4200/')).toBeTrue();
      expect(pattern.test('http://localhost/app')).toBeTrue();
      expect(pattern.test('http://localhost:4200')).toBeTrue();
      expect(pattern.test(normalizeOrigin('http://127.0.0.1:8080/'))).toBeTrue();
      expect(pattern.test(normalizeOrigin('http://127.0.0.1'))).toBeTrue();
    });

    it('rejects referrers imitating localhost', () => {
      const pattern = createAllowedReferrerPattern('http://localhost');
      expect(pattern.test('http://evil.com/localhost')).toBeFalse();
      expect(pattern.test('http://localhost.evil.com/')).toBeFalse();
      expect(pattern.test('https://sub.localhost.phishing.io/')).toBeFalse();
    });

    it('matches a custom host origin with boundary checks and rejects spoofing', () => {
      const pattern = createAllowedReferrerPattern('https://a2ui.org');
      expect(pattern.test('https://a2ui.org')).toBeTrue();
      expect(pattern.test('https://a2ui.org/')).toBeTrue();
      expect(pattern.test('https://a2ui.org:8443/app')).toBeTrue();
      expect(pattern.test('https://a2ui.org/dashboard')).toBeTrue();

      expect(pattern.test('https://a2ui.org.attacker.com')).toBeFalse();
      expect(pattern.test('https://a2ui.org-phishing.com')).toBeFalse();
      expect(pattern.test('https://a2ui.org.attacker.com/path')).toBeFalse();
      expect(pattern.test('https://evil.com/?origin=https://a2ui.org')).toBeFalse();
    });
  });

  describe('readAllowedHostOrigins', () => {
    function documentWithMeta(content: string | null): Pick<SandboxProxyDocument, 'querySelector'> {
      const meta = document.createElement('meta');
      meta.setAttribute('name', HOST_ORIGINS_META_NAME);
      if (content !== null) {
        meta.setAttribute('content', content);
      }
      return {
        querySelector: (selectors: string) =>
          selectors === `meta[name="${HOST_ORIGINS_META_NAME}"]` ? meta : null,
      };
    }

    it('returns only the own origin without a meta tag', () => {
      const doc = {querySelector: () => null};
      expect(readAllowedHostOrigins(doc, 'https://host.example')).toEqual(['https://host.example']);
    });

    it('adds the origins listed in the meta tag, ignoring paths and invalid entries', () => {
      const doc = documentWithMeta(
        'https://app.example/path, http://localhost:4200 not-a-url https://app.example',
      );
      expect(readAllowedHostOrigins(doc, 'https://sandbox.example')).toEqual([
        'https://sandbox.example',
        'https://app.example',
        'http://localhost:4200',
      ]);
    });

    it('ignores a meta tag without content', () => {
      expect(readAllowedHostOrigins(documentWithMeta(null), 'https://host.example')).toEqual([
        'https://host.example',
      ]);
    });
  });

  describe('resolveInnerSandbox', () => {
    it('returns the default flags when the host provides none', () => {
      expect(resolveInnerSandbox(undefined, true)).toBe('allow-scripts allow-forms allow-modals');
      expect(resolveInnerSandbox(undefined, false)).toBe('allow-scripts allow-forms allow-modals');
    });

    it('keeps the host-provided flags as is for a url frame', () => {
      expect(resolveInnerSandbox('allow-scripts allow-popups allow-same-origin', false)).toBe(
        'allow-scripts allow-popups allow-same-origin',
      );
    });

    it('drops allow-same-origin, in any case, for an inline html frame', () => {
      expect(
        resolveInnerSandbox('allow-scripts allow-same-origin ALLOW-SAME-ORIGIN allow-popups', true),
      ).toBe('allow-scripts allow-popups');
    });
  });

  describe('buildProxyFramePolicy', () => {
    it('refuses every frame navigation without frameDomains', () => {
      expect(buildProxyFramePolicy()).toBe("frame-src 'none';");
      expect(buildProxyFramePolicy({connectDomains: ['https://api.example.com']})).toBe(
        "frame-src 'none';",
      );
    });

    it('allows the frameDomains of the resource, as the injected policy does', () => {
      const csp = {frameDomains: ['https://embed.example.com', 'https://maps.example.com']};
      expect(buildProxyFramePolicy(csp)).toBe(
        'frame-src https://embed.example.com https://maps.example.com;',
      );
      expect(buildInnerCspContent(csp)).toContain(
        'frame-src https://embed.example.com https://maps.example.com;',
      );
    });

    it('drops malformed frameDomains entries', () => {
      expect(
        buildProxyFramePolicy({
          frameDomains: ['https://ok.example', 'https://x.example; script-src *'],
        }),
      ).toBe('frame-src https://ok.example;');
    });
  });

  describe('createSandboxErrorMessages', () => {
    it('builds the A2UI envelope and an MCP logging notification with the same report', () => {
      expect(createSandboxErrorMessages(SandboxErrorCode.InnerFrameNavigated, 'gone')).toEqual([
        {type: A2uiSandboxMessageType.SandboxError, code: 'inner_frame_navigated', message: 'gone'},
        {
          jsonrpc: '2.0',
          method: LOGGING_MESSAGE_NOTIFICATION,
          params: {
            level: 'error',
            logger: SANDBOX_PROXY_LOGGER,
            data: {code: 'inner_frame_navigated', message: 'gone'},
          },
        },
      ]);
    });
  });
});

describe('startSandboxProxy', () => {
  const OWN_URL = 'https://host.example/a2ui-sandbox/sandbox.html';
  const HOST_ORIGIN = 'https://host.example';

  let container: HTMLDivElement;
  let parentFrame: HTMLIFrameElement;
  let parentWindow: Window;
  let parentPost: jasmine.Spy;
  let listeners: Array<(event: MessageEvent) => void>;
  let violationListeners: Array<(event: SecurityPolicyViolationEvent) => void>;
  let headNodes: Node[];
  let reload: jasmine.Spy;
  let metaContent: string | null;
  let sameOriginInner: boolean;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    parentFrame = document.createElement('iframe');
    container.appendChild(parentFrame);
    parentWindow = parentFrame.contentWindow!;
    parentPost = spyOn(parentWindow, 'postMessage');
    listeners = [];
    violationListeners = [];
    headNodes = [];
    reload = jasmine.createSpy('reload');
    metaContent = null;
    sameOriginInner = false;
  });

  afterEach(() => {
    container.remove();
  });

  function secureTop(): SandboxProxyWindow['top'] {
    return {
      get location(): {readonly href: string} {
        throw new DOMException(
          'Blocked a frame from accessing a cross-origin frame.',
          'SecurityError',
        );
      },
    };
  }

  function reachableTop(): SandboxProxyWindow['top'] {
    return {location: {href: `${HOST_ORIGIN}/`}};
  }

  function fakeLocation(href: string): SandboxProxyWindow['location'] {
    return {href, search: new URL(href).search, reload};
  }

  function fakeWindow(overrides: Partial<SandboxProxyWindow> = {}): SandboxProxyWindow {
    const href = overrides.location?.href ?? `${OWN_URL}?disable_security_self_test=true`;
    return {
      self: {},
      top: secureTop(),
      parent: parentWindow,
      location: fakeLocation(href),
      addEventListener: (_type, listener) => {
        listeners.push(listener);
      },
      ...overrides,
    };
  }

  function fakeDocument(referrer = `${HOST_ORIGIN}/app`): SandboxProxyDocument {
    return {
      referrer,
      // The page policy goes to a detached list: a real `<meta>` CSP would bind the test page.
      head: {
        appendChild: <T extends Node>(node: T): T => {
          headNodes.push(node);
          return node;
        },
      },
      body: {
        appendChild: <T extends Node>(node: T): T => {
          // A sandboxed frame has an opaque origin whose window cannot be spied on; the relay
          // tests drop the flags so they can observe what the proxy posts to the inner frame.
          if (sameOriginInner && node instanceof HTMLIFrameElement) {
            node.removeAttribute('sandbox');
          }
          return container.appendChild(node);
        },
      },
      createElement: tagName => document.createElement(tagName),
      addEventListener: (_type, listener) => {
        violationListeners.push(listener);
      },
      querySelector: () => {
        if (metaContent === null) {
          return null;
        }
        const meta = document.createElement('meta');
        meta.setAttribute('content', metaContent);
        return meta;
      },
    };
  }

  function innerFrame(): HTMLIFrameElement {
    const frames = container.querySelectorAll('iframe');
    expect(frames.length).toBe(2);
    return frames[1];
  }

  function dispatch(init: MessageEventInit): void {
    expect(listeners.length).toBe(1);
    listeners[0](new MessageEvent('message', init));
  }

  describe('embedding checks', () => {
    it('refuses to run as a top-level page', () => {
      const top = secureTop();
      const win = fakeWindow({self: top, top});
      expect(() => startSandboxProxy({window: win, document: fakeDocument()})).toThrowError(
        /only to be used in an iframe sandbox/,
      );
    });

    it('refuses to run without a referrer', () => {
      expect(() =>
        startSandboxProxy({window: fakeWindow(), document: fakeDocument('')}),
      ).toThrowError(/No referrer/);
    });

    it('rejects a referrer from another origin', () => {
      expect(() =>
        startSandboxProxy({window: fakeWindow(), document: fakeDocument('https://evil.example/')}),
      ).toThrowError(/Embedding domain not allowed/);
      expect(() =>
        startSandboxProxy({
          window: fakeWindow(),
          document: fakeDocument('https://host.example.evil.example/'),
        }),
      ).toThrowError(/Embedding domain not allowed/);
    });

    it('accepts a referrer from an origin listed in the meta tag', () => {
      metaContent = 'https://app.example';
      startSandboxProxy({window: fakeWindow(), document: fakeDocument('https://app.example/page')});
      expect(parentPost).toHaveBeenCalledWith(
        {type: A2uiSandboxMessageType.SandboxProxyReady},
        'https://app.example',
      );
    });

    it('treats 127.0.0.1 and localhost as the same host', () => {
      const href =
        'http://localhost:5173/a2ui-sandbox/sandbox.html?disable_security_self_test=true';
      startSandboxProxy({
        window: fakeWindow({location: fakeLocation(href)}),
        document: fakeDocument('http://127.0.0.1:5173/'),
      });
      expect(parentPost).toHaveBeenCalledWith(
        jasmine.objectContaining({method: PROXY_READY_NOTIFICATION}),
        'http://127.0.0.1:5173',
      );
    });
  });

  describe('security self-test', () => {
    it('fails when the top window is reachable', () => {
      const win = fakeWindow({top: reachableTop(), location: fakeLocation(OWN_URL)});
      expect(() => startSandboxProxy({window: win, document: fakeDocument()})).toThrowError(
        /not setup securely/,
      );
      expect(parentPost).not.toHaveBeenCalled();
    });

    it('passes when the top window is cross-origin', () => {
      const win = fakeWindow({location: fakeLocation(OWN_URL)});
      expect(() => startSandboxProxy({window: win, document: fakeDocument()})).not.toThrow();
      expect(parentPost).toHaveBeenCalledTimes(2);
    });

    it('is skipped with disable_security_self_test=true', () => {
      const win = fakeWindow({top: reachableTop()});
      expect(() => startSandboxProxy({window: win, document: fakeDocument()})).not.toThrow();
      expect(parentPost).toHaveBeenCalledTimes(2);
    });
  });

  describe('startup', () => {
    beforeEach(() => {
      startSandboxProxy({window: fakeWindow(), document: fakeDocument()});
    });

    it('creates a strictly sandboxed inner iframe with all sensitive permissions denied', () => {
      const inner = innerFrame();
      expect(inner.getAttribute('sandbox')).toBe(DEFAULT_INNER_SANDBOX);
      expect(inner.getAttribute('sandbox')).not.toContain('allow-same-origin');
      expect(inner.getAttribute('sandbox')).not.toContain('allow-top-navigation');
      expect(inner.getAttribute('sandbox')).not.toContain('allow-popups');
      expect(inner.getAttribute('allow')).toBe(DENY_ALL);
    });

    it('notifies the host in both protocols, restricted to the referrer origin', () => {
      const calls = parentPost.calls.allArgs();
      expect(calls).toEqual([
        [{jsonrpc: '2.0', method: PROXY_READY_NOTIFICATION, params: {}}, HOST_ORIGIN],
        [{type: A2uiSandboxMessageType.SandboxProxyReady}, HOST_ORIGIN],
      ]);
    });
  });

  describe('buildInnerCspContent and injectCspMeta', () => {
    it('compiles a strict default CSP with connect-src none when csp is omitted', () => {
      const policy = buildInnerCspContent();
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain("connect-src 'none'");
      expect(policy).toContain("frame-src 'none'");
      expect(policy).toContain("base-uri 'self'");
      expect(policy).toContain("form-action 'none'");
    });

    it('compiles custom connectDomains, resourceDomains, frameDomains, and baseUriDomains', () => {
      const policy = buildInnerCspContent({
        connectDomains: ['https://api.example.com'],
        resourceDomains: ['https://cdn.example.com'],
        frameDomains: ['https://embed.example.com'],
        baseUriDomains: ['https://base.example.com'],
      });
      expect(policy).toContain('connect-src https://api.example.com;');
      expect(policy).toContain(
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https://cdn.example.com;",
      );
      expect(policy).toContain("img-src 'self' data: blob: https://cdn.example.com;");
      expect(policy).toContain('frame-src https://embed.example.com;');
      expect(policy).toContain("base-uri 'self' https://base.example.com;");
    });

    it('filters malformed domain entries containing semicolons, quotes, or whitespace', () => {
      const policy = buildInnerCspContent({
        connectDomains: [
          'https://valid.example.com',
          'https://evil.example.com; script-src *',
          'https://quote.example.com"onload="alert(1)',
        ],
      });
      expect(policy).toContain('connect-src https://valid.example.com;');
      expect(policy).not.toContain('evil.example.com');
      expect(policy).not.toContain('quote.example.com');
    });

    function parseInjected(html: string): Document {
      return new DOMParser().parseFromString(html, 'text/html');
    }

    function injectedMeta(doc: Document): Element | null {
      return doc.head.firstElementChild;
    }

    it('injects the CSP meta tag as the first child of an existing head', () => {
      const withHead = injectCspMeta(
        '<html><head><meta http-equiv="content-security-policy" content="default-src *"><title>Hi</title></head><body></body></html>',
      );
      const doc = parseInjected(withHead);
      const meta = injectedMeta(doc);
      expect(meta?.tagName).toBe('META');
      expect(meta?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
      expect(meta?.getAttribute('content')).toBe(buildInnerCspContent());
      // The author's policy stays; the browser enforces both, so it can only narrow ours.
      expect(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]').length).toBe(2);
      expect(withHead).toContain('default-src *');
      expect(withHead).toContain('<title>Hi</title>');
    });

    it('creates a head with the CSP meta tag for a bare fragment', () => {
      const bare = injectCspMeta('<p>bare</p>');
      const doc = parseInjected(bare);
      const meta = injectedMeta(doc);
      expect(meta?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
      expect(meta?.getAttribute('content')).toBe(buildInnerCspContent());
      expect(bare).toContain('<p>bare</p>');
    });

    it('keeps the doctype of a full document, after a leading comment, and without <html>', () => {
      for (const html of [
        '<!DOCTYPE html><html><head></head><body>x</body></html>',
        '<!-- generated --><!DOCTYPE html><html><head></head><body>x</body></html>',
        '<!DOCTYPE html><p>x</p>',
      ]) {
        const injected = injectCspMeta(html);
        expect(injected.startsWith('<!DOCTYPE html>')).withContext(html).toBeTrue();
        expect(injectedMeta(parseInjected(injected))?.tagName)
          .withContext(html)
          .toBe('META');
      }
    });

    it('omits the doctype when the author did not write one', () => {
      expect(injectCspMeta('<p>x</p>').startsWith('<html>')).toBeTrue();
    });

    it('keeps body attributes of a document without an <html> tag', () => {
      const injected = injectCspMeta('<body class="dark" style="margin: 0"><p>x</p></body>');
      const body = parseInjected(injected).body;
      expect(body.className).toBe('dark');
      expect(body.getAttribute('style')).toBe('margin: 0');
    });

    it('does not XML-escape < or & inside inline scripts and styles', () => {
      // `XMLSerializer` would turn these into `&lt;` / `&amp;`, which `srcdoc` parses as HTML
      // and hands to the script and style engines as broken JS and CSS.
      const injected = injectCspMeta(
        '<style>.a > .b { color: red; }</style><script>if (a < b && c > d) {}</script>',
      );
      expect(injected).toContain('.a > .b { color: red; }');
      expect(injected).toContain('if (a < b && c > d) {}');
    });

    it('leaves comments and template markers in place and still targets the real head', () => {
      const commentedHead = injectCspMeta(
        '<html><!--<head>--><head><title>Real</title></head><body><!--lit-part x--><p>app</p><!--/lit-part--></body></html>',
      );
      expect(commentedHead).toContain('<!--<head>-->');
      expect(commentedHead).toContain('<!--lit-part x-->');
      const doc = parseInjected(commentedHead);
      const meta = injectedMeta(doc);
      expect(meta?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
      expect(meta?.nextElementSibling?.outerHTML).toBe('<title>Real</title>');
      expect(doc.body.innerHTML).toContain('<!--lit-part x--><p>app</p><!--/lit-part-->');
    });
  });

  describe('resource loading', () => {
    beforeEach(() => {
      startSandboxProxy({window: fakeWindow(), document: fakeDocument()});
    });

    it('loads inline HTML from an A2UI resource-ready message', () => {
      dispatch({
        data: {
          type: A2uiSandboxMessageType.SandboxResourceReady,
          html: '<p>hello</p>',
          sandbox: 'allow-scripts',
          permissions: {camera: {}},
        },
        origin: HOST_ORIGIN,
        source: parentWindow,
      });
      const inner = innerFrame();
      expect(inner.srcdoc).toBe(injectCspMeta('<p>hello</p>'));
      expect(inner.srcdoc).toContain("connect-src 'none'");
      expect(inner.getAttribute('sandbox')).toBe('allow-scripts');
      expect(inner.getAttribute('allow')).toBe(
        "camera; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none';",
      );
    });

    it('strips allow-same-origin from custom sandbox flags in resource-ready messages', () => {
      dispatch({
        data: {
          type: A2uiSandboxMessageType.SandboxResourceReady,
          html: '<p>hello</p>',
          sandbox: 'allow-scripts allow-same-origin ALLOW-SAME-ORIGIN allow-forms',
        },
        origin: HOST_ORIGIN,
        source: parentWindow,
      });
      const inner = innerFrame();
      expect(inner.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    });

    it('keeps host-provided sandbox flags as is for a url resource', () => {
      dispatch({
        data: {
          type: A2uiSandboxMessageType.SandboxResourceReady,
          url: 'https://app.example/ui',
          sandbox: 'allow-scripts allow-popups allow-same-origin',
        },
        origin: HOST_ORIGIN,
        source: parentWindow,
      });
      expect(innerFrame().getAttribute('sandbox')).toBe(
        'allow-scripts allow-popups allow-same-origin',
      );
    });

    it('resets the sandbox to the default flags when a later resource omits them', () => {
      dispatch({
        data: {
          type: A2uiSandboxMessageType.SandboxResourceReady,
          html: '<p>first</p>',
          sandbox: 'allow-scripts',
        },
        origin: HOST_ORIGIN,
        source: parentWindow,
      });
      expect(innerFrame().getAttribute('sandbox')).toBe('allow-scripts');

      dispatch({
        data: {
          type: A2uiSandboxMessageType.SandboxResourceReady,
          html: '<p>second</p>',
        },
        origin: HOST_ORIGIN,
        source: parentWindow,
      });
      expect(innerFrame().getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-modals');
    });

    it('loads inline HTML from an MCP Apps resource-ready notification with default CSP', () => {
      dispatch({
        data: {
          jsonrpc: '2.0',
          method: RESOURCE_READY_NOTIFICATION,
          params: {htmlContent: '<p>mcp</p>'},
        },
        origin: HOST_ORIGIN,
        source: parentWindow,
      });
      const inner = innerFrame();
      expect(inner.srcdoc).toBe(injectCspMeta('<p>mcp</p>'));
      expect(inner.srcdoc).toContain("connect-src 'none'");
      expect(inner.getAttribute('sandbox')).toBe(DEFAULT_INNER_SANDBOX);
      expect(inner.getAttribute('allow')).toBe(DENY_ALL);
    });

    it('injects custom CSP domains from an MCP Apps resource-ready notification', () => {
      dispatch({
        data: {
          jsonrpc: '2.0',
          method: RESOURCE_READY_NOTIFICATION,
          params: {
            htmlContent: '<html><head></head><body><p>mcp</p></body></html>',
            csp: {
              connectDomains: ['https://api.example.com'],
              resourceDomains: ['https://cdn.example.com'],
            },
          },
        },
        origin: HOST_ORIGIN,
        source: parentWindow,
      });
      const inner = innerFrame();
      expect(inner.srcdoc).toContain('connect-src https://api.example.com;');
      expect(inner.srcdoc).toContain('https://cdn.example.com');
    });

    it('loads an external URL from a resource-ready message', () => {
      dispatch({
        data: {type: A2uiSandboxMessageType.SandboxResourceReady, url: 'https://app.example/ui'},
        origin: HOST_ORIGIN,
        source: parentWindow,
      });
      expect(innerFrame().src).toBe('https://app.example/ui');
    });

    function sendResource(resource: Record<string, unknown>): void {
      dispatch({
        data: {type: A2uiSandboxMessageType.SandboxResourceReady, ...resource},
        origin: HOST_ORIGIN,
        source: parentWindow,
      });
    }

    function pagePolicies(): string[] {
      return headNodes.map(node => {
        expect(node).toBeInstanceOf(HTMLMetaElement);
        expect((node as HTMLMetaElement).httpEquiv).toBe('Content-Security-Policy');
        return (node as HTMLMetaElement).content;
      });
    }

    it('loads every resource in a fresh inner frame', () => {
      sendResource({html: '<p>first</p>'});
      const first = innerFrame();
      sendResource({html: '<p>second</p>'});
      const second = innerFrame();
      expect(second).not.toBe(first);
      expect(first.isConnected).toBeFalse();
      expect(second.srcdoc).toBe(injectCspMeta('<p>second</p>'));
    });

    it('adds the frame-src policy to its own page before it loads inline HTML', () => {
      sendResource({html: '<p>hi</p>'});
      expect(pagePolicies()).toEqual(["frame-src 'none';"]);
    });

    it('lists the frameDomains of the resource in the page policy', () => {
      dispatch({
        data: {
          jsonrpc: '2.0',
          method: RESOURCE_READY_NOTIFICATION,
          params: {htmlContent: '<p>mcp</p>', csp: {frameDomains: ['https://embed.example.com']}},
        },
        origin: HOST_ORIGIN,
        source: parentWindow,
      });
      expect(pagePolicies()).toEqual(['frame-src https://embed.example.com;']);
    });

    it('adds no page policy for an external URL', () => {
      sendResource({url: 'https://app.example/ui'});
      expect(headNodes).toEqual([]);
    });

    it('keeps its page policy for a later resource that needs the same one', () => {
      sendResource({html: '<p>first</p>'});
      sendResource({html: '<p>second</p>'});
      expect(pagePolicies()).toEqual(["frame-src 'none';"]);
      expect(reload).not.toHaveBeenCalled();
      expect(innerFrame().srcdoc).toBe(injectCspMeta('<p>second</p>'));
    });

    it('reloads itself for a later resource that needs another page policy', () => {
      sendResource({html: '<p>first</p>'});
      const first = innerFrame();
      sendResource({html: '<p>second</p>', csp: {frameDomains: ['https://embed.example.com']}});
      expect(reload).toHaveBeenCalledTimes(1);
      expect(innerFrame()).toBe(first);

      sendResource({url: 'https://app.example/ui'});
      expect(reload).toHaveBeenCalledTimes(2);
      expect(pagePolicies()).toEqual(["frame-src 'none';"]);
    });

    it('loads inline HTML after an external URL in a frame without src', () => {
      sendResource({url: 'https://app.example/ui'});
      expect(innerFrame().src).toBe('https://app.example/ui');

      sendResource({html: '<p>inline</p>'});
      const inner = innerFrame();
      expect(inner.hasAttribute('src')).toBeFalse();
      expect(inner.srcdoc).toBe(injectCspMeta('<p>inline</p>'));
      expect(reload).not.toHaveBeenCalled();
    });

    it('ignores a resource-ready message without html or url', () => {
      const before = innerFrame();
      sendResource({sandbox: 'allow-scripts allow-popups'});
      expect(innerFrame()).toBe(before);
      expect(before.getAttribute('sandbox')).toBe(DEFAULT_INNER_SANDBOX);
      expect(headNodes).toEqual([]);
    });

    it('ignores resource-ready messages from an unexpected origin', () => {
      spyOn(console, 'error');
      dispatch({
        data: {type: A2uiSandboxMessageType.SandboxResourceReady, html: '<p>evil</p>'},
        origin: 'https://evil.example',
        source: parentWindow,
      });
      expect(innerFrame().srcdoc).toBe('');
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('message relay', () => {
    let inner: HTMLIFrameElement;
    let innerWindow: Window;
    let innerPost: jasmine.Spy;

    beforeEach(() => {
      sameOriginInner = true;
      startSandboxProxy({window: fakeWindow(), document: fakeDocument()});
      inner = innerFrame();
      innerWindow = inner.contentWindow!;
      innerPost = spyOn(innerWindow, 'postMessage');
    });

    it('forwards host messages to the inner frame with their ports', () => {
      const channel = new MessageChannel();
      dispatch({
        data: {type: 'a2ui_app_frame_init', value: {}},
        origin: HOST_ORIGIN,
        source: parentWindow,
        ports: [channel.port2],
      });
      expect(innerPost).toHaveBeenCalledWith({type: 'a2ui_app_frame_init', value: {}}, '*', [
        channel.port2,
      ]);
      channel.port1.close();
    });

    it('drops host messages from an unexpected origin', () => {
      spyOn(console, 'error');
      dispatch({data: {type: 'x'}, origin: 'https://evil.example', source: parentWindow});
      expect(innerPost).not.toHaveBeenCalled();
    });

    it('forwards inner frame messages with a null origin to the host only', () => {
      dispatch({data: {type: 'a2ui_app_frame_ready'}, origin: 'null', source: innerWindow});
      expect(parentPost).toHaveBeenCalledWith({type: 'a2ui_app_frame_ready'}, HOST_ORIGIN);
    });

    it('drops inner frame messages with an unexpected origin', () => {
      spyOn(console, 'error');
      parentPost.calls.reset();
      dispatch({data: {type: 'x'}, origin: 'https://evil.example', source: innerWindow});
      expect(parentPost).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });

    it('ignores messages from unrelated windows', () => {
      parentPost.calls.reset();
      dispatch({data: {type: 'x'}, origin: HOST_ORIGIN, source: window});
      expect(innerPost).not.toHaveBeenCalled();
      expect(parentPost).not.toHaveBeenCalled();
    });
  });

  describe('inner frame navigation', () => {
    const [A2UI_REPORT, MCP_REPORT] = createSandboxErrorMessages(
      SandboxErrorCode.InnerFrameNavigated,
      'The sandboxed content navigated away from the document the host sent; the sandbox stopped relaying its messages.',
    );

    let consoleError: jasmine.Spy;

    beforeEach(() => {
      // Same-origin inner frames, so the test can watch the windows the proxy posts to.
      sameOriginInner = true;
      consoleError = spyOn(console, 'error');
      startSandboxProxy({window: fakeWindow(), document: fakeDocument()});
    });

    /** Sends inline HTML and resolves with its frame once that frame has loaded it. */
    async function loadApp(html = '<p>app</p>'): Promise<HTMLIFrameElement> {
      dispatch({
        data: {type: A2uiSandboxMessageType.SandboxResourceReady, html},
        origin: HOST_ORIGIN,
        source: parentWindow,
      });
      const inner = innerFrame();
      await new Promise(resolve => inner.addEventListener('load', resolve, {once: true}));
      return inner;
    }

    function violation(effectiveDirective: string): SecurityPolicyViolationEvent {
      return new SecurityPolicyViolationEvent('securitypolicyviolation', {
        effectiveDirective,
        violatedDirective: effectiveDirective,
        blockedURI: 'https://evil.example/',
        originalPolicy: "frame-src 'none';",
        disposition: 'enforce',
        documentURI: OWN_URL,
        statusCode: 0,
      });
    }

    function expectStopped(navigated: HTMLIFrameElement, navigatedWindow: Window): void {
      // The navigated frame is gone, replaced by an empty one.
      expect(navigated.isConnected).toBeFalse();
      const blank = innerFrame();
      expect(blank).not.toBe(navigated);
      expect(blank.hasAttribute('srcdoc')).toBeFalse();
      expect(blank.hasAttribute('src')).toBeFalse();
      // The host gets the report in both framings.
      expect(parentPost.calls.allArgs()).toEqual([
        [A2UI_REPORT, HOST_ORIGIN],
        [MCP_REPORT, HOST_ORIGIN],
      ]);
      expect(consoleError).toHaveBeenCalled();

      // Nothing crosses in either direction afterwards.
      parentPost.calls.reset();
      const blankPost = spyOn(blank.contentWindow!, 'postMessage');
      dispatch({data: {type: 'a2ui_app_frame_ready'}, origin: 'null', source: navigatedWindow});
      dispatch({data: {type: 'a2ui_app_frame_ready'}, origin: 'null', source: blank.contentWindow});
      dispatch({
        data: {jsonrpc: '2.0', id: 1, result: {}},
        origin: HOST_ORIGIN,
        source: parentWindow,
      });
      expect(parentPost).not.toHaveBeenCalled();
      expect(blankPost).not.toHaveBeenCalled();
    }

    it('relays and reports nothing while the frame shows its document', async () => {
      const inner = await loadApp();
      parentPost.calls.reset();
      dispatch({data: {type: 'a2ui_app_frame_ready'}, origin: 'null', source: inner.contentWindow});
      expect(parentPost.calls.allArgs()).toEqual([[{type: 'a2ui_app_frame_ready'}, HOST_ORIGIN]]);
      expect(innerFrame()).toBe(inner);
    });

    it('treats a second load without a new resource as a navigation', async () => {
      const inner = await loadApp();
      const innerWindow = inner.contentWindow!;
      const innerPost = spyOn(innerWindow, 'postMessage');
      parentPost.calls.reset();

      inner.dispatchEvent(new Event('load'));

      // The navigated document never gets `sandbox-init`.
      expect(innerPost).not.toHaveBeenCalled();
      expectStopped(inner, innerWindow);
    });

    it('treats a frame-src violation of its page as a navigation', async () => {
      const inner = await loadApp();
      const innerWindow = inner.contentWindow!;
      parentPost.calls.reset();
      expect(violationListeners.length).toBe(1);

      violationListeners[0](violation('script-src'));
      expect(parentPost).not.toHaveBeenCalled();

      violationListeners[0](violation('frame-src'));
      expectStopped(inner, innerWindow);
    });

    it('reports a navigation once', async () => {
      const inner = await loadApp();
      inner.dispatchEvent(new Event('load'));
      violationListeners[0](violation('frame-src'));
      innerFrame().dispatchEvent(new Event('load'));
      const reports = parentPost.calls
        .allArgs()
        .filter(([data]) => (data as {type?: string}).type === A2uiSandboxMessageType.SandboxError);
      expect(reports.length).toBe(1);
    });

    it('relays again once the host sends a new resource', async () => {
      const first = await loadApp();
      first.dispatchEvent(new Event('load'));

      const second = await loadApp('<p>again</p>');
      parentPost.calls.reset();
      dispatch({
        data: {type: 'a2ui_app_frame_ready'},
        origin: 'null',
        source: second.contentWindow,
      });
      expect(parentPost.calls.allArgs()).toEqual([[{type: 'a2ui_app_frame_ready'}, HOST_ORIGIN]]);
    });
  });
});

/**
 * Regression tests for an escape through self-navigation, with the real proxy page that the
 * package's Karma configuration serves from `dist/sandbox/` at `/a2ui-sandbox/`. Content that set
 * `location.href` used to keep the bridge in its new document, outside the injected CSP: the proxy
 * relayed the snapshot to it and its writes and actions to the host.
 */
describe('the real proxy page when the content navigates itself', () => {
  /** Content that says hello, then navigates to the URL the host sends it. */
  const APP = `<script>
    addEventListener('message', event => {
      if (event.data && event.data.navigate) location.href = event.data.navigate;
      if (event.data && event.data.hash) location.hash = event.data.hash;
      if (event.data && event.data.ping) parent.postMessage({app: 'pong'}, '*');
    });
    parent.postMessage({app: 'hello'}, '*');
  </script>`;

  /** A document that speaks to the bridge as soon as it runs, and echoes what it receives. */
  const EVIL_DOCUMENT = `<script>
    parent.postMessage({evil: 'initialize'}, '*');
    setInterval(() => parent.postMessage({evil: 'tick'}, '*'), 20);
    addEventListener('message', event => parent.postMessage({evil: 'echo', data: event.data}, '*'));
  </script>`;

  let hostFrame: HTMLIFrameElement;
  let received: unknown[];
  let violations: string[];
  let onMessage: (event: MessageEvent) => void;

  async function waitFor(predicate: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 600 && !predicate(); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(predicate()).withContext(what).toBeTrue();
  }

  function receivedWith(key: string, value?: unknown): unknown[] {
    return received.filter(
      data =>
        typeof data === 'object' &&
        data !== null &&
        key in data &&
        (value === undefined || (data as Record<string, unknown>)[key] === value),
    );
  }

  function postToProxy(data: unknown): void {
    hostFrame.contentWindow!.postMessage(data, window.location.origin);
  }

  beforeEach(async () => {
    received = [];
    violations = [];
    onMessage = event => {
      if (event.source === hostFrame.contentWindow) {
        received.push(event.data);
      }
    };
    window.addEventListener('message', onMessage);
    hostFrame = document.createElement('iframe');
    hostFrame.src = resolveSandboxUrl('html').href;
    document.body.appendChild(hostFrame);
    await waitFor(
      () => receivedWith('type', A2uiSandboxMessageType.SandboxProxyReady).length > 0,
      'the proxy is ready',
    );
    // The proxy page is same-origin here, so the test can watch its policy violations.
    hostFrame.contentDocument!.addEventListener('securitypolicyviolation', event => {
      violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
    postToProxy({type: A2uiSandboxMessageType.SandboxResourceReady, html: APP});
    await waitFor(() => receivedWith('app', 'hello').length > 0, 'the app said hello');
  });

  afterEach(() => {
    window.removeEventListener('message', onMessage);
    hostFrame.remove();
  });

  async function navigateAndExpectStop(url: string): Promise<void> {
    postToProxy({navigate: url});
    await waitFor(
      () => receivedWith('type', A2uiSandboxMessageType.SandboxError).length > 0,
      'the proxy reported the navigation',
    );
    expect(receivedWith('type', A2uiSandboxMessageType.SandboxError)).toEqual([
      jasmine.objectContaining({code: SandboxErrorCode.InnerFrameNavigated}),
    ]);
    expect(receivedWith('method', LOGGING_MESSAGE_NOTIFICATION)).toEqual([
      jasmine.objectContaining({
        params: jasmine.objectContaining({level: 'error', logger: SANDBOX_PROXY_LOGGER}),
      }),
    ]);

    // Nothing crosses the bridge afterwards, in either direction.
    const countAfterReport = received.length;
    postToProxy({ping: 1});
    postToProxy({jsonrpc: '2.0', id: 1, result: {snapshot: {secret: 42}}});
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(receivedWith('evil')).toEqual([]);
    expect(receivedWith('app', 'pong')).toEqual([]);
    expect(received.length).toBe(countAfterReport);

    // The proxy dropped the navigated frame.
    const inner = hostFrame.contentDocument!.querySelector('iframe')!;
    expect(inner.hasAttribute('srcdoc')).toBeFalse();
    expect(inner.hasAttribute('src')).toBeFalse();
  }

  it('relays normally while the content keeps its document', async () => {
    postToProxy({ping: 1});
    await waitFor(() => receivedWith('app', 'pong').length > 0, 'the app answered');
    expect(receivedWith('type', A2uiSandboxMessageType.SandboxError)).toEqual([]);
  });

  it('refuses a network navigation before it is requested and stops relaying', async () => {
    const target = new URL('/a2ui-sandbox/escape-target.html', window.location.href).href;
    await navigateAndExpectStop(target);
    // Cross-origin reports carry only the origin of the blocked URL.
    expect(violations.some(v => v.startsWith(`frame-src ${window.location.origin}`)))
      .withContext(violations.join(', '))
      .toBeTrue();
  });

  it('gives a navigated document nothing, even one that inherits the CSP', async () => {
    await navigateAndExpectStop(`data:text/html,${encodeURIComponent(EVIL_DOCUMENT)}`);
  });

  it('allows same-document navigation such as a fragment change', async () => {
    // `location.hash` stays in the document. `location.href = '#section'` would not: a `srcdoc`
    // document resolves URLs against the proxy page's URL, so that is a navigation to the proxy.
    postToProxy({hash: 'section'});
    await new Promise(resolve => setTimeout(resolve, 200));
    postToProxy({ping: 1});
    await waitFor(() => receivedWith('app', 'pong').length > 0, 'the app answered');
    expect(receivedWith('type', A2uiSandboxMessageType.SandboxError)).toEqual([]);
  });
});
