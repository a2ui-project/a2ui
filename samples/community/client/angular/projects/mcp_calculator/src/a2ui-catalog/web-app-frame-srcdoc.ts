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

import {CatalogComponent} from '@a2ui/angular/v0_9';
import {ComponentApi} from '@a2ui/web_core/v0_9';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {DomSanitizer, SafeResourceUrl} from '@angular/platform-browser';
import {z} from 'zod';
import {WebAppFrameBridgeService} from './web-app-frame-bridge.service';
import {A2uiMessageType, WebAppFrameBasePropsSchema} from './web-frame-messages';

const WebAppFrameSrcdocPropsSchema = WebAppFrameBasePropsSchema.extend({
  htmlContent: z.string().optional(),
});

export interface WebAppFrameSrcdocApi extends ComponentApi<typeof WebAppFrameSrcdocPropsSchema> {
  name: 'WebAppFrameSrcdoc';
}

/**
 * Default Content Security Policy enforced on untrusted HTML rendered in WebAppFrameSrcdoc.
 */
const DEFAULT_INJECTED_CSP =
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none';";

@Component({
  selector: 'a2ui-web-app-frame-srcdoc',
  standalone: true,
  imports: [],
  providers: [WebAppFrameBridgeService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 500px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      overflow: hidden;
      position: relative;
    }

    iframe {
      flex: 1;
      max-width: 100%;
      max-height: 100%;
      border: none;
      background-color: white; /* Ensure content is readable */
    }
  `,
  template: ` <iframe #iframe [src]="iframeSrc()" [title]="'WebAppFrame'"></iframe> `,
})
export class WebAppFrameSrcdoc extends CatalogComponent<WebAppFrameSrcdocApi> {
  private readonly sanitizer = inject(DomSanitizer);
  readonly bridge = inject(WebAppFrameBridgeService);

  protected readonly resolvedContent = computed<string | null>(() => {
    let rawContent = this.props()['htmlContent']?.value() ?? null;
    if (rawContent && typeof rawContent === 'string' && rawContent.startsWith('url_encoded:')) {
      rawContent = decodeURIComponent(rawContent.substring(12));
    }
    return typeof rawContent === 'string' ? rawContent : null;
  });

  protected readonly iframeSrc = signal<SafeResourceUrl | null>(
    this.sanitizer.bypassSecurityTrustResourceUrl('about:blank'),
  );

  private iframe = viewChild.required<ElementRef<HTMLIFrameElement>>('iframe');

  constructor() {
    super();

    const urlParams = new URLSearchParams(window.location.search);
    const disableSecuritySelfTest = urlParams.get('disable_security_self_test') === 'true';

    const currentOrigin = window.location.origin;
    let sandboxUrl = `${currentOrigin}/mcp_apps_inner_iframe/sandbox.html`;
    if (disableSecuritySelfTest) {
      sandboxUrl += '?disable_security_self_test=true';
    }
    this.iframeSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(sandboxUrl));

    this.bridge.initialize({
      iframe: this.iframe,
      props: this.props,
      surfaceId: this.surfaceId,
      componentId: this.componentId,
      getExpectedOrigin: () => window.location.origin,
      onSandboxProxyReady: iframeEl => this.handleSandboxProxyReady(iframeEl),
    });
  }

  /**
   * Injects a Content-Security-Policy (CSP) meta tag into the provided HTML string.
   *
   * Any existing CSP meta tags in the HTML are stripped and replaced with a restricted
   * default policy (`default-src 'self' 'unsafe-inline' 'unsafe-eval' data:; connect-src 'none'; form-action 'none';
   * base-uri 'none'; object-src 'none'; frame-src 'none';`).
   * The CSP meta tag is injected into the `<head>` element, creating one if necessary.
   *
   * **Expected Effects of the Injected CSP:**
   * - Injects mandatory restricted policy which cannot be relaxed by any author-supplied CSP.
   * - Stripping preexisting CSP tags prevents author-supplied restrictive policies from unintentionally breaking iframe rendering.
   * - Blocks all outgoing network connections (`connect-src 'none'`), disabling `fetch`, `XMLHttpRequest`,
   *   `WebSocket`, and `EventSource` calls from within the sandbox iframe.
   * - Blocks form-based exfiltration (`form-action 'none'`), closing HTML form navigation and submission
   *   bypasses to external endpoints even when `allow-forms` is enabled in sandbox attributes.
   * - Blocks base URL hijacking (`base-uri 'none'`), preventing untrusted HTML from redirecting relative
   *   links or resource URLs to external origins.
   * - Blocks legacy plugin objects and nested subframes (`object-src 'none'; frame-src 'none'`).
   * - Restricts resource loading (`default-src`) to same-origin scripts/styles (`'self'`), inline code
   *   (`'unsafe-inline'`), dynamic eval execution (`'unsafe-eval'`), and `data:` URIs.
   *
   * @param html The raw HTML content string.
   * @returns The HTML string with the CSP meta tag injected.
   */
  private injectCspAndInterceptors(html: string): string {
    let result = html.replace(
      /<meta\s+(?:[^>]*?\s+)?http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi,
      '',
    );

    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${DEFAULT_INJECTED_CSP}">`;
    const interceptorScript = `<script>
      document.addEventListener('click', (e) => {
        const anchor = e.target.closest('a');
        if (anchor && anchor.href) {
          const href = anchor.getAttribute('href');
          if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            e.preventDefault();
            e.stopPropagation();
            window.parent.postMessage({
              type: 'a2ui_action',
              action: 'open_url',
              data: { url: anchor.href }
            }, '*');
          }
        }
      }, true);
    </script>`;

    const injectedContent = `${cspMeta}\n    ${interceptorScript}`;

    if (/(<head[^>]*>)/i.test(result)) {
      result = result.replace(/(<head[^>]*>)/i, `$1\n    ${injectedContent}`);
    } else if (/(<html[^>]*>)/i.test(result)) {
      result = result.replace(/(<html[^>]*>)/i, `$1\n  <head>\n    ${injectedContent}\n  </head>`);
    } else {
      result = `<head>\n  ${injectedContent}\n</head>\n` + result;
    }

    return result;
  }

  private handleSandboxProxyReady(iframeEl: HTMLIFrameElement) {
    const rawContent = this.resolvedContent();
    if (rawContent && iframeEl.contentWindow) {
      const securedHtml = this.injectCspAndInterceptors(rawContent);
      iframeEl.contentWindow.postMessage(
        {
          type: A2uiMessageType.SandboxResourceReady,
          html: securedHtml,
          htmlContent: securedHtml,
          // Omits allow-same-origin (origin isolation), allow-top-navigation (frame-busting defense), and allow-popups (1-click hyperlink exfiltration defense)
          sandbox: 'allow-scripts allow-forms allow-modals',
        },
        window.location.origin,
      );
    }
  }
}
