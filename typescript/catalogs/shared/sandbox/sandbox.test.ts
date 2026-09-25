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
  buildPermissionsPolicy,
  createAllowedReferrerPattern,
  DEFAULT_INNER_SANDBOX,
  HOST_ORIGINS_META_NAME,
  normalizeOrigin,
  PROXY_READY_NOTIFICATION,
  readAllowedHostOrigins,
  RESOURCE_READY_NOTIFICATION,
  SENSITIVE_PERMISSIONS,
  startSandboxProxy,
  type SandboxProxyDocument,
  type SandboxProxyWindow,
} from './sandbox.js';

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
});

describe('startSandboxProxy', () => {
  const OWN_URL = 'https://host.example/a2ui-sandbox/sandbox.html';
  const HOST_ORIGIN = 'https://host.example';

  let container: HTMLDivElement;
  let parentFrame: HTMLIFrameElement;
  let parentWindow: Window;
  let parentPost: jasmine.Spy;
  let listeners: Array<(event: MessageEvent) => void>;
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
    metaContent = null;
    sameOriginInner = false;
  });

  afterEach(() => {
    container.remove();
  });

  function secureTop(): SandboxProxyWindow['top'] {
    return {
      alert: () => {
        throw new DOMException(
          'Blocked a frame from accessing a cross-origin frame.',
          'SecurityError',
        );
      },
    };
  }

  function fakeWindow(overrides: Partial<SandboxProxyWindow> = {}): SandboxProxyWindow {
    const href = overrides.location?.href ?? `${OWN_URL}?disable_security_self_test=true`;
    return {
      self: {},
      top: secureTop(),
      parent: parentWindow,
      location: {href, search: new URL(href).search},
      addEventListener: (_type, listener) => {
        listeners.push(listener);
      },
      ...overrides,
    };
  }

  function fakeDocument(referrer = `${HOST_ORIGIN}/app`): SandboxProxyDocument {
    return {
      referrer,
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
      createElement: () => document.createElement('iframe'),
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
        window: fakeWindow({location: {href, search: new URL(href).search}}),
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
      const alert = jasmine.createSpy('alert');
      const win = fakeWindow({top: {alert}, location: {href: OWN_URL, search: ''}});
      expect(() => startSandboxProxy({window: win, document: fakeDocument()})).toThrowError(
        /not setup securely/,
      );
      expect(alert).toHaveBeenCalled();
    });

    it('passes when the top window is cross-origin', () => {
      const win = fakeWindow({location: {href: OWN_URL, search: ''}});
      startSandboxProxy({window: win, document: fakeDocument()});
      expect(parentPost).toHaveBeenCalledTimes(2);
    });

    it('is skipped with disable_security_self_test=true', () => {
      const alert = jasmine.createSpy('alert');
      startSandboxProxy({window: fakeWindow({top: {alert}}), document: fakeDocument()});
      expect(alert).not.toHaveBeenCalled();
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
      expect(inner.srcdoc).toBe('<p>hello</p>');
      expect(inner.getAttribute('sandbox')).toBe('allow-scripts');
      expect(inner.getAttribute('allow')).toBe(
        "camera; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none';",
      );
    });

    it('loads inline HTML from an MCP Apps resource-ready notification', () => {
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
      expect(inner.srcdoc).toBe('<p>mcp</p>');
      expect(inner.getAttribute('sandbox')).toBe(DEFAULT_INNER_SANDBOX);
      expect(inner.getAttribute('allow')).toBe(DENY_ALL);
    });

    it('loads an external URL from a resource-ready message', () => {
      dispatch({
        data: {type: A2uiSandboxMessageType.SandboxResourceReady, url: 'https://app.example/ui'},
        origin: HOST_ORIGIN,
        source: parentWindow,
      });
      expect(innerFrame().src).toBe('https://app.example/ui');
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
});
