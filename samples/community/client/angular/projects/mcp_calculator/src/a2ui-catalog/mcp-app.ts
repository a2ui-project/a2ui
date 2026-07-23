/*
 Copyright 2025 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import {CatalogComponent, A2uiRendererService} from '@a2ui/angular/v0_9';
import {DataContext} from '@a2ui/web_core/v0_9';
import {z} from 'zod';
import {
  AppBridge,
  PostMessageTransport,
  SANDBOX_PROXY_READY_METHOD,
} from '@modelcontextprotocol/ext-apps/app-bridge';
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
  selector: 'a2ui-mcp-app',
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
  template: `
    @if (resolvedContent()) {
      <iframe #iframe [src]="iframeSrc()" [title]="resolvedTitle() || 'MCP App'"></iframe>
    }
  `,
})
export class McpApp extends CatalogComponent<any> implements OnDestroy, OnInit {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly rendererService = inject(A2uiRendererService);

  protected readonly resolvedContent = computed<string | null>(() => {
    let rawContent = this.props()['htmlContent']?.value() ?? null;
    console.log('[McpApp] rawContent:', rawContent);
    if (rawContent && typeof rawContent === 'string' && rawContent.startsWith('url_encoded:')) {
      rawContent = decodeURIComponent(rawContent.substring(12));
    }
    console.log(
      '[McpApp] resolvedContent:',
      rawContent ? rawContent.substring(0, 100) + '...' : null,
    );
    return typeof rawContent === 'string' ? rawContent : null;
  });

  private readonly contentUpdate = effect(() => {
    const rawContent = this.resolvedContent();
    const bridge = this.appBridge();
    console.log('[McpApp] contentUpdate effect - bridge:', !!bridge, 'hasContent:', !!rawContent);
    if (bridge && rawContent) {
      bridge
        .sendSandboxResourceReady({
          html: rawContent,
          sandbox: 'allow-scripts',
        })
        .catch(err => console.error('Failed to update sandbox content:', err));
    }
  });

  protected readonly allowedTools = computed<string[]>(
    () => this.props()['allowedTools']?.value() || [],
  );
  protected readonly resolvedTitle = computed<string | null>(
    () => this.props()['title']?.value() ?? null,
  );

  protected readonly iframeSrc = signal<SafeResourceUrl | null>(
    this.sanitizer.bypassSecurityTrustResourceUrl('about:blank'),
  );

  private iframe = viewChild.required<ElementRef<HTMLIFrameElement>>('iframe');
  private appBridge = signal<AppBridge | null>(null);
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private dataSubscription: any = null;
  private resizeTimeout: any = null;
  private lastWidth?: number;
  private lastHeight?: number;
  private lastBoundRootValue: string | null = null;
  private isProcessingAppWrite = false;
  private hostResizeObserver: ResizeObserver | null = null;

  ngOnInit() {
    this.setupSandbox();
  }

  ngOnDestroy() {
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
      this.dataSubscription = null;
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
    const bridge = this.appBridge();
    if (bridge) {
      bridge.close().catch(e => console.error('Error closing AppBridge on destroy:', e));
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

      // 1. Clamping
      const targetWidth = width !== undefined ? Math.max(200, Math.min(width, 3000)) : undefined;
      const targetHeight = height !== undefined ? Math.max(100, Math.min(height, 2000)) : undefined;

      // 2. Threshold Gate
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

        // Update parent container aspect ratio or height
        const parent = iframeEl.parentElement;
        if (parent) {
          parent.style.height = `${targetHeight}px`;
          parent.style.aspectRatio = 'auto';
        }
        this.lastHeight = targetHeight;
      }
    }, 100); // 3. Throttling: 100ms
  }

  private setupSandbox() {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
    }

    this.messageHandler = (event: MessageEvent) => {
      // Check if the message is from our iframe
      if (
        this.iframe().nativeElement &&
        event.source === this.iframe().nativeElement.contentWindow &&
        event.data?.method === SANDBOX_PROXY_READY_METHOD
      ) {
        // Init bridge
        this.initializeBridge();
      }
    };

    window.addEventListener('message', this.messageHandler);

    // Check for query param to opt-out of origin toggle (for testing)
    const urlParams = new URLSearchParams(window.location.search);
    const disableSecuritySelfTest = urlParams.get('disable_security_self_test') === 'true';

    const currentOrigin = window.location.origin;
    let sandboxUrl = `${currentOrigin}/mcp_apps_inner_iframe/sandbox.html`;
    if (disableSecuritySelfTest) {
      sandboxUrl += '?disable_security_self_test=true';
    }
    this.iframeSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(sandboxUrl));
  }

  private async initializeBridge() {
    if (!this.iframe().nativeElement.contentWindow) {
      return;
    }

    const iframe = this.iframe().nativeElement;

    // The app bridge is initialized without a direct connection to MCP server.
    // Communication with MCP server is expected to be handled by the sandbox iframe.
    const emptyMcpClient = null;
    const bridge = new AppBridge(
      emptyMcpClient,
      {name: 'MCP Calculator', version: '1.0.0'},
      {
        openLinks: {},
        logging: {},
        serverTools: {}, // Advertise support if we had a client
      },
    );

    bridge.onloggingmessage = params => {
      console.log(`[MCP App Log] ${params.level}:`, params.data);
    };

    bridge.oninitialized = () => {
      console.log('MCP App Initialized');
    };

    bridge.onsizechange = ({width, height}) => {
      this.handleSizeChange(width, height);
    };

    const surface = this.rendererService.surfaceGroup.getSurface(this.surfaceId());
    // Resolve the path string. If the binder interprets the configuration object `{"path": "/..."}`
    // as a DataBinding, it automatically resolves it to the underlying model value.
    // We fall back to `raw` to inspect the unresolved literal path metadata if it was resolved.
    const dataPath =
      (this.props()['data']?.raw as any)?.path ?? this.props()['data']?.value()?.path;

    // Two-way local data binding: Subscribe to host Data Model changes
    if (surface && dataPath) {
      this.lastBoundRootValue = JSON.stringify(surface.dataModel.get(dataPath));

      this.dataSubscription = surface.dataModel.subscribe(dataPath, value => {
        // Suppress echoes: If the update was initiated by the app itself, do not
        // send a data-model-update notification back to it to prevent feedback loops.
        // This is safe because JavaScript is single-threaded and the dataModel write +
        // signals propagation run synchronously in a single call stack, meaning no other
        // host or sibling writes can run or be blocked during this window.
        if (this.isProcessingAppWrite) {
          return;
        }

        const currentBridge = this.appBridge();
        if (!currentBridge) return;

        // Compare the new state tree against the last cached value to perform change detection:
        // - For objects: diff individual keys and send targeted subpath notifications to prevent
        //   overwriting unrelated properties (and causing concurrent clobbering).
        // - For primitives: do a direct comparison of the values and update accordingly.
        const prev = this.lastBoundRootValue ? JSON.parse(this.lastBoundRootValue) : null;
        this.lastBoundRootValue = JSON.stringify(value);

        if (value && typeof value === 'object') {
          // Diff the current root object against the previous cached root object
          for (const [k, v] of Object.entries(value)) {
            const oldVal = prev ? prev[k] : undefined;
            if (JSON.stringify(oldVal) === JSON.stringify(v)) {
              continue;
            }
            (currentBridge as any)
              .notification({
                method: 'ui/notifications/data-model-update',
                params: {
                  subpath: `/${k}`,
                  value: v,
                },
              })
              .catch((err: any) =>
                console.error(`Failed to send data-model-update for /${k}:`, err),
              );
          }
        } else {
          // Fallback for primitives
          if (JSON.stringify(prev) === JSON.stringify(value)) {
            return;
          }
          (currentBridge as any)
            .notification({
              method: 'ui/notifications/data-model-update',
              params: {value},
            })
            .catch((err: any) => console.error('Failed to send data-model-update:', err));
        }
      });
    }

    // Two-way local data binding: Handle data-model-change from app
    const DataModelChangeNotificationSchema = z.object({
      method: z.literal('ui/notifications/data-model-change'),
      params: z.object({
        subpath: z.string().optional(),
        value: z.any(),
      }),
    });

    bridge.setNotificationHandler(DataModelChangeNotificationSchema, notification => {
      const params = notification.params;
      if (surface && dataPath) {
        const subpath = params.subpath;
        const targetPath = subpath
          ? `${dataPath}${subpath.startsWith('/') ? '' : '/'}${subpath}`
          : dataPath;

        // Perform basic check against current live store state to prevent redundant writes
        const currentValue = surface.dataModel.get(targetPath);
        if (JSON.stringify(currentValue) === JSON.stringify(params.value)) {
          return;
        }

        this.isProcessingAppWrite = true;
        try {
          surface.dataModel.set(targetPath, params.value);
        } finally {
          this.isProcessingAppWrite = false;
        }
      }
    });

    // Local client-side function execution: Handle requests from app
    const FunctionCallRequestSchema = z.object({
      method: z.literal('ui/requests/function-call'),
      params: z.object({
        call: z.string(),
        args: z.record(z.any()),
      }),
    });

    bridge.setRequestHandler(FunctionCallRequestSchema, async request => {
      const params = request.params;
      const allowed = this.props()['allowedFunctions']?.value() || [];
      if (!allowed.includes(params.call)) {
        throw new Error(`Local function '${params.call}' is not allowed`);
      }

      if (!surface) {
        throw new Error('Surface not found');
      }
      const dataContext = new DataContext(surface, '/');

      const result = await surface.catalog.invoker(params.call, params.args, dataContext);

      return {
        status: 'success',
        result,
      };
    });

    bridge.oncalltool = async params => {
      console.log(`[MCP App] Tool call requested: ${params.name}`, params);

      if (!this.allowedTools().includes(params.name)) {
        console.warn(`[MCP App] Tool '${params.name}' not allowed.`);
        throw new Error(`Tool '${params.name}' not allowed`);
      }

      if (surface) {
        const action = {
          event: {
            name: params.name,
            context: params.arguments || {},
          },
        };
        console.log('Sending action:', action);
        surface.dispatchAction(action, this.componentId());
      }

      // Return empty result immediately (calculator UI can forget about it)
      return {content: []};
    };

    // Set initial host context synchronously so it is available during the handshake
    const rect = iframe.getBoundingClientRect();
    bridge.setHostContext({
      containerDimensions: {
        width: rect.width,
        height: rect.height,
      },
    });

    // Inform the app of subsequent dimension changes
    if (this.hostResizeObserver) {
      this.hostResizeObserver.disconnect();
    }
    this.hostResizeObserver = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry && bridge) {
        bridge.setHostContext({
          containerDimensions: {
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          },
        });
      }
    });
    this.hostResizeObserver.observe(iframe);

    // Connect the bridge
    // We must pass the iframe's contentWindow as the target
    const transport = new PostMessageTransport(
      // The first argument is the target window to send messages TO (the iframe).
      // The second argument is the source window to validate messages FROM (also the iframe).
      iframe.contentWindow!,
      iframe.contentWindow!,
    );
    await bridge.connect(transport);

    // Clean up old bridge to prevent memory leaks and zombie event listeners.
    const oldBridge = this.appBridge();
    if (oldBridge) {
      oldBridge.close().catch(e => console.error('Error closing previous AppBridge:', e));
    }
    // Set the new bridge.
    this.appBridge.set(bridge);
  }
}
