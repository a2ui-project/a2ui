/**
 * Copyright 2026 Google LLC
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

const WebAppFrameUrlPropsSchema = WebAppFrameBasePropsSchema.extend({
  url: z.string().optional(),
});

export interface WebAppFrameUrlApi extends ComponentApi<typeof WebAppFrameUrlPropsSchema> {
  name: 'WebAppFrameUrl';
}

const INVALID_ORIGIN = 'about:invalid';

@Component({
  selector: 'a2ui-web-app-frame-url',
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
export class WebAppFrameUrl extends CatalogComponent<WebAppFrameUrlApi> {
  private readonly sanitizer = inject(DomSanitizer);
  readonly bridge = inject(WebAppFrameBridgeService);

  protected readonly iframeSrc = signal<SafeResourceUrl | null>(
    this.sanitizer.bypassSecurityTrustResourceUrl('about:blank'),
  );

  protected readonly targetUrl = computed<string | null>(() => {
    const urlProp = this.props()['url']?.value();
    if (urlProp && typeof urlProp === 'string') {
      try {
        const url = new URL(urlProp);
        // Restrict to http: or https: schemes to prevent javascript:/data:/file: URI injection
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          console.warn(`[WebAppFrameUrl] Disallowed protocol: ${url.protocol}`);
          return null;
        }
        url.searchParams.set('origin', window.location.origin);
        return url.toString();
      } catch {
        return null;
      }
    }
    return null;
  });

  protected readonly expectedOrigin = computed<string>(() => {
    const urlProp = this.props()['url']?.value();
    if (urlProp && typeof urlProp === 'string') {
      try {
        const url = new URL(urlProp);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          return url.origin;
        }
      } catch {
        return INVALID_ORIGIN;
      }
    }
    return INVALID_ORIGIN;
  });

  private iframe = viewChild.required<ElementRef<HTMLIFrameElement>>('iframe');

  constructor() {
    super();

    const urlParams = new URLSearchParams(window.location.search);
    const disableSecuritySelfTest = urlParams.get('disable_security_self_test') === 'true';

    const currentOrigin = window.location.origin;
    let sandboxUrl = `${currentOrigin}/mcp_apps_inner_iframe/sandbox-url.html`;
    if (disableSecuritySelfTest) {
      sandboxUrl += '?disable_security_self_test=true';
    }
    this.iframeSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(sandboxUrl));

    this.bridge.initialize({
      iframe: this.iframe,
      props: this.props,
      surfaceId: this.surfaceId,
      componentId: this.componentId,
      getExpectedOrigin: () => this.expectedOrigin(),
      onSandboxProxyReady: iframeEl => this.handleSandboxProxyReady(iframeEl),
    });
  }

  private handleSandboxProxyReady(iframeEl: HTMLIFrameElement) {
    const targetUrl = this.targetUrl();
    if (targetUrl && iframeEl.contentWindow) {
      iframeEl.contentWindow.postMessage(
        {
          type: A2uiMessageType.SandboxResourceReady,
          url: targetUrl,
        },
        window.location.origin,
      );
    }
  }
}
