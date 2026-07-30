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
import {ComponentApi, DataContext} from '@a2ui/web_core/v0_9';
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
import Ajv from 'ajv';
import {
  IncomingWebFrameMessageSchema,
  IncomingWebFrameMessage,
  A2uiMessageType,
} from './web-frame-messages';
import stringify from 'fast-json-stable-stringify';

const WebAppFrameUrlPropsSchema = z.object({
  url: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  data: z.any().optional(),
  allowedEvents: z.record(z.unknown()).optional(),
  allowedFunctions: z.record(z.unknown()).optional(),
  mutableData: z.record(z.unknown()).optional(),
  disableSchemaValidation: z.boolean().optional(),
});

export interface WebAppFrameUrlApi extends ComponentApi<typeof WebAppFrameUrlPropsSchema> {
  name: 'WebAppFrameUrl';
}

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
export class WebAppFrameUrl
  extends CatalogComponent<WebAppFrameUrlApi>
  implements OnDestroy, OnInit
{
  private readonly sanitizer = inject(DomSanitizer);
  private readonly rendererService = inject(A2uiRendererService);

  protected readonly allowedEvents = computed<Record<string, unknown>>(
    () => this.props()['allowedEvents']?.value() || {},
  );
  protected readonly allowedFunctions = computed<Record<string, unknown>>(
    () => this.props()['allowedFunctions']?.value() || {},
  );
  protected readonly mutableData = computed<Record<string, unknown>>(
    () => this.props()['mutableData']?.value() || {},
  );
  protected readonly disableSchemaValidation = computed<boolean>(
    () => this.props()['disableSchemaValidation']?.value() || false,
  );
  protected readonly dataPaths = computed<Record<string, string>>(() => {
    const dataProp = this.props()['data'];
    if (!dataProp) return {};

    const rawPaths = (dataProp.raw as {paths?: Record<string, string>})?.paths;
    const valuePaths = dataProp.value()?.paths;

    return rawPaths ?? valuePaths ?? {};
  });

  protected readonly iframeSrc = signal<SafeResourceUrl | null>(
    this.sanitizer.bypassSecurityTrustResourceUrl('about:blank'),
  );

  private ajv = new Ajv();
  private iframe = viewChild.required<ElementRef<HTMLIFrameElement>>('iframe');
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private dataSubscriptions: {unsubscribe: () => void}[] = [];
  private resizeTimeout: ReturnType<typeof setTimeout> | null = null;
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

  private handleSandboxProxyReady(iframeEl: HTMLIFrameElement) {
    if (this.targetUrl && iframeEl.contentWindow) {
      iframeEl.contentWindow.postMessage(
        {
          type: A2uiMessageType.SandboxResourceReady,
          url: this.targetUrl,
        },
        window.location.origin,
      );
    }
  }

  private handleAction(
    data: Extract<IncomingWebFrameMessage, {type: typeof A2uiMessageType.Action}>,
  ) {
    if (data.action in this.allowedEvents()) {
      const schema = this.allowedEvents()[data.action];
      if (!this.disableSchemaValidation() && schema) {
        const validate = this.ajv.compile(schema);
        if (!validate(data.data || {})) {
          console.warn(`Action ${data.action} failed schema validation:`, validate.errors);
          return;
        }
      }
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
  }

  private handleDataModelChange(
    data: Extract<IncomingWebFrameMessage, {type: typeof A2uiMessageType.DataModelChange}>,
  ) {
    if (!(data.key in this.mutableData())) {
      console.warn(`Data key ${data.key} not authorized for mutation`);
      return;
    }
    const schema = this.mutableData()[data.key];
    if (!this.disableSchemaValidation() && schema) {
      const validate = this.ajv.compile(schema);
      if (!validate(data.value)) {
        console.warn(`Data change for ${data.key} failed schema validation:`, validate.errors);
        return;
      }
    }
    const surface = this.rendererService.surfaceGroup.getSurface(this.surfaceId());
    if (surface) {
      const dataPaths = this.dataPaths();

      if (dataPaths[data.key]) {
        const dataPath = dataPaths[data.key];
        const targetPath = data.subpath
          ? `${dataPath}${data.subpath.startsWith('/') ? '' : '/'}${data.subpath}`
          : dataPath;

        const currentValue = surface.dataModel.get(targetPath);
        if (stringify(currentValue) !== stringify(data.value)) {
          this.isProcessingAppWrite = true;
          try {
            surface.dataModel.set(targetPath, data.value);
          } finally {
            this.isProcessingAppWrite = false;
          }
        }
      }
    }
  }

  private async handleFunctionCall(
    data: Extract<IncomingWebFrameMessage, {type: typeof A2uiMessageType.FunctionCall}>,
    iframeEl: HTMLIFrameElement,
  ) {
    if (data.call in this.allowedFunctions()) {
      const schema = this.allowedFunctions()[data.call];
      if (!this.disableSchemaValidation() && schema) {
        const validate = this.ajv.compile(schema);
        if (!validate(data.args || {})) {
          console.warn(`Function ${data.call} failed schema validation:`, validate.errors);
          if (iframeEl.contentWindow) {
            iframeEl.contentWindow.postMessage(
              {
                type: A2uiMessageType.FunctionResult,
                call: data.call,
                callId: data.callId,
                status: 'error',
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Arguments failed schema validation',
                },
              },
              window.location.origin,
            );
          }
          return;
        }
      }
      const surface = this.rendererService.surfaceGroup.getSurface(this.surfaceId());
      if (surface) {
        const dataContext = new DataContext(surface, '/');
        try {
          const result = await surface.catalog.invoker(data.call, data.args || {}, dataContext);
          if (iframeEl.contentWindow) {
            iframeEl.contentWindow.postMessage(
              {
                type: A2uiMessageType.FunctionResult,
                call: data.call,
                callId: data.callId,
                status: 'success',
                result: result,
              },
              window.location.origin,
            );
          }
        } catch (err: unknown) {
          if (iframeEl.contentWindow) {
            const errorMessage =
              err instanceof Error ? err.message : String(err) || 'Error executing function';
            iframeEl.contentWindow.postMessage(
              {
                type: A2uiMessageType.FunctionResult,
                call: data.call,
                callId: data.callId,
                status: 'error',
                error: {
                  code: 'EXECUTION_ERROR',
                  message: errorMessage,
                },
              },
              window.location.origin,
            );
          }
        }
      }
    } else {
      console.warn(`Function ${data.call} not in allowedFunctions`);
    }
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

      const parsedData = IncomingWebFrameMessageSchema.safeParse(event.data);
      if (!parsedData.success) {
        return; // Ignore invalid or unrecognized messages
      }

      const data = parsedData.data;

      if (data.type === A2uiMessageType.SandboxProxyReady) {
        this.handleSandboxProxyReady(iframeEl);
        return;
      }

      if (data.type === A2uiMessageType.AppFrameReady) {
        this.initializeBridge();
      } else if (data.type === A2uiMessageType.Action) {
        this.handleAction(data);
      } else if (data.type === A2uiMessageType.DataModelChange) {
        this.handleDataModelChange(data);
      } else if (data.type === A2uiMessageType.FunctionCall) {
        await this.handleFunctionCall(data, iframeEl);
      } else if (data.type === A2uiMessageType.SizeChanged) {
        this.handleSizeChange(data.width, data.height);
      }
    };

    window.addEventListener('message', this.messageHandler);
  }

  private initializeBridge() {
    this.clearDataSubscriptions();

    const surface = this.rendererService.surfaceGroup.getSurface(this.surfaceId());
    const dataPaths = this.dataPaths();

    const initialData: Record<string, unknown> = {};

    if (surface && Object.keys(dataPaths).length > 0) {
      for (const [key, dataPath] of Object.entries(dataPaths)) {
        initialData[key] = surface.dataModel.get(dataPath);
        this.lastBoundRootValues[key] = stringify(initialData[key] ?? null);

        const sub = surface.dataModel.subscribe(dataPath, value => {
          if (this.isProcessingAppWrite) return;

          const iframeEl = this.iframe().nativeElement;
          if (!iframeEl.contentWindow) return;

          const prevStr = this.lastBoundRootValues[key];
          const prev = prevStr ? JSON.parse(prevStr) : null;
          this.lastBoundRootValues[key] = stringify(value ?? null);

          if (value && typeof value === 'object') {
            for (const [k, v] of Object.entries(value)) {
              const oldVal = prev ? prev[k] : undefined;
              if (stringify(oldVal) !== stringify(v)) {
                iframeEl.contentWindow.postMessage(
                  {
                    type: A2uiMessageType.DataModelUpdate,
                    key,
                    subpath: `/${k}`,
                    value: v,
                  },
                  window.location.origin,
                );
              }
            }
          } else {
            if (stringify(prev) !== stringify(value)) {
              iframeEl.contentWindow.postMessage(
                {
                  type: A2uiMessageType.DataModelUpdate,
                  key,
                  value,
                },
                window.location.origin,
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
          type: A2uiMessageType.AppFrameInit,
          value: {
            config: this.props()['config']?.value() ?? {},
            initialData: initialData,
            allowedEvents: this.allowedEvents(),
            allowedFunctions: this.allowedFunctions(),
            mutableDataKeys: Object.keys(this.mutableData()),
            hostContext: hostContext,
          },
        },
        window.location.origin,
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
              type: A2uiMessageType.HostContextUpdate,
              value: {
                containerDimensions: {
                  width: entry.contentRect.width,
                  height: entry.contentRect.height,
                },
              },
            },
            window.location.origin,
          );
        }
      });
      this.hostResizeObserver.observe(iframeEl);
    }
  }
}
