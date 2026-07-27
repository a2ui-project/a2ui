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

import {CatalogComponent, A2uiRendererService} from '@a2ui/angular/v0_9';
import {DataContext} from '@a2ui/web_core/v0_9';
import {z} from 'zod';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import {DomSanitizer, SafeResourceUrl} from '@angular/platform-browser';

@Component({
  selector: 'a2ui-web-app-frame-url',
  standalone: true,
  imports: [],
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
export class WebAppFrameUrl extends CatalogComponent<any> implements OnDestroy, OnInit {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly rendererService = inject(A2uiRendererService);

  protected readonly allowedEvents = computed<string[]>(
    () => this.props()['allowedEvents']?.value() || [],
  );
  protected readonly allowedFunctions = computed<string[]>(
    () => this.props()['allowedFunctions']?.value() || [],
  );

  protected readonly iframeSrc = signal<SafeResourceUrl | null>(
    this.sanitizer.bypassSecurityTrustResourceUrl('about:blank'),
  );

  private iframe = viewChild.required<ElementRef<HTMLIFrameElement>>('iframe');
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private dataSubscriptions: any[] = [];
  private resizeTimeout: any = null;
  private lastWidth?: number;
  private lastHeight?: number;
  private lastBoundRootValues: Record<string, string> = {};
  private isProcessingAppWrite = false;
  private expectedOrigin = window.location.origin; // In production this should be validated
  private targetUrl: string | null = null;

  private appPort: MessagePort | null = null;
  private hostResizeObserver: ResizeObserver | null = null;

  ngOnInit() {
    const urlProp = this.props()['url']?.value();
    if (urlProp && typeof urlProp === 'string') {
      const url = new URL(urlProp);
      url.searchParams.set('origin', window.location.origin);
      this.expectedOrigin = url.origin;
      this.targetUrl = url.toString();
    }

    const urlParams = new URLSearchParams(window.location.search);
    const disableSecuritySelfTest = urlParams.get('disable_security_self_test') === 'true';

    const currentOrigin = window.location.origin;
    let sandboxUrl = `${currentOrigin}/mcp_apps_inner_iframe/sandbox-url.html`;
    if (disableSecuritySelfTest) {
      sandboxUrl += '?disable_security_self_test=true';
    }
    this.iframeSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(sandboxUrl));

    this.setupSandbox();
  }

  ngOnDestroy() {
    this.clearDataSubscriptions();
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
    }
    if (this.hostResizeObserver) {
      this.hostResizeObserver.disconnect();
      this.hostResizeObserver = null;
    }
  }

  private clearDataSubscriptions() {
    if (this.dataSubscriptions) {
      this.dataSubscriptions.forEach(sub => sub.unsubscribe());
      this.dataSubscriptions = [];
    }
  }

  private handleSizeChange(width?: number, height?: number) {
    if (this.resizeTimeout) {
      return;
    }

    this.resizeTimeout = setTimeout(() => {
      this.resizeTimeout = null;
      const iframeEl = this.iframe().nativeElement;
      if (!iframeEl) return;

      const targetWidth = width !== undefined ? Math.max(200, Math.min(width, 3000)) : undefined;
      const targetHeight = height !== undefined ? Math.max(100, Math.min(height, 2000)) : undefined;

      const widthDiff =
        targetWidth !== undefined && this.lastWidth !== undefined
          ? Math.abs(targetWidth - this.lastWidth)
          : 100;
      const heightDiff =
        targetHeight !== undefined && this.lastHeight !== undefined
          ? Math.abs(targetHeight - this.lastHeight)
          : 100;

      if (targetWidth !== undefined && widthDiff >= 5) {
        iframeEl.style.width = `${targetWidth}px`;
        const parent = iframeEl.parentElement;
        if (parent) {
          parent.style.width = `${targetWidth}px`;
        }
        this.lastWidth = targetWidth;
      }

      if (targetHeight !== undefined && heightDiff >= 5) {
        iframeEl.style.height = `${targetHeight}px`;
        const parent = iframeEl.parentElement;
        if (parent) {
          parent.style.height = `${targetHeight}px`;
          parent.style.aspectRatio = 'auto';
        }
        this.lastHeight = targetHeight;
      }
    }, 100);
  }

  private setupSandbox() {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
    }

    this.messageHandler = async (event: MessageEvent) => {
      // Basic origin check
      if (event.origin !== this.expectedOrigin && event.origin !== window.location.origin) {
        return;
      }

      const iframeEl = this.iframe().nativeElement;
      if (!iframeEl || event.source !== iframeEl.contentWindow) {
        return;
      }

      const data = event.data;
      if (!data) return;

      if (data.type === 'a2ui_sandbox_proxy_ready') {
        if (this.targetUrl && iframeEl.contentWindow) {
          iframeEl.contentWindow.postMessage(
            {
              type: 'a2ui_sandbox_resource_ready',
              url: this.targetUrl,
            },
            '*',
          );
        }
        return;
      }

      if (data.type === 'a2ui_app_frame_ready') {
        this.initializeBridge();
      } else if (data.type === 'a2ui_action') {
        if (this.allowedEvents().includes(data.action)) {
          const surface = this.rendererService.surfaceGroup.getSurface(this.surfaceId());
          if (surface) {
            surface.dispatchAction(
              {
                event: {
                  name: data.action,
                  context: data.data || {},
                },
              },
              this.componentId(),
            );
          }
        } else {
          console.warn(`Action ${data.action} not in allowedEvents`);
        }
      } else if (data.type === 'a2ui_data_model_change') {
        const surface = this.rendererService.surfaceGroup.getSurface(this.surfaceId());
        if (surface) {
          const dataPaths: Record<string, string> =
            (this.props()['data']?.raw as any)?.paths ?? this.props()['data']?.value()?.paths ?? {};

          if (dataPaths[data.key]) {
            const dataPath = dataPaths[data.key];
            const targetPath = data.subpath
              ? `${dataPath}${data.subpath.startsWith('/') ? '' : '/'}${data.subpath}`
              : dataPath;

            const currentValue = surface.dataModel.get(targetPath);
            if (JSON.stringify(currentValue) !== JSON.stringify(data.value)) {
              this.isProcessingAppWrite = true;
              try {
                surface.dataModel.set(targetPath, data.value);
              } finally {
                this.isProcessingAppWrite = false;
              }
            }
          }
        }
      } else if (data.type === 'a2ui_function_call') {
        if (this.allowedFunctions().includes(data.call)) {
          const surface = this.rendererService.surfaceGroup.getSurface(this.surfaceId());
          if (surface) {
            const dataContext = new DataContext(surface, '/');
            try {
              const result = await surface.catalog.invoker(data.call, data.args || {}, dataContext);
              if (iframeEl.contentWindow) {
                iframeEl.contentWindow.postMessage(
                  {
                    type: 'a2ui_function_result',
                    call: data.call,
                    callId: data.callId,
                    status: 'success',
                    result: result,
                  },
                  '*',
                );
              }
            } catch (err: any) {
              if (iframeEl.contentWindow) {
                iframeEl.contentWindow.postMessage(
                  {
                    type: 'a2ui_function_result',
                    call: data.call,
                    callId: data.callId,
                    status: 'error',
                    error: {
                      code: 'EXECUTION_ERROR',
                      message: err.message || 'Error executing function',
                    },
                  },
                  '*',
                );
              }
            }
          }
        } else {
          console.warn(`Function ${data.call} not in allowedFunctions`);
        }
      } else if (data.type === 'a2ui_size_changed') {
        this.handleSizeChange(data.width, data.height);
      }
    };

    window.addEventListener('message', this.messageHandler);
  }

  private initializeBridge() {
    this.clearDataSubscriptions();

    const surface = this.rendererService.surfaceGroup.getSurface(this.surfaceId());
    const dataPaths: Record<string, string> =
      (this.props()['data']?.raw as any)?.paths ?? this.props()['data']?.value()?.paths ?? {};

    const initialData: Record<string, any> = {};

    if (surface && Object.keys(dataPaths).length > 0) {
      for (const [key, dataPath] of Object.entries(dataPaths)) {
        initialData[key] = surface.dataModel.get(dataPath);
        this.lastBoundRootValues[key] = JSON.stringify(initialData[key] ?? null);

        const sub = surface.dataModel.subscribe(dataPath, value => {
          if (this.isProcessingAppWrite) return;

          const iframeEl = this.iframe().nativeElement;
          if (!iframeEl.contentWindow) return;

          const prevStr = this.lastBoundRootValues[key];
          const prev = prevStr ? JSON.parse(prevStr) : null;
          this.lastBoundRootValues[key] = JSON.stringify(value ?? null);

          if (value && typeof value === 'object') {
            for (const [k, v] of Object.entries(value)) {
              const oldVal = prev ? prev[k] : undefined;
              if (JSON.stringify(oldVal) !== JSON.stringify(v)) {
                iframeEl.contentWindow.postMessage(
                  {
                    type: 'a2ui_data_model_update',
                    key,
                    subpath: `/${k}`,
                    value: v,
                  },
                  '*',
                );
              }
            }
          } else {
            if (JSON.stringify(prev) !== JSON.stringify(value)) {
              iframeEl.contentWindow.postMessage(
                {
                  type: 'a2ui_data_model_update',
                  key,
                  value,
                },
                '*',
              );
            }
          }
        });
        this.dataSubscriptions.push(sub);
      }
    }

    const iframeEl = this.iframe().nativeElement;
    if (iframeEl.contentWindow) {
      const channel = new MessageChannel();
      this.appPort = channel.port1;

      const rect = iframeEl.getBoundingClientRect();
      const hostContext = {
        containerDimensions: {
          width: rect.width,
          height: rect.height,
        },
      };

      iframeEl.contentWindow.postMessage(
        {
          type: 'a2ui_app_frame_init',
          value: {
            initialData: initialData,
            allowedEvents: this.allowedEvents(),
            allowedFunctions: this.allowedFunctions(),
            hostContext: hostContext,
          },
        },
        '*',
        [channel.port2],
      );

      if (this.hostResizeObserver) {
        this.hostResizeObserver.disconnect();
      }
      this.hostResizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        if (entry && iframeEl.contentWindow) {
          iframeEl.contentWindow.postMessage(
            {
              type: 'a2ui_host_context_update',
              value: {
                containerDimensions: {
                  width: entry.contentRect.width,
                  height: entry.contentRect.height,
                },
              },
            },
            '*',
          );
        }
      });
      this.hostResizeObserver.observe(iframeEl);
    }
  }
}
