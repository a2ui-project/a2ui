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

import {A2uiRendererService} from '@a2ui/angular/v0_9';
import {DataContext} from '@a2ui/web_core/v0_9';
import {DestroyRef, ElementRef, inject, Injectable, Signal} from '@angular/core';
import Ajv, {ValidateFunction} from 'ajv';
import stringify from 'fast-json-stable-stringify';
import {
  A2uiMessageType,
  IncomingWebFrameMessage,
  IncomingWebFrameMessageSchema,
} from './web-frame-messages';

export interface WebAppFrameBridgeConfig {
  iframe: Signal<ElementRef<HTMLIFrameElement>>;
  props: Signal<Record<string, any>>;
  surfaceId: Signal<string>;
  componentId: Signal<string>;
  getExpectedOrigin: () => string;
  onSandboxProxyReady: (iframeEl: HTMLIFrameElement) => void;
}

@Injectable()
export class WebAppFrameBridgeService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly rendererService = inject(A2uiRendererService);

  private ajv = new Ajv();
  private validatorCache = new Map<string, ValidateFunction>();
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private dataSubscriptions: {unsubscribe: () => void}[] = [];
  private resizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastWidth?: number;
  private lastHeight?: number;
  private lastBoundRootValues: Record<string, string> = {};
  private isProcessingAppWrite = false;
  private appPort: MessagePort | null = null;
  private hostResizeObserver: ResizeObserver | null = null;
  private config: WebAppFrameBridgeConfig | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearDataSubscriptions();
      if (this.appPort) {
        this.appPort.close();
        this.appPort = null;
      }
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
    });
  }

  initialize(config: WebAppFrameBridgeConfig) {
    this.config = config;
    this.setupSandbox();
  }

  private allowedEvents(props: Record<string, any>): Record<string, unknown> {
    return props['allowedEvents']?.value() || {};
  }

  private allowedFunctions(props: Record<string, any>): Record<string, unknown> {
    return props['allowedFunctions']?.value() || {};
  }

  private mutableData(props: Record<string, any>): Record<string, unknown> {
    return props['mutableData']?.value() || {};
  }

  private disableSchemaValidation(props: Record<string, any>): boolean {
    return props['disableSchemaValidation']?.value() || false;
  }

  private dataPaths(props: Record<string, any>): Record<string, string> {
    const dataProp = props['data'];
    if (!dataProp) return {};

    const rawPaths = (dataProp.raw as {paths?: Record<string, string>})?.paths;
    const valuePaths = dataProp.value()?.paths;

    return rawPaths ?? valuePaths ?? {};
  }

  private getValidator(schema: object): ValidateFunction {
    const key = JSON.stringify(schema);
    let validate = this.validatorCache.get(key);
    if (!validate) {
      validate = this.ajv.compile(schema);
      this.validatorCache.set(key, validate);
    }
    return validate;
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
      if (!this.config) return;
      const iframeEl = this.config.iframe().nativeElement;
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

  private handleAction(
    data: Extract<IncomingWebFrameMessage, {type: typeof A2uiMessageType.Action}>,
  ) {
    if (!this.config) return;
    const props = this.config.props();
    const allowedEvents = this.allowedEvents(props);

    if (data.action in allowedEvents) {
      const schema = allowedEvents[data.action];
      if (!this.disableSchemaValidation(props) && schema) {
        const validate = this.getValidator(schema as object);
        if (!validate(data.data || {})) {
          console.warn(`Action ${data.action} failed schema validation:`, validate.errors);
          return;
        }
      }
      const surface = this.rendererService.surfaceGroup.getSurface(this.config.surfaceId());
      if (surface) {
        surface.dispatchAction(
          {
            event: {
              name: data.action,
              context: data.data || {},
            },
          },
          this.config.componentId(),
        );
      }
    } else {
      console.warn(`Action ${data.action} not in allowedEvents`);
    }
  }

  private handleDataModelChange(
    data: Extract<IncomingWebFrameMessage, {type: typeof A2uiMessageType.DataModelChange}>,
  ) {
    if (!this.config) return;
    const props = this.config.props();
    const mutableData = this.mutableData(props);

    if (!(data.key in mutableData)) {
      console.warn(`Data key ${data.key} not authorized for mutation`);
      return;
    }
    const schema = mutableData[data.key];
    if (!this.disableSchemaValidation(props) && schema) {
      const validate = this.getValidator(schema as object);
      if (!validate(data.value)) {
        console.warn(`Data change for ${data.key} failed schema validation:`, validate.errors);
        return;
      }
    }
    const surface = this.rendererService.surfaceGroup.getSurface(this.config.surfaceId());
    if (surface) {
      const dataPaths = this.dataPaths(props);

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
    if (!this.config) return;
    const props = this.config.props();
    const allowedFunctions = this.allowedFunctions(props);

    if (data.call in allowedFunctions) {
      const schema = allowedFunctions[data.call];
      if (!this.disableSchemaValidation(props) && schema) {
        const validate = this.getValidator(schema as object);
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
      const surface = this.rendererService.surfaceGroup.getSurface(this.config.surfaceId());
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
      if (!this.config) return;
      const expectedOrigin = this.config.getExpectedOrigin();
      if (event.origin !== expectedOrigin && event.origin !== window.location.origin) {
        return;
      }

      const iframeEl = this.config.iframe().nativeElement;
      if (!iframeEl || event.source !== iframeEl.contentWindow) {
        return;
      }

      const parsedData = IncomingWebFrameMessageSchema.safeParse(event.data);
      if (!parsedData.success) {
        return;
      }

      const data = parsedData.data;

      if (data.type === A2uiMessageType.SandboxProxyReady) {
        this.config.onSandboxProxyReady(iframeEl);
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
    if (!this.config) return;
    this.clearDataSubscriptions();

    const surface = this.rendererService.surfaceGroup.getSurface(this.config.surfaceId());
    const props = this.config.props();
    const dataPaths = this.dataPaths(props);

    const initialData: Record<string, unknown> = {};

    if (surface && Object.keys(dataPaths).length > 0) {
      for (const [key, dataPath] of Object.entries(dataPaths)) {
        initialData[key] = surface.dataModel.get(dataPath);
        this.lastBoundRootValues[key] = stringify(initialData[key] ?? null);

        const sub = surface.dataModel.subscribe(dataPath, value => {
          if (this.isProcessingAppWrite) return;
          if (!this.config) return;

          const iframeEl = this.config.iframe().nativeElement;
          if (!iframeEl || !iframeEl.contentWindow) return;

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

    const iframeEl = this.config.iframe().nativeElement;
    if (iframeEl && iframeEl.contentWindow) {
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
            config: props['config']?.value() ?? {},
            initialData: initialData,
            allowedEvents: this.allowedEvents(props),
            allowedFunctions: this.allowedFunctions(props),
            mutableDataKeys: Object.keys(this.mutableData(props)),
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
