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
 * @vitest-environment jsdom
 */

import '@angular/compiler';
import {Injector, runInInjectionContext, signal} from '@angular/core';
import {DomSanitizer} from '@angular/platform-browser';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {WebAppFrameSrcdoc} from './web-app-frame-srcdoc';
import {WebAppFrameBridgeConfig, WebAppFrameBridgeService} from './web-app-frame-bridge.service';
import {A2uiMessageType} from './web-frame-messages';

describe('WebAppFrameSrcdoc', () => {
  interface HarnessOptions {
    htmlContent?: string | null;
    queryString?: string;
  }

  function createHarness(options: HarnessOptions = {}) {
    if (options.queryString !== undefined) {
      window.history.replaceState({}, '', `/app${options.queryString}`);
    } else {
      window.history.replaceState({}, '', '/app');
    }

    let capturedBridgeConfig: WebAppFrameBridgeConfig | null = null;
    const mockSanitizer = {
      bypassSecurityTrustResourceUrl: vi.fn((url: string) => `safe:${url}`),
    };
    const mockBridge = {
      initialize: vi.fn((config: WebAppFrameBridgeConfig) => {
        capturedBridgeConfig = config;
      }),
    };

    const injector = Injector.create({
      providers: [
        {provide: DomSanitizer, useValue: mockSanitizer},
        {provide: WebAppFrameBridgeService, useValue: mockBridge},
      ],
    });

    const component = runInInjectionContext(injector, () => new WebAppFrameSrcdoc());

    if (options.htmlContent !== undefined) {
      const mockedProps = () => ({
        htmlContent: options.htmlContent !== null ? {value: () => options.htmlContent} : undefined,
      });
      Object.defineProperty(component, 'props', {
        value: mockedProps,
        writable: true,
      });
      if (capturedBridgeConfig) {
        (capturedBridgeConfig as any).props = mockedProps;
      }
    }

    const postMessageSpy = vi.fn();
    const mockIframeEl = {
      contentWindow: {
        postMessage: postMessageSpy,
      },
    } as unknown as HTMLIFrameElement;

    return {
      component,
      mockBridge,
      mockSanitizer,
      getBridgeConfig: () => capturedBridgeConfig!,
      mockIframeEl,
      postMessageSpy,
      triggerSandboxReady: (iframe: HTMLIFrameElement = mockIframeEl) => {
        capturedBridgeConfig?.onSandboxProxyReady(iframe);
      },
    };
  }

  beforeEach(() => {
    window.history.replaceState({}, '', '/app');
  });

  describe('initialization & sandbox URL configuration', () => {
    it('configures default sandbox URL and registers with bridge', () => {
      const harness = createHarness();
      expect(harness.mockBridge.initialize).toHaveBeenCalled();

      const bridgeConfig = harness.getBridgeConfig();
      expect(bridgeConfig).toBeDefined();
      expect(bridgeConfig.getExpectedOrigin()).toBe(window.location.origin);

      expect(harness.mockSanitizer.bypassSecurityTrustResourceUrl).toHaveBeenCalledWith(
        `${window.location.origin}/mcp_apps_inner_iframe/sandbox.html`,
      );
    });

    it('passes disable_security_self_test query param when enabled in page URL', () => {
      const harness = createHarness({queryString: '?disable_security_self_test=true'});
      expect(harness.mockSanitizer.bypassSecurityTrustResourceUrl).toHaveBeenCalledWith(
        `${window.location.origin}/mcp_apps_inner_iframe/sandbox.html?disable_security_self_test=true`,
      );
    });
  });

  describe('sandbox proxy ready & CSP enforcement behavior', () => {
    it('posts SandboxResourceReady message with strict CSP and sandbox flags', () => {
      const inputHtml = '<html><head><title>App</title></head><body>Content</body></html>';
      const harness = createHarness({htmlContent: inputHtml});

      harness.triggerSandboxReady();

      expect(harness.postMessageSpy).toHaveBeenCalledTimes(1);
      const [message, targetOrigin] = harness.postMessageSpy.mock.calls[0];

      expect(targetOrigin).toBe(window.location.origin);
      expect(message.type).toBe(A2uiMessageType.SandboxResourceReady);
      expect(message.sandbox).toBe('allow-scripts allow-forms allow-modals');

      // Verify all essential CSP restrictions are enforced in injected markup
      expect(message.html).toContain("connect-src 'none'");
      expect(message.html).toContain("form-action 'none'");
      expect(message.html).toContain("base-uri 'none'");
      expect(message.html).toContain("object-src 'none'");
      expect(message.html).toContain("frame-src 'none'");
      expect(message.html).toContain("default-src 'self' 'unsafe-inline' 'unsafe-eval' data:");
      expect(message.html).toMatch(/<head>\s*<meta http-equiv="Content-Security-Policy"/);
      expect(message.htmlContent).toBe(message.html);
    });

    it('synthesizes <head> inside <html> when <head> is missing', () => {
      const inputHtml = '<html><body><h1>No Head</h1></body></html>';
      const harness = createHarness({htmlContent: inputHtml});

      harness.triggerSandboxReady();

      expect(harness.postMessageSpy).toHaveBeenCalledTimes(1);
      const [message] = harness.postMessageSpy.mock.calls[0];

      expect(message.html).toMatch(/<html>\s*<head>\s*<meta http-equiv="Content-Security-Policy"/);
      expect(message.html).toContain('<h1>No Head</h1>');
    });

    it('wraps raw HTML snippet with <head> and CSP when document tags are absent', () => {
      const inputHtml = '<button id="btn">Click me</button>';
      const harness = createHarness({htmlContent: inputHtml});

      harness.triggerSandboxReady();

      expect(harness.postMessageSpy).toHaveBeenCalledTimes(1);
      const [message] = harness.postMessageSpy.mock.calls[0];

      expect(message.html).toMatch(/^<head>\s*<meta http-equiv="Content-Security-Policy"/);
      expect(message.html).toContain('<button id="btn">Click me</button>');
    });

    it('strips preexisting author CSP meta tags to prevent policy override bypasses', () => {
      const inputHtml =
        '<html><head><meta http-equiv="Content-Security-Policy" content="connect-src *;"><title>Test</title></head><body></body></html>';
      const harness = createHarness({htmlContent: inputHtml});

      harness.triggerSandboxReady();

      expect(harness.postMessageSpy).toHaveBeenCalledTimes(1);
      const [message] = harness.postMessageSpy.mock.calls[0];

      expect(message.html).not.toContain('connect-src *');
      expect(message.html).toContain("connect-src 'none'");
    });

    it('decodes url_encoded content before injecting CSP and posting', () => {
      const rawHtml = '<div><span>Encoded Component</span></div>';
      const encodedProp = `url_encoded:${encodeURIComponent(rawHtml)}`;
      const harness = createHarness({htmlContent: encodedProp});

      harness.triggerSandboxReady();

      expect(harness.postMessageSpy).toHaveBeenCalledTimes(1);
      const [message] = harness.postMessageSpy.mock.calls[0];

      expect(message.html).toContain('<span>Encoded Component</span>');
      expect(message.html).toContain("connect-src 'none'");
    });

    it('does not post message if htmlContent is null or empty', () => {
      const harness = createHarness({htmlContent: null});

      harness.triggerSandboxReady();

      expect(harness.postMessageSpy).not.toHaveBeenCalled();
    });

    it('handles iframe without contentWindow gracefully', () => {
      const harness = createHarness({htmlContent: '<div>Content</div>'});
      const iframeWithoutWindow = {contentWindow: null} as unknown as HTMLIFrameElement;

      expect(() => harness.triggerSandboxReady(iframeWithoutWindow)).not.toThrow();
      expect(harness.postMessageSpy).not.toHaveBeenCalled();
    });
  });
});
